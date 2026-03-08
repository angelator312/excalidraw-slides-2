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
  /** Present when the JWT is an impersonation token */
  impersonatedBy?: string;
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
      const payload = jwt.verify(token, JWT_SECRET) as {
        sub: string;
        role: string;
        impersonatedBy?: string;
      };
      const user = await User.findById(payload.sub);
      if (user) {
        req.user = user;
        // Carry impersonation metadata so downstream handlers can inspect it
        if (payload.impersonatedBy) {
          req.impersonatedBy = payload.impersonatedBy;
        } else {
          user.lastSeen = new Date();
          void user.save(); // fire-and-forget (skip for impersonation tokens)
        }
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

/**
 * Require the caller to be the owner (DB admin role).
 * Impersonation tokens are never treated as owner-role requests.
 */
export async function requireOwner(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await optionalAuth(req, res, () => {});
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'owner' || req.impersonatedBy) {
    res.status(403).json({ error: 'Owner role required' });
    return;
  }
  next();
}
