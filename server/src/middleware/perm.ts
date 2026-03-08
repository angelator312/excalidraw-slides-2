export { canView, canEdit } from './permUtils.js';
export type { PresLike } from './permUtils.js';

import { canView, canEdit } from './permUtils.js';
import type { PresLike } from './permUtils.js';
import { Team } from '../models/team.js';

/**
 * Async check that accounts for team membership.
 * Call this when `visibility === 'team-only'` to also check team membership.
 */
export async function canViewWithTeam(
  pres: PresLike,
  userId: string | undefined,
  shareRole?: 'view' | 'edit',
): Promise<boolean> {
  if (canView(pres, userId, shareRole)) return true;
  if (!userId || pres.visibility !== 'team-only' || !pres.teamId) return false;
  const team = await Team.findById(pres.teamId).select('ownerUserId memberUserIds').lean();
  if (!team) return false;
  return (
    team.ownerUserId.toString() === userId ||
    team.memberUserIds.some((id) => id.toString() === userId)
  );
}

/**
 * Async edit check with team fallback.
 * Team owner and members with 'editor' role can edit team presentations.
 */
export async function canEditWithTeam(
  pres: PresLike,
  userId: string | undefined,
  shareRole?: 'view' | 'edit',
): Promise<boolean> {
  if (canEdit(pres, userId, shareRole)) return true;
  if (!userId || pres.visibility !== 'team-only' || !pres.teamId) return false;
  const team = await Team.findById(pres.teamId).select('ownerUserId memberUserIds memberRoles').lean();
  if (!team) return false;
  // Team owner always has edit access
  if (team.ownerUserId.toString() === userId) return true;
  // Team members with 'editor' role have edit access
  const memberRole = (team.memberRoles ?? []).find((r) => r.userId.toString() === userId);
  return memberRole?.role === 'editor';
}
