import { Router } from 'express';
import { nanoid } from 'nanoid';
import { Presentation } from '../models/presentation.js';
import { Slide } from '../models/slide.js';
import { ShareLink } from '../models/sharelink.js';
import { User } from '../models/user.js';
import { Team } from '../models/team.js';
import { Version, MAX_AUTO_VERSIONS } from '../models/version.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { canView, canEdit } from '../middleware/perm.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { Types } from 'mongoose';

const router = Router();

/* ─────────────────────── Presentations CRUD ─────────────────────── */

/** GET /api/presentations  — list presentations visible to caller */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?._id;
  const query = buildVisibilityQuery(userId?.toString());
  const presentations = await Presentation.find(query)
    .sort({ updatedAt: -1 })
    .lean();

  const ownerIds = presentations.map((p) => p.ownerUserId);
  const owners = await User.find({ _id: { $in: ownerIds } }).select('username').lean();
  const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.username]));

  const presIds = presentations.map((p) => p._id);

  // Separate presentations by thumbnailMode
  const gridPresIds = presentations
    .filter((p) => (p.thumbnailMode ?? 'first-slide') === 'grid')
    .map((p) => p._id);
  const firstSlidePresIds = presentations
    .filter((p) => (p.thumbnailMode ?? 'first-slide') !== 'grid')
    .map((p) => p._id);

  // For first-slide mode: fetch only index=0 slides
  const firstSlides = await Slide.find({ presentationId: { $in: firstSlidePresIds }, index: 0 })
    .select('presentationId thumbnail')
    .lean();
  const thumbMap = new Map(
    firstSlides.map((s) => [s.presentationId.toString(), s.thumbnail ?? null]),
  );

  // For grid mode: fetch up to 4 slides per presentation, ordered by index
  const gridSlides = gridPresIds.length > 0
    ? await Slide.find({ presentationId: { $in: gridPresIds }, index: { $lt: 4 } })
        .select('presentationId index thumbnail')
        .sort({ index: 1 })
        .lean()
    : [];
  // Group grid slide thumbnails by presentationId
  const gridThumbMap = new Map<string, (string | null)[]>();
  for (const s of gridSlides) {
    const key = s.presentationId.toString();
    if (!gridThumbMap.has(key)) gridThumbMap.set(key, []);
    gridThumbMap.get(key)!.push(s.thumbnail ?? null);
  }

  const result = presentations.map((p) => {
    const mode = p.thumbnailMode ?? 'first-slide';
    const pKey = p._id.toString();
    return {
      _id: p._id,
      title: p.title,
      visibility: p.visibility,
      ownerUsername: ownerMap.get(p.ownerUserId.toString()) ?? 'unknown',
      slideCount: p.slideCount,
      updatedAt: p.updatedAt,
      canEdit: userId ? userCanEdit(p, userId.toString()) : false,
      thumbnailMode: mode,
      // first-slide mode: single thumbnail string; grid mode: array of up to 4 thumbnails
      thumbnail: mode === 'grid' ? null : (thumbMap.get(pKey) ?? null),
      gridThumbnails: mode === 'grid' ? (gridThumbMap.get(pKey) ?? []) : undefined,
    };
  });

  res.json(result);
});

/** GET /api/presentations/:id */
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }

  const userId = req.user?._id.toString();
  if (!canView(pres, userId, req.shareRole)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const slides = await Slide.find({ presentationId: pres._id }).sort({ index: 1 }).lean();
  const owner = await User.findById(pres.ownerUserId).select('username displayName').lean();
  // Fetch editor display info for the settings panel
  const editors = await User.find({ _id: { $in: pres.editorUserIds } })
    .select('_id username displayName')
    .lean();

  res.json({
    _id: pres._id,
    title: pres.title,
    visibility: pres.visibility,
    ownerUsername: owner?.username ?? 'unknown',
    canEdit: userId ? userCanEdit(pres, userId) : false,
    editors: editors.map((e) => ({ _id: e._id.toString(), username: e.username, displayName: e.displayName })),
    thumbnailMode: pres.thumbnailMode ?? 'first-slide',
    slides: slides.map((s) => ({
      id: s._id.toString(),
      presentationId: s.presentationId.toString(),
      index: s.index,
      title: s.title,
      notes: s.notes,
      sceneJSON: s.sceneJSON,
    })),
  });
});

