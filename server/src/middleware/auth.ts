import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.js';
import { ShareLink } from '../models/sharelink.js';
import type { IUser } from '../models/user.js';
import { JWT_SECRET } from '../config.js';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  /** Role granted via a share link token */
  shareRole?: 'view' | 'edit';
}

/**
 * Resolve the authenticated user from the Authorization header.
 * Also checks for a share link token in the ?share= query param.
 * Does NOT reject unauthenticated requests; use requireAuth for that.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
      const user = await User.findById(payload.sub);
      if (user) {
        req.user = user;
        user.lastSeen = new Date();
        void user.save(); // fire-and-forget
      }
    } catch { /* invalid token — continue as anonymous */ }
  }

  // Check share link
  const shareToken = req.query['share'] as string | undefined;
  if (shareToken) {
    const link = await ShareLink.findOne({ token: shareToken });
    if (link && (!link.expiresAt || link.expiresAt > new Date())) {
      req.shareRole = link.role;
      // Attach presentation id for downstream checks
      (req as Request & { sharePresentationId?: string }).sharePresentationId =
        link.presentationId.toString();
    }
  }

  next();
}

/**
 * Reject unauthenticated requests (requires a valid Bearer JWT).
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await optionalAuth(req, res, () => {});
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
