/**
 * Pure (synchronous) ACL helpers – no DB dependency.
 * These can be imported from both client and server test environments.
 */

export type Visibility = 'public' | 'private' | 'team-only';

export interface PresLike {
  ownerUserId: { toString(): string };
  visibility: Visibility;
  editorUserIds: Array<{ toString(): string }>;
  viewerUserIds: Array<{ toString(): string }>;
  teamId?: unknown;
}

/**
 * Returns true if `userId` (or the share link role) grants VIEW access.
 * Does NOT check team membership (async). Call canViewWithTeam for that.
 */
export function canView(
  pres: PresLike,
  userId: string | undefined,
  shareRole?: 'view' | 'edit',
): boolean {
  if (pres.visibility === 'public') return true;
  if (shareRole === 'view' || shareRole === 'edit') return true;
  if (!userId) return false;
  if (pres.ownerUserId.toString() === userId) return true;
  if (pres.editorUserIds.some((id) => id.toString() === userId)) return true;
  if (pres.viewerUserIds.some((id) => id.toString() === userId)) return true;
  return false;
}

/**
 * Returns true if `userId` (or the share link role) grants EDIT access.
 * Does NOT check team membership (async). Call canEditWithTeam for that.
 */
export function canEdit(
  pres: PresLike,
  userId: string | undefined,
  shareRole?: 'view' | 'edit',
): boolean {
  if (!userId && shareRole !== 'edit') return false;
  if (shareRole === 'edit') return true;
  if (!userId) return false;
  if (pres.ownerUserId.toString() === userId) return true;
  if (pres.editorUserIds.some((id) => id.toString() === userId)) return true;
  return false;
}