/** POST /api/presentations */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { title, visibility, teamId } = req.body as {
    title?: string;
    visibility?: string;
    teamId?: string;
  };

  if (!title?.trim()) { res.status(400).json({ error: 'Title is required' }); return; }

  const vis = (['public', 'private', 'team-only'] as const).includes(visibility as never)
    ? (visibility as 'public' | 'private' | 'team-only')
    : 'private';

  if (teamId) {
    const team = await Team.findById(teamId);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
    const isMember = team.memberUserIds.some((id) => id.toString() === req.user!._id.toString())
      || team.ownerUserId.toString() === req.user!._id.toString();
    if (!isMember) { res.status(403).json({ error: 'Not a member of that team' }); return; }
  }

  const pres = await Presentation.create({
    title: title.trim(),
    ownerUserId: req.user!._id,
    visibility: vis,
    teamId: teamId ?? undefined,
  });

  res.status(201).json(pres);
});

/** PATCH /api/presentations/:id */
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const { title, visibility, teamId, thumbnailMode } = req.body as {
    title?: string;
    visibility?: string;
    teamId?: string | null;
    thumbnailMode?: string;
  };

  if (title) pres.title = title.trim();
  if (visibility && (['public', 'private', 'team-only'] as const).includes(visibility as never)) {
    pres.visibility = visibility as 'public' | 'private' | 'team-only';
  }
  if (teamId !== undefined) {
    pres.teamId = teamId ? (teamId as unknown as Types.ObjectId) : undefined;
  }
  if (thumbnailMode && ['first-slide', 'grid'].includes(thumbnailMode)) {
    pres.thumbnailMode = thumbnailMode as 'first-slide' | 'grid';
  }
  await pres.save();
  res.json(pres);
});

/** DELETE /api/presentations/:id */
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can delete' }); return;
  }
  await Slide.deleteMany({ presentationId: pres._id });
  await Version.deleteMany({ presentationId: pres._id });
  await ShareLink.deleteMany({ presentationId: pres._id });
  await pres.deleteOne();
  res.json({ message: 'Deleted' });
});

/* ─────────────────── Editors management ─────────────────── */

/** POST /api/presentations/:id/editors — add editor by username */
router.post('/:id/editors', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { username } = req.body as { username?: string };
  if (!username?.trim()) { res.status(400).json({ error: 'username is required' }); return; }

  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can add editors' }); return;
  }

  const targetUser = await User.findOne({ username: username.trim().toLowerCase(), role: { $ne: 'anonymous' } });
  if (!targetUser) { res.status(404).json({ error: `User "${username}" not found` }); return; }

  const already = pres.editorUserIds.some((id) => id.toString() === targetUser._id.toString());
  if (already) { res.status(409).json({ error: 'Already an editor' }); return; }

  pres.editorUserIds.push(targetUser._id);
  await pres.save();
  res.json({ message: 'Editor added', username: targetUser.username });
});

/** DELETE /api/presentations/:id/editors/:userId */
router.delete('/:id/editors/:userId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can remove editors' }); return;
  }
  pres.editorUserIds = pres.editorUserIds.filter((id) => id.toString() !== req.params['userId']);
  await pres.save();
  res.json({ message: 'Editor removed' });
});

/* ─────────────────── Share links ─────────────────── */

/** GET /api/presentations/:id/share-links */
router.get('/:id/share-links', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can manage share links' }); return;
  }
  const links = await ShareLink.find({ presentationId: pres._id }).lean();
  res.json(links);
});

