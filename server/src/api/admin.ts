import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { InviteToken } from '../models/inviteToken.js';
import { ImpersonationAudit } from '../models/impersonationAudit.js';
import { User } from '../models/user.js';
import { requireOwner } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  JWT_SECRET,
  SITE_ORIGIN,
  ALLOW_IMPERSONATION,
  DEFAULT_INVITE_EXPIRY_DAYS,
  DEFAULT_INVITE_MAX_USES,
  IMPERSONATION_JWT_EXPIRY,
} from '../config.js';

const router = Router();

/* ──────────────────────── Invite tokens ──────────────────────── */

/**
 * POST /api/admin/invite
 * Create a new invite token.
 * Body: { email?, expiresInDays?, maxUses? }
 */
router.post('/invite', requireOwner, async (req: AuthenticatedRequest, res) => {
  const {
    email,
    expiresInDays,
    maxUses,
  } = req.body as {
    email?: string;
    expiresInDays?: number;
    maxUses?: number;
  };

  const days =
    typeof expiresInDays === 'number' && expiresInDays > 0
      ? expiresInDays
      : DEFAULT_INVITE_EXPIRY_DAYS;

  const uses =
    typeof maxUses === 'number' && maxUses > 0 ? maxUses : DEFAULT_INVITE_MAX_USES;

  if (uses > 100) {
    res.status(400).json({ error: 'maxUses cannot exceed 100' });
    return;
  }

  const expiresAt = new Date(Date.now() + days * 86_400_000);
  // Generate cryptographically random token (32 bytes → 64 hex chars)
  const token = crypto.randomBytes(32).toString('hex');

  const inviteToken = await InviteToken.create({
    token,
    email: email?.trim().toLowerCase() || undefined,
    createdBy: req.user!._id,
    expiresAt,
    maxUses: uses,
    uses: 0,
  });

  const link = `${SITE_ORIGIN}/invite/accept?token=${token}`;

  res.status(201).json({
    token,
    link,
    email: inviteToken.email,
    expiresAt: inviteToken.expiresAt,
    maxUses: inviteToken.maxUses,
  });
});

/**
 * POST /api/admin/invite/:token/revoke
 * Revoke an invite token (owner only).
 */
router.post('/invite/:token/revoke', requireOwner, async (req: AuthenticatedRequest, res) => {
  const inviteToken = await InviteToken.findOne({ token: req.params['token'] });
  if (!inviteToken) {
    res.status(404).json({ error: 'Invite token not found' });
    return;
  }

  if (inviteToken.revokedAt) {
    res.status(409).json({ error: 'Token is already revoked' });
    return;
  }

  inviteToken.revokedAt = new Date();
  await inviteToken.save();

  res.json({ message: 'Token revoked', revokedAt: inviteToken.revokedAt });
});

/**
 * POST /api/admin/invite/accept
 * Accept an invite token; creates a user account and returns a session JWT.
 * Body: { token, username, displayName }
 */
