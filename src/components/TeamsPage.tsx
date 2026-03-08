import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiFetch } from '../lib/api';

type TeamMemberRole = 'editor' | 'viewer';

interface Team {
  _id: string;
  name: string;
  ownerUserId: string;
  memberUserIds: string[];
  memberRoles?: Array<{ userId: string; role: TeamMemberRole }>;
  createdAt: string;
}

interface TeamMember {
  _id: string;
  username: string;
  displayName: string;
}

interface TeamDetail extends Omit<Team, 'memberUserIds'> {
  memberUserIds: TeamMember[];
}

interface Props {
  onBack: () => void;
  currentUserId: string;
}

export function TeamsPage({ onBack, currentUserId }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [createError, setCreateError] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [addMemberUsername, setAddMemberUsername] = useState('');
  const [addMemberRole, setAddMemberRole] = useState<TeamMemberRole>('viewer');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<Team[]>('/api/teams');
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTeams(); }, [loadTeams]);

  const createTeam = async (e: Event) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setCreateError('');
    setCreating(true);
    try {
      await apiFetch<Team>('/api/teams', {
        method: 'POST',
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      setNewTeamName('');
      await loadTeams();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setCreating(false);
    }
  };

  const openTeam = async (teamId: string) => {
    try {
      const data = await apiFetch<TeamDetail>(`/api/teams/${teamId}`);
      setSelectedTeam(data);
      setMemberError('');
      setAddMemberUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    }
  };

  const addMember = async () => {
    if (!selectedTeam || !addMemberUsername.trim()) return;
    setMemberError('');
    setAddingMember(true);
    try {
      await apiFetch(`/api/teams/${selectedTeam._id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: addMemberUsername.trim(), role: addMemberRole }),
      });
      setAddMemberUsername('');
      // Reload team detail
      const fresh = await apiFetch<TeamDetail>(`/api/teams/${selectedTeam._id}`);
      setSelectedTeam(fresh);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  const changeMemberRole = async (userId: string, newRole: TeamMemberRole) => {
    if (!selectedTeam) return;
    try {
      await apiFetch(`/api/teams/${selectedTeam._id}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      const fresh = await apiFetch<TeamDetail>(`/api/teams/${selectedTeam._id}`);
      setSelectedTeam(fresh);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to change role');
    }
  };

  const removeMember = async (userId: string, username: string) => {
    if (!selectedTeam) return;
    if (!confirm(`Remove ${username} from team?`)) return;
    try {
      await apiFetch(`/api/teams/${selectedTeam._id}/members/${userId}`, { method: 'DELETE' });
      const fresh = await apiFetch<TeamDetail>(`/api/teams/${selectedTeam._id}`);
      setSelectedTeam(fresh);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  /** Get role of a team member from memberRoles array */
  const getMemberRole = (team: TeamDetail, userId: string): TeamMemberRole => {
    if (userId === team.ownerUserId) return 'editor'; // owner implicitly is editor
    const roleEntry = (team.memberRoles ?? []).find((r) => r.userId === userId);
    return roleEntry?.role ?? 'viewer';
  };

  return (
    <div class="teams-page">
      <div class="teams-header">
        <button class="btn-icon teams-back-btn" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Back
        </button>
        <h1 class="teams-title">Teams</h1>
      </div>

      <div class="teams-body">
        {/* Create team */}
        <section class="teams-create-section">
          <form onSubmit={(e) => void createTeam(e)} class="teams-create-form">
            <input
              type="text"
              placeholder="New team name…"
              value={newTeamName}
              onInput={(e) => setNewTeamName((e.target as HTMLInputElement).value)}
              maxLength={80}
              required
              aria-label="New team name"
              class="teams-create-input"
            />
            <button type="submit" class="btn-primary" disabled={creating || !newTeamName.trim()}>
              {creating ? 'Creating…' : '+ Create team'}
            </button>
          </form>
          {createError && <p class="error-msg" role="alert">{createError}</p>}
        </section>

        {loading && <div class="loading-placeholder"><div class="spinner"/></div>}
        {error && <p class="error-msg" role="alert">{error}</p>}

        {/* Teams list */}
        {!loading && !error && (
          <div class="teams-grid">
            {teams.length === 0 && (
              <p class="text-muted teams-empty">No teams yet. Create one above.</p>
            )}
            {teams.map((t) => (
              <button
                key={t._id}
                class={`teams-card ${selectedTeam?._id === t._id ? 'teams-card--active' : ''}`}
                onClick={() => void openTeam(t._id)}
              >
                <span class="teams-card-avatar">{getInitials(t.name)}</span>
                <div class="teams-card-info">
                  <span class="teams-card-name">{t.name}</span>
                  <span class="teams-card-meta">{t.memberUserIds.length} member{t.memberUserIds.length !== 1 ? 's' : ''}</span>
                </div>
                {t.ownerUserId === currentUserId && (
                  <span class="teams-card-owner-badge">Owner</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Team detail panel */}
        {selectedTeam && (
          <div class="teams-detail">
            <div class="teams-detail-header">
              <h2>{selectedTeam.name}</h2>
              <button class="btn-icon" onClick={() => setSelectedTeam(null)} aria-label="Close">✕</button>
            </div>

            <ul class="editors-list">
              {(selectedTeam.memberUserIds as TeamMember[]).map((m) => (
                <li key={m._id} class="editor-item">
                  <span class="editor-avatar">{getInitials(m.displayName || m.username)}</span>
                  <div class="editor-info">
                    <span class="editor-name">{m.displayName}</span>
                    <span class="editor-username text-muted">@{m.username}</span>
                  </div>
                  {m._id === selectedTeam.ownerUserId ? (
                    <span class="teams-owner-tag">Owner</span>
                  ) : selectedTeam.ownerUserId === currentUserId ? (
                    <select
                      class="collab-role-select"
                      value={getMemberRole(selectedTeam, m._id)}
                      onChange={(e) => void changeMemberRole(m._id, (e.target as HTMLSelectElement).value as TeamMemberRole)}
                      aria-label={`Role for ${m.username}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span class={`collab-role-badge collab-role-badge--${getMemberRole(selectedTeam, m._id)}`}>
                      {getMemberRole(selectedTeam, m._id) === 'editor' ? 'Editor' : 'Viewer'}
                    </span>
                  )}
                  {selectedTeam.ownerUserId === currentUserId && m._id !== currentUserId && (
                    <button
                      class="btn-icon btn-danger-ghost btn-sm"
                      onClick={() => void removeMember(m._id, m.username)}
                      aria-label={`Remove ${m.username}`}
                      title="Remove member"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {selectedTeam.ownerUserId === currentUserId && (
              <div class="add-editor-row">
                <input
                  type="text"
                  placeholder="Add member by username…"
                  value={addMemberUsername}
                  onInput={(e) => setAddMemberUsername((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addMember(); } }}
                  maxLength={40}
                  aria-label="Add member by username"
                />
                <select
                  class="collab-role-select"
                  value={addMemberRole}
                  onChange={(e) => setAddMemberRole((e.target as HTMLSelectElement).value as TeamMemberRole)}
                  aria-label="Role for new member"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  class="btn-secondary"
                  onClick={() => void addMember()}
                  type="button"
                  disabled={addingMember || !addMemberUsername.trim()}
                >
                  {addingMember ? '…' : 'Add'}
                </button>
              </div>
            )}
            {memberError && <p class="error-msg" role="alert" style="margin-top:6px">{memberError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