/** POST /api/presentations/:id/share-links */
router.post('/:id/share-links', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can create share links' }); return;
  }

  const { role, expiryDays } = req.body as { role?: string; expiryDays?: number };
  const linkRole = role === 'edit' ? 'edit' : 'view';
  const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 86_400_000) : undefined;

  const link = await ShareLink.create({
    token: nanoid(32),
    presentationId: pres._id,
    role: linkRole,
    createdBy: req.user!._id,
    expiresAt,
  });

  res.status(201).json(link);
});

/** DELETE /api/presentations/:id/share-links/:token */
router.delete('/:id/share-links/:token', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (pres.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the owner can revoke share links' }); return;
  }
  await ShareLink.deleteOne({ token: req.params['token'], presentationId: pres._id });
  res.json({ message: 'Revoked' });
});

/* ─────────────────── Slides ─────────────────── */

/** GET /api/presentations/:id/slides */
router.get('/:id/slides', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canView(pres, req.user?._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }
  const slides = await Slide.find({ presentationId: pres._id }).sort({ index: 1 }).lean();
  res.json(slides);
});

/** POST /api/presentations/:id/slides */
router.post('/:id/slides', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const { index, sceneJSON, notes, title } = req.body as {
    index?: number;
    sceneJSON?: Record<string, unknown>;
    notes?: string;
    title?: string;
  };

  const slide = await Slide.create({
    presentationId: pres._id,
    index: index ?? pres.slideCount,
    title: title ?? '',
    sceneJSON: sceneJSON ?? { type: 'excalidraw', version: 2, elements: [] },
    notes: notes ?? '',
  });

  pres.slideCount += 1;
  await pres.save();

  res.status(201).json({
    id: slide._id.toString(),
    presentationId: slide.presentationId.toString(),
    index: slide.index,
    title: slide.title,
    notes: slide.notes,
    sceneJSON: slide.sceneJSON,
  });
});

/** PATCH /api/presentations/:id/slides/:slideId */
router.patch('/:id/slides/:slideId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const slide = await Slide.findOne({ _id: req.params['slideId'], presentationId: pres._id });
  if (!slide) { res.status(404).json({ error: 'Slide not found' }); return; }

  const { sceneJSON, notes, title, thumbnail } = req.body as {
    sceneJSON?: Record<string, unknown>;
    notes?: string;
    title?: string;
    thumbnail?: string;
  };

  // Save auto-version before overwriting — only when elements actually changed
  if (sceneJSON) {
    const fp = (arr: unknown) =>
      (Array.isArray(arr) ? arr : [])
        .map((el: Record<string, unknown>) => `${String(el['id'])}:${String(el['version'] ?? 0)}`)
        .join('|');
    const oldFp = fp((slide.sceneJSON as Record<string, unknown>)['elements']);
    const newFp = fp((sceneJSON as Record<string, unknown>)['elements']);
    if (oldFp !== newFp) {
      await saveAutoVersion(slide._id.toString(), pres._id.toString(), slide.sceneJSON as Record<string, unknown>, req.user!._id.toString());
    }
    slide.sceneJSON = sceneJSON;
  }
  if (notes !== undefined) slide.notes = notes;
  if (title !== undefined) slide.title = title;
  // thumbnail is a base64 data URL capped at ~100KB to keep MongoDB lean
  if (thumbnail !== undefined) {
    const MAX_THUMB_SIZE = 100 * 1024; // 100KB
    if (thumbnail.length > MAX_THUMB_SIZE) {
      res.status(400).json({ error: `thumbnail exceeds maximum size of ${MAX_THUMB_SIZE} bytes` });
      return;
    }
    slide.thumbnail = thumbnail;
  }
  await slide.save();

  res.json({
    id: slide._id.toString(),
    index: slide.index,
    title: slide.title,
    notes: slide.notes,
    sceneJSON: slide.sceneJSON,
  });
});

/** DELETE /api/presentations/:id/slides/:slideId */
router.delete('/:id/slides/:slideId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']);
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  await Slide.deleteOne({ _id: req.params['slideId'], presentationId: pres._id });
  pres.slideCount = Math.max(0, pres.slideCount - 1);
  await pres.save();
  res.json({ message: 'Slide deleted' });
});