router.post('/invite/accept', async (req, res) => {
  const { token, username, displayName } = req.body as {
    token?: string;
    username?: string;
    displayName?: string;
  };

  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (!username?.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (!displayName?.trim()) {
    res.status(400).json({ error: 'displayName is required' });
    return;
  }
  if (!/^[a-z0-9_]{2,40}$/.test(username.trim().toLowerCase())) {
    res.status(400).json({
      error: 'Invalid username format (2-40 chars, alphanumeric + _)',
    });
    return;
  }

  const inviteToken = await InviteToken.findOne({ token });
  if (!inviteToken) {
    res.status(404).json({ error: 'Invalid invite token' });
    return;
  }

  // Validate token is still usable
  if (inviteToken.revokedAt) {
    res.status(410).json({ error: 'Invite token has been revoked' });
    return;
  }
  if (inviteToken.expiresAt < new Date()) {
    res.status(410).json({ error: 'Invite token has expired' });
    return;
  }
  if (inviteToken.uses >= inviteToken.maxUses) {
    res.status(410).json({ error: 'Invite token has reached its maximum use count' });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();

  // Check username not already taken
  const existing = await User.findOne({ username: normalizedUsername });
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  // Increment uses
  inviteToken.uses += 1;
  await inviteToken.save();

  // Create user
  const user = await User.create({
    username: normalizedUsername,
    displayName: displayName.trim().slice(0, 60),
    role: 'user',
  });

  const sessionToken = jwt.sign(
    { sub: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' },
  );

  // Also issue a long-lived auth token (365d) that the user can paste to sign in later
  const longLivedToken = jwt.sign(
    { sub: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '365d' },
  );

  res.status(201).json({
    sessionToken,
    authToken: longLivedToken,
    user: {
      _id: user._id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  });
});

/**
 * GET /api/admin/invite
 * List all invite tokens (owner only).
 */
router.get('/invite', requireOwner, async (_req, res) => {
  const tokens = await InviteToken.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(tokens);
});

/**
 * GET /api/admin/invite/check?token=...
 * Public — validate whether an invite token is still usable (no auth required).
 * Returns 200 { valid: true } or an error message.
 */
router.get('/invite/check', async (req, res) => {
  const token = (req.query['token'] as string | undefined)?.trim();
  if (!token) {
    res.status(400).json({ error: 'token query param is required' });
    return;
  }
  const inviteToken = await InviteToken.findOne({ token });
  if (!inviteToken) {
    res.status(404).json({ error: 'Invalid invite token' });
    return;
  }
  if (inviteToken.revokedAt) {
    res.status(410).json({ error: 'Invite token has been revoked' });
    return;
  }
  if (inviteToken.expiresAt < new Date()) {
    res.status(410).json({ error: 'Invite token has expired' });
    return;
  }
  if (inviteToken.uses >= inviteToken.maxUses) {
    res.status(410).json({ error: 'Invite token has reached its maximum use count' });
    return;
  }
  res.json({ valid: true });
});

/**
 * PATCH /api/admin/users/:id/role
 * Change a user's role (owner only). Cannot change own role.
 */
router.patch('/users/:id/role', requireOwner, async (req: AuthenticatedRequest, res) => {
  const { role } = req.body as { role?: string };
  const allowedRoles = ['owner', 'user'];
  if (!role || !allowedRoles.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${allowedRoles.join(', ')}` });
    return;
  }

  const targetUser = await User.findById(req.params['id']);
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (targetUser.role === 'anonymous') {
    res.status(400).json({ error: 'Cannot change role of anonymous users' });
    return;
  }

  if (req.user!._id.toString() === targetUser._id.toString()) {
    res.status(400).json({ error: 'You cannot change your own role' });
    return;
  }

  targetUser.role = role as 'owner' | 'user';
  await targetUser.save();

  res.json({
    _id: targetUser._id,
    username: targetUser.username,
    displayName: targetUser.displayName,
    role: targetUser.role,
  });
});

/**
 * GET /api/admin/users
 * List all registered (non-anonymous) users (owner only).
 */
router.get('/users', requireOwner, async (_req, res) => {
  const userList = await User.find({ role: { $ne: 'anonymous' } })
    .select('_id username displayName role createdAt')
    .sort({ createdAt: -1 })
    .lean();
  res.json(userList);
});

/* ──────────────────────── Impersonation ──────────────────────── */

/**
 * POST /api/admin/impersonate/:userId
 * Owner impersonates a user; creates ephemeral JWT with impersonatedBy claim.
 * Body: { reason? }
 *
 * Requires ALLOW_IMPERSONATION=true in environment.
 */
router.post('/impersonate/:userId', requireOwner, async (req: AuthenticatedRequest, res) => {
  if (!ALLOW_IMPERSONATION) {
    res.status(403).json({
      error: 'Impersonation is disabled. Set ALLOW_IMPERSONATION=true to enable it.',
    });
    return;
  }

  const { reason } = req.body as { reason?: string };
  const targetUserId = req.params['userId'];

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: 'Target user not found' });
    return;
  }

  if (targetUser.role === 'owner') {
    res.status(403).json({ error: 'Cannot impersonate another owner' });
    return;
  }

  // Capture client IP
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  // Write audit record
  await ImpersonationAudit.create({
    adminId: req.user!._id,
    targetUserId: targetUser._id,
    action: 'start',
    reason: reason?.trim().slice(0, 500),
    ip,
  });

  // Issue ephemeral JWT (1 hour)
  const ephemeralToken = jwt.sign(
    {
      sub: targetUser._id.toString(),
      role: targetUser.role,
      impersonatedBy: req.user!._id.toString(),
    },
    JWT_SECRET,
    { expiresIn: IMPERSONATION_JWT_EXPIRY },
  );

  res.json({
    sessionToken: ephemeralToken,
    expiresIn: IMPERSONATION_JWT_EXPIRY,
    targetUser: {
      _id: targetUser._id,
      username: targetUser.username,
      displayName: targetUser.displayName,
      role: targetUser.role,
    },
  });
});

/* ──────────────────────── Audit log ──────────────────────── */

/**
 * GET /api/admin/audit
 * List impersonation audit entries (owner only).
 * Query: ?page=1&limit=50
 */
router.get('/audit', requireOwner, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10)));
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ImpersonationAudit.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('adminId', 'username displayName')
      .populate('targetUserId', 'username displayName')
      .lean(),
    ImpersonationAudit.countDocuments(),
  ]);

  res.json({ entries, total, page, limit });
});

export default router;
