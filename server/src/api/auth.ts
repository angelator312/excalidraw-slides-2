import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { User } from '../models/user.js';
import { AuthToken } from '../models/authToken.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { JWT_SECRET } from '../config.js';

const router = Router();

const DEFAULT_INVITE_EXPIRY_HOURS = 72;

/**
 * POST /api/auth/generate-invite
 * Owner-only: generate a one-time invite token for a new user.
 */
router.post('/generate-invite', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can generate invites' });
    return;
  }

  const { username, displayName, expiryHours } = req.body as {
    username?: string;
    displayName?: string;
    expiryHours?: number;
  };

  if (!username || !displayName) {
    res.status(400).json({ error: 'username and displayName are required' });
    return;
  }

  if (!/^[a-z0-9_]{2,40}$/.test(username.toLowerCase())) {
    res.status(400).json({ error: 'Invalid username format (2-40 chars, alphanumeric + _)' });
    return;
  }

  // Check username not already taken
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  const hours = typeof expiryHours === 'number' ? expiryHours : DEFAULT_INVITE_EXPIRY_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  const token = nanoid(40);

  await AuthToken.create({
    token,
    username: username.toLowerCase(),
    displayName,
    createdBy: req.user._id,
    expiresAt,
  });

  res.json({ token, expiresAt });
});

/**
 * POST /api/auth/accept
 * Accept a one-time invite token; returns a session JWT.
 */
router.post('/accept', async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  const authToken = await AuthToken.findOne({ token, used: false });
  if (!authToken) {
    res.status(404).json({ error: 'Invalid or expired invite token' });
    return;
  }

  if (authToken.expiresAt < new Date()) {
    res.status(410).json({ error: 'Invite token has expired' });
    return;
  }

  // Mark token as used
  authToken.used = true;
  await authToken.save();

  // Create user (or return existing if somehow already created)
  let user = await User.findOne({ username: authToken.username });
  if (!user) {
    user = await User.create({
      username: authToken.username,
      displayName: authToken.displayName,
      role: 'user',
    });
  }

  const sessionToken = jwt.sign(
    { sub: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' },
  );

  res.json({ sessionToken, user: { _id: user._id, username: user.username, displayName: user.displayName, role: user.role } });
});

/**
 * POST /api/auth/anonymous
 * Create a short-lived anonymous session (viewer only).
 */
router.post('/anonymous', async (req, res) => {
  const { displayName } = req.body as { displayName?: string };
  if (!displayName || displayName.trim().length < 2) {
    res.status(400).json({ error: 'displayName must be at least 2 characters' });
    return;
  }

  const username = `anon_${nanoid(8)}`;
  const user = await User.create({
    username,
    displayName: displayName.trim().slice(0, 60),
    role: 'anonymous',
  });

  const sessionToken = jwt.sign(
    { sub: user._id.toString(), role: 'anonymous' },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  res.json({ sessionToken, user: { _id: user._id, username: user.username, displayName: user.displayName, role: user.role } });
});

/**
 * POST /api/auth/signin
 * Sign in with a long-lived auth token (the JWT returned after sign-up).
 * Verifies the token and returns the user. This supports both:
 *   - The original session JWT (short-lived, 30d)
 *   - The long-lived "auth token" given after sign-up (365d)
 */
router.post('/signin', async (req, res) => {
  const { authToken } = req.body as { authToken?: string };
  if (!authToken?.trim()) {
    res.status(400).json({ error: 'authToken is required' });
    return;
  }

  let payload: { sub: string; role: string };
  try {
    payload = jwt.verify(authToken.trim(), JWT_SECRET) as { sub: string; role: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired auth token' });
    return;
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Issue a fresh session JWT so the user is logged in
  const sessionToken = jwt.sign(
    { sub: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' },
  );

  res.json({
    sessionToken,
    user: { _id: user._id, username: user.username, displayName: user.displayName, role: user.role },
  });
});

/**
 * GET /api/auth/me
 * Return the current authenticated user.
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const u = req.user!;
  res.json({ _id: u._id, username: u.username, displayName: u.displayName, role: u.role });
});

export default router;
