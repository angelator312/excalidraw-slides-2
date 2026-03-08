import type { Server as HTTPServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from './models/user.js';
import { Presentation } from './models/presentation.js';
import { Slide } from './models/slide.js';
import { ShareLink } from './models/sharelink.js';
import { Version, MAX_AUTO_VERSIONS } from './models/version.js';
import { canView, canEdit, canViewWithTeam, canEditWithTeam } from './middleware/perm.js';
import { JWT_SECRET } from './config.js';

/** Minimum gap (ms) between auto-version saves for the same slide. */
const AUTO_VERSION_DEBOUNCE_MS = 30_000;

interface PresenceInfo {
  userId: string;
  displayName: string;
  color: string;
  slideIndex: number;
  pointerVisible: boolean;
  pointerX?: number;
  pointerY?: number;
}

/** Color palette for cursors (one per connected user) */
const CURSOR_COLORS = ['#e94560', '#4fc3f7', '#81c784', '#ffb74d', '#ce93d8', '#80cbc4', '#f06292', '#aed581'];

export function setupWebSocket(httpServer: HTTPServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Map: presentationId → Map<socketId, PresenceInfo>
  const rooms = new Map<string, Map<string, PresenceInfo>>();

  io.on('connection', (socket: Socket) => {
    let currentPresentationId: string | null = null;
    let userId: string | null = null;
    let displayName = 'Anonymous';
    let colorIndex = 0;

    /* ── Authenticate ── */
    const token = (socket.handshake.auth as { token?: string }).token;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
        userId = payload.sub;
      } catch { /* anonymous */ }
    }

    /* ── Join Room ── */
    socket.on('joinRoom', async (data: { presentationId: string; token?: string }) => {
      const presId = data.presentationId;

      const pres = await Presentation.findById(presId).lean();
      if (!pres) { socket.emit('error', 'Presentation not found'); return; }

      // Resolve share role if present
      let shareRole: 'view' | 'edit' | undefined;
      if (data.token) {
        const link = await ShareLink.findOne({ token: data.token });
        if (link && (!link.expiresAt || link.expiresAt > new Date())) {
          shareRole = link.role;
        }
      }

      if (!await canViewWithTeam(pres, userId ?? undefined, shareRole)) {
        socket.emit('error', 'Access denied');
        return;
      }

      // Get display name from DB
      if (userId) {
        const user = await User.findById(userId).select('displayName').lean();
        if (user) displayName = user.displayName;
      }

      currentPresentationId = presId;
      void socket.join(presId);

      if (!rooms.has(presId)) rooms.set(presId, new Map());
      const room = rooms.get(presId)!;
      colorIndex = room.size % CURSOR_COLORS.length;

      room.set(socket.id, {
        userId: userId ?? socket.id,
        displayName,
        color: CURSOR_COLORS[colorIndex],
        slideIndex: 0,
        pointerVisible: false,
      });

      broadcastPresence(presId);
    });

    /* ── Presence update (cursor) ── */
    socket.on('presence', (data: { cursor?: { x: number; y: number }; slideIndex?: number }) => {
      if (!currentPresentationId) return;
      const room = rooms.get(currentPresentationId);
      if (!room) return;
      const info = room.get(socket.id);
      if (!info) return;
      if (data.cursor) {
        info.pointerX = data.cursor.x;
        info.pointerY = data.cursor.y;
      }
      if (typeof data.slideIndex === 'number') info.slideIndex = data.slideIndex;
      broadcastPresence(currentPresentationId);
    });

    /* ── Diff (scene update) ── */
    socket.on('diff', async (data: { slideId: string; sceneJSON: Record<string, unknown>; presentationId: string }) => {
      const presId = data.presentationId;
      const pres = await Presentation.findById(presId).lean();
      if (!pres) return;
      if (!await canEditWithTeam(pres, userId ?? undefined)) return;

      const slide = await Slide.findOne({ _id: data.slideId, presentationId: presId });
      if (!slide) return;

      // Only save an auto-version if the last one for this slide is older than 30s.
      // This prevents a flood of identical/near-identical snapshots on every keystroke.
      const lastAuto = await Version.findOne({ slideId: slide._id, type: 'auto' })
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean();
      const shouldSaveVersion =
        !lastAuto ||
        Date.now() - lastAuto.createdAt.getTime() > AUTO_VERSION_DEBOUNCE_MS;

      if (shouldSaveVersion) {
        await Version.create({
          slideId: slide._id,
          presentationId: presId,
          sceneJSON: slide.sceneJSON,
          type: 'auto',
          createdBy: userId ?? undefined,
        });
        // Prune old auto-versions beyond the cap
        const old = await Version.find({ slideId: slide._id, type: 'auto' })
          .sort({ createdAt: -1 })
          .skip(MAX_AUTO_VERSIONS)
          .select('_id')
          .lean();
        if (old.length > 0) {
          await Version.deleteMany({ _id: { $in: old.map((v) => v._id) } });
        }
      }

      slide.sceneJSON = data.sceneJSON;
      await slide.save();

      // Broadcast to everyone else in the room (not the sender)
      socket.to(presId).emit('diff', { slideId: data.slideId, sceneJSON: data.sceneJSON, userId });
    });

    /* ── Slide change ── */
    socket.on('slideChange', (data: { presentationId: string; index: number }) => {
      if (!currentPresentationId) return;
      const room = rooms.get(currentPresentationId);
      if (room) {
        const info = room.get(socket.id);
        if (info) info.slideIndex = data.index;
      }
      socket.to(data.presentationId).emit('slideChange', { index: data.index });
      broadcastPresence(data.presentationId);
    });

    /* ── Laser pointer move ── */
    socket.on('pointerMove', (data: { presentationId: string; x: number; y: number; visible: boolean }) => {
      // Broadcast to everyone else in the room (exclude sender to avoid self-pointer)
      socket.to(data.presentationId).emit('pointerMove', {
        userId: userId ?? socket.id,
        x: data.x,
        y: data.y,
        visible: data.visible,
      });
    });

    /* ── Disconnect ── */
    socket.on('disconnect', () => {
      if (currentPresentationId) {
        const room = rooms.get(currentPresentationId);
        if (room) {
          room.delete(socket.id);
          if (room.size === 0) rooms.delete(currentPresentationId);
          else broadcastPresence(currentPresentationId);
        }
      }
    });

    function broadcastPresence(presId: string): void {
      const room = rooms.get(presId);
      if (!room) return;
      const list = Array.from(room.values());
      io.to(presId).emit('presence', list);
    }
  });

  return io;
}
