import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import type { PresentationDetail } from '../components/PresentationEditor';

interface Team {
  _id: string;
  name: string;
}

type CollabRole = 'editor' | 'viewer';

interface Collaborator {
  _id: string;
  username: string;
  displayName: string;
  role: CollabRole;
}

interface Props {
  presentation: PresentationDetail;
  onClose: () => void;
  onSave: () => void;
}

export function SettingsModal({ presentation, onClose, onSave }: Props) {
  const [title, setTitle] = useState(presentation.title);
  const [visibility, setVisibility] = useState(presentation.visibility);
  const [thumbnailMode, setThumbnailMode] = useState<'first-slide' | 'grid'>(
    presentation.thumbnailMode ?? 'first-slide',
  );
  const [teamId, setTeamId] = useState(presentation.teamId ?? '');
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoadError, setTeamsLoadError] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addRole, setAddRole] = useState<CollabRole>('editor');
  const [collaborators, setCollaborators] = useState<Collaborator[]>(
    presentation.collaborators ?? presentation.editors?.map((e) => ({ ...e, role: 'editor' as const })) ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setCollaborators(
      presentation.collaborators ?? presentation.editors?.map((e) => ({ ...e, role: 'editor' as const })) ?? [],
    );
  }, [presentation.collaborators, presentation.editors]);

  // Load teams for the team-only selector
  useEffect(() => {
    apiFetch<Team[]>('/api/teams')
      .then((data) => setTeams(data))
      .catch(() => { setTeamsLoadError('Could not load teams'); });
  }, []);

  const reloadCollaborators = async () => {
    const fresh = await apiFetch<PresentationDetail>(`/api/presentations/${presentation._id}`);
    setCollaborators(
      fresh.collaborators ?? fresh.editors?.map((e) => ({ ...e, role: 'editor' as const })) ?? [],
    );
  };

  const handleSave = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    if (visibility === 'team-only' && !teamId) { setError('Select a team for team-only visibility'); return; }
    setError('');
    setLoading(true);
    try {
      await apiFetch(`/api/presentations/${presentation._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          visibility,
          thumbnailMode,
          teamId: visibility === 'team-only' ? teamId : null,
        }),
      });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const addCollaborator = async () => {
    if (!addUsername.trim()) return;
    setError('');
    setAdding(true);
    try {
      await apiFetch(`/api/presentations/${presentation._id}/editors`, {
        method: 'POST',
        body: JSON.stringify({ username: addUsername.trim() }),
      });
      setAddUsername('');
      await reloadCollaborators();
      // If role should be viewer, change it after adding
      if (addRole === 'viewer') {
        const fresh = await apiFetch<PresentationDetail>(`/api/presentations/${presentation._id}`);
        const added = (fresh.collaborators ?? []).find((c) => c.username.toLowerCase() === addUsername.trim().toLowerCase());
        if (added) {
          await apiFetch(`/api/presentations/${presentation._id}/collaborators/${added._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: 'viewer' }),
          });
          await reloadCollaborators();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add collaborator');
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (userId: string, newRole: CollabRole) => {
    try {
      await apiFetch(`/api/presentations/${presentation._id}/collaborators/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      setCollaborators((prev) => prev.map((c) => c._id === userId ? { ...c, role: newRole } : c));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  };

  const removeCollaborator = async (userId: string, username: string) => {
    if (!confirm(`Remove ${username} from collaborators?`)) return;
    try {
      await apiFetch(`/api/presentations/${presentation._id}/editors/${userId}`, { method: 'DELETE' });
      setCollaborators((prev) => prev.filter((c) => c._id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove collaborator');
    }
  };

  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Presentation Settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div class="modal-box settings-modal-box">
        <div class="modal-header">
          <h2>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="vertical-align:-3px;margin-right:6px">
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Presentation Settings
          </h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSave} class="modal-form">
          <label htmlFor="settings-title">Title</label>
          <input
            id="settings-title"
            type="text"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            maxLength={120}
            required
          />

          <label htmlFor="settings-visibility">Visibility</label>
          <select
            id="settings-visibility"
            value={visibility}
            onChange={(e) =>
              setVisibility((e.target as HTMLSelectElement).value as typeof visibility)
            }
          >
            <option value="private">🔒 Private – only explicit collaborators</option>
            <option value="team-only">👥 Team only</option>
            <option value="public">🌐 Public – anyone can view</option>
          </select>

          {visibility === 'team-only' && (
            <>
              <label htmlFor="settings-team">Team</label>
              <select
                id="settings-team"
                value={teamId}
                onChange={(e) => setTeamId((e.target as HTMLSelectElement).value)}
                required
              >
                <option value="">— Select a team —</option>
                {teams.map((t) => (
                  <option key={t._id} value={t._id}>{t.name}</option>
                ))}
              </select>
              {teamsLoadError ? (
                <p class="error-msg" role="alert" style="margin-top:-4px">{teamsLoadError}</p>
              ) : teams.length === 0 ? (
                <p class="login-hint" style="margin-top:-4px;color:var(--color-warning)">
                  You have no teams yet. Create one from the Teams page.
                </p>
              ) : null}
            </>
          )}

          <label htmlFor="settings-thumbnail">Presentation thumbnail</label>
          <select
            id="settings-thumbnail"
            value={thumbnailMode}
            onChange={(e) =>
              setThumbnailMode((e.target as HTMLSelectElement).value as typeof thumbnailMode)
            }
          >
            <option value="first-slide">First slide preview</option>
            <option value="grid">All slides grid</option>
          </select>
          <p class="login-hint" style="margin-top:-6px">Controls how this presentation appears on the dashboard.</p>

          {error && <p class="error-msg" role="alert">{error}</p>}

          <div class="modal-actions">
            <button type="button" class="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        {presentation.canEdit && (
          <div class="settings-editors-section">
            <h3>Collaborators ({collaborators.length})</h3>
            <p class="login-hint" style="margin-top:-6px;margin-bottom:8px">
              <strong>Editor</strong> — can edit, export, manage collaborators &amp; settings.
              {' '}<strong>Viewer</strong> — can view only.
            </p>
            {collaborators.length > 0 ? (
              <ul class="editors-list">
                {collaborators.map((c) => (
                  <li key={c._id} class="editor-item">
                    <span class="editor-avatar">{getInitials(c.displayName || c.username)}</span>
                    <div class="editor-info">
                      <span class="editor-name">{c.displayName || c.username}</span>
                      <span class="editor-username text-muted">@{c.username}</span>
                    </div>
                    <select
                      class="collab-role-select"
                      value={c.role}
                      onChange={(e) => void changeRole(c._id, (e.target as HTMLSelectElement).value as CollabRole)}
                      aria-label={`Role for ${c.username}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      class="btn-icon btn-danger-ghost btn-sm"
                      onClick={() => void removeCollaborator(c._id, c.username)}
                      aria-label={`Remove ${c.username}`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="text-muted" style="font-size:0.85rem">No collaborators yet.</p>
            )}

            <div class="add-editor-row">
              <input
                type="text"
                placeholder="Add by username…"
                value={addUsername}
                onInput={(e) => setAddUsername((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCollaborator(); } }}
                maxLength={40}
                aria-label="Username to add as collaborator"
              />
              <select
                class="collab-role-select"
                value={addRole}
                onChange={(e) => setAddRole((e.target as HTMLSelectElement).value as CollabRole)}
                aria-label="Role for new collaborator"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                class="btn-secondary"
                onClick={addCollaborator}
                type="button"
                disabled={adding}
              >
                {adding ? '…' : '+ Add'}
              </button>
            </div>
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