/* ─────────────────── Versions ─────────────────── */

/** GET /api/presentations/:id/slides/:slideId/versions */
router.get('/:id/slides/:slideId/versions', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canView(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const versions = await Version.find({ slideId: req.params['slideId'] })
    .sort({ createdAt: -1 })
    .lean();

  res.json(versions);
});

/** POST /api/presentations/:id/slides/:slideId/snapshots */
router.post('/:id/slides/:slideId/snapshots', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const slide = await Slide.findOne({ _id: req.params['slideId'], presentationId: pres._id }).lean();
  if (!slide) { res.status(404).json({ error: 'Slide not found' }); return; }

  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'Snapshot name is required' }); return; }

  const snapshot = await Version.create({
    slideId: slide._id,
    presentationId: pres._id,
    sceneJSON: slide.sceneJSON,
    type: 'snapshot',
    name: name.trim(),
    description: description?.trim(),
    createdBy: req.user!._id,
  });

  res.status(201).json(snapshot);
});

/** POST /api/presentations/:id/slides/:slideId/versions/:versionId/restore */
router.post('/:id/slides/:slideId/versions/:versionId/restore', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const version = await Version.findById(req.params['versionId']).lean();
  if (!version || version.slideId.toString() !== req.params['slideId']) {
    res.status(404).json({ error: 'Version not found' }); return;
  }

  const slide = await Slide.findById(req.params['slideId']);
  if (!slide) { res.status(404).json({ error: 'Slide not found' }); return; }

  // Save the current state as an auto-version before restoring
  await saveAutoVersion(slide._id.toString(), pres._id.toString(), slide.sceneJSON as Record<string, unknown>, req.user!._id.toString());

  slide.sceneJSON = version.sceneJSON;
  await slide.save();

  res.json({ message: 'Restored', slide: { id: slide._id, sceneJSON: slide.sceneJSON } });
});

/** DELETE /api/presentations/:id/slides/:slideId/versions/:versionId (snapshots only) */
router.delete('/:id/slides/:slideId/versions/:versionId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Not found' }); return; }
  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const version = await Version.findById(req.params['versionId']);
  if (!version || version.slideId.toString() !== req.params['slideId']) {
    res.status(404).json({ error: 'Version not found' }); return;
  }

  if (version.type !== 'snapshot') {
    res.status(400).json({ error: 'Only snapshots can be deleted; auto-versions are managed automatically' }); return;
  }

  await version.deleteOne();
  res.json({ message: 'Snapshot deleted' });
});

/* ─────────────────── Helpers ─────────────────── */

async function saveAutoVersion(
  slideId: string,
  presentationId: string,
  sceneJSON: Record<string, unknown>,
  userId: string,
): Promise<void> {
  await Version.create({
    slideId,
    presentationId,
    sceneJSON,
    type: 'auto',
    createdBy: userId,
  });

  // Prune oldest auto-versions keeping at most MAX_AUTO_VERSIONS
  const autoVersions = await Version.find({ slideId, type: 'auto' })
    .sort({ createdAt: -1 })
    .skip(MAX_AUTO_VERSIONS)
    .select('_id')
    .lean();

  if (autoVersions.length > 0) {
    await Version.deleteMany({ _id: { $in: autoVersions.map((v) => v._id) } });
  }
}

function buildVisibilityQuery(userId?: string) {
  const conditions: object[] = [{ visibility: 'public' }];
  if (userId) {
    conditions.push({ ownerUserId: userId });
    conditions.push({ editorUserIds: userId });
    conditions.push({ viewerUserIds: userId });
  }
  return { $or: conditions };
}

function userCanEdit(
  pres: { ownerUserId: unknown; editorUserIds: unknown[] },
  userId: string,
): boolean {
  return (
    pres.ownerUserId?.toString() === userId ||
    pres.editorUserIds.some((id) => id?.toString() === userId)
  );
}

export default router;
