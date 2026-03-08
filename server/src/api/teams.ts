import { Router } from 'express';
import { Types } from 'mongoose';
import { Team } from '../models/team.js';
import type { TeamMemberRole } from '../models/team.js';
import { User } from '../models/user.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/teams
 * Create a team on demand. The authenticated user becomes the owner.
 */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Team name is required' });
    return;
  }
  const team = await Team.create({
    name: name.trim(),
    ownerUserId: req.user!._id,
    memberUserIds: [req.user!._id],
  });
  res.status(201).json(team);
});

/**
 * GET /api/teams
 * List teams the current user owns or is a member of.
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const teams = await Team.find({
    $or: [
      { ownerUserId: req.user!._id },
      { memberUserIds: req.user!._id },
    ],
  }).lean();
  res.json(teams);
});

/**
 * GET /api/teams/:id
 * Get team details including members.
 */
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  // First check membership using raw IDs (before populate)
  const teamRaw = await Team.findById(req.params['id']).lean();
  if (!teamRaw) { res.status(404).json({ error: 'Team not found' }); return; }
  if (!isTeamMember(teamRaw, req.user!._id.toString())) {
    res.status(403).json({ error: 'Not a member of this team' });
    return;
  }
  // Populate for full member details
  const team = await Team.findById(req.params['id']).populate('memberUserIds', 'username displayName').lean();
  res.json(team);
});

/**
 * POST /api/teams/:id/members
 * Owner adds a member by username, optionally with a role (default: 'viewer').
 */
router.post('/:id/members', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { username, role } = req.body as { username?: string; role?: TeamMemberRole };
  if (!username?.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  const memberRole: TeamMemberRole = role === 'editor' ? 'editor' : 'viewer';

  const team = await Team.findById(req.params['id']);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
  if (team.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the team owner can add members' });
    return;
  }

  const targetUser = await User.findOne({ username: username.trim().toLowerCase() });
  if (!targetUser) {
    res.status(404).json({ error: `User "${username}" not found` });
    return;
  }

  const alreadyMember = team.memberUserIds.some((id) => id.toString() === targetUser._id.toString());
  if (alreadyMember) {
    res.status(409).json({ error: 'User is already a member' });
    return;
  }

  team.memberUserIds.push(targetUser._id);
  team.memberRoles.push({ userId: targetUser._id, role: memberRole });
  await team.save();

  res.json({ message: 'Member added', userId: targetUser._id, username: targetUser.username, role: memberRole });
});

/**
 * PATCH /api/teams/:id/members/:userId/role
 * Owner changes a member's role.
 */
router.patch('/:id/members/:userId/role', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { role } = req.body as { role?: TeamMemberRole };
  if (role !== 'editor' && role !== 'viewer') {
    res.status(400).json({ error: 'role must be "editor" or "viewer"' });
    return;
  }

  const team = await Team.findById(req.params['id']);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
  if (team.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the team owner can change roles' });
    return;
  }

  const targetId = req.params['userId'];
  if (targetId === team.ownerUserId.toString()) {
    res.status(400).json({ error: 'Cannot change the role of the team owner' });
    return;
  }

  const isMember = team.memberUserIds.some((id) => id.toString() === targetId);
  if (!isMember) { res.status(404).json({ error: 'User is not a member of this team' }); return; }

  const existingRole = team.memberRoles.find((r) => r.userId.toString() === targetId);
  if (existingRole) {
    existingRole.role = role;
  } else {
    // Legacy member without a role entry — create one
    team.memberRoles.push({ userId: new Types.ObjectId(targetId), role });
  }
  await team.save();
  res.json({ message: 'Role updated', userId: targetId, role });
});

/**
 * DELETE /api/teams/:id/members/:userId
 * Owner removes a member.
 */
router.delete('/:id/members/:userId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const team = await Team.findById(req.params['id']);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
  if (team.ownerUserId.toString() !== req.user!._id.toString()) {
    res.status(403).json({ error: 'Only the team owner can remove members' });
    return;
  }

  const targetId = req.params['userId'];
  if (targetId === team.ownerUserId.toString()) {
    res.status(400).json({ error: 'Cannot remove the team owner' });
    return;
  }

  team.memberUserIds = team.memberUserIds.filter((id) => id.toString() !== targetId);
  team.memberRoles = team.memberRoles.filter((r) => r.userId.toString() !== targetId);
  await team.save();
  res.json({ message: 'Member removed' });
});

/**
 * GET /api/teams/search/users?q=username
 * Search registered (non-anonymous) users by username prefix.
 */
router.get('/search/users', requireAuth, async (req, res) => {
  const q = String(req.query['q'] ?? '').trim().toLowerCase();
  if (q.length < 2) {
    res.status(400).json({ error: 'Search query must be at least 2 characters' });
    return;
  }
  const users = await User.find({
    username: { $regex: `^${escapeRegex(q)}`, $options: 'i' },
    role: { $ne: 'anonymous' },
  })
    .select('username displayName')
    .limit(10)
    .lean();
  res.json(users);
});

function isTeamMember(team: { ownerUserId: unknown; memberUserIds: unknown[] }, userId: string): boolean {
  return (
    team.ownerUserId?.toString() === userId ||
    team.memberUserIds.some((id) => id?.toString() === userId)
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default router;
