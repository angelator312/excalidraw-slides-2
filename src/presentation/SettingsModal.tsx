import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import type { PresentationDetail } from '../components/PresentationEditor';

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
  const [editorUsername, setEditorUsername] = useState('');
  const [editors, setEditors] = useState(presentation.editors ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addingEditor, setAddingEditor] = useState(false);

  useEffect(() => {
    setEditors(presentation.editors ?? []);
  }, [presentation.editors]);

  const handleSave = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    setLoading(true);
    try {
      await apiFetch(`/api/presentations/${presentation._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), visibility, thumbnailMode }),
      });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const addEditor = async () => {
    if (!editorUsername.trim()) return;
    setError('');
    setAddingEditor(true);
    try {
      await apiFetch(`/api/presentations/${presentation._id}/editors`, {
        method: 'POST',
        body: JSON.stringify({ username: editorUsername.trim() }),
      });
      setEditorUsername('');
      // Reload editors list from server
      const fresh = await apiFetch<PresentationDetail>(`/api/presentations/${presentation._id}`);
      setEditors(fresh.editors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add editor');
    } finally {
      setAddingEditor(false);
    }
  };

  const removeEditor = async (userId: string, username: string) => {
    if (!confirm(`Remove ${username} as editor?`)) return;
    try {
      await apiFetch(`/api/presentations/${presentation._id}/editors/${userId}`, { method: 'DELETE' });
      setEditors((prev) => prev.filter((e) => e._id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove editor');
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
            <option value="private">🔒 Private – only explicit editors</option>
            <option value="team-only">👥 Team only</option>
            <option value="public">🌐 Public – anyone can view</option>
          </select>

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
            <h3>Editors ({editors.length})</h3>
            {editors.length > 0 ? (
              <ul class="editors-list">
                {editors.map((e) => (
                  <li key={e._id} class="editor-item">
                    <span class="editor-avatar">{getInitials(e.displayName || e.username)}</span>
                    <div class="editor-info">
                      <span class="editor-name">{e.displayName}</span>
                      <span class="editor-username text-muted">@{e.username}</span>
                    </div>
                    <button
                      class="btn-icon btn-danger-ghost btn-sm"
                      onClick={() => void removeEditor(e._id, e.username)}
                      aria-label={`Remove ${e.username} as editor`}
                      title="Remove editor"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="text-muted" style="font-size:0.85rem">No additional editors yet.</p>
            )}

            <div class="add-editor-row">
              <input
                type="text"
                placeholder="Add by username…"
                value={editorUsername}
                onInput={(e) => setEditorUsername((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addEditor(); } }}
                maxLength={40}
                aria-label="Username to add as editor"
              />
              <button
                class="btn-secondary"
                onClick={addEditor}
                type="button"
                disabled={addingEditor}
              >
                {addingEditor ? '…' : 'Add'}
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
