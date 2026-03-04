import { useState } from 'preact/hooks';
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
  const [editorUsername, setEditorUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    setLoading(true);
    try {
      await apiFetch(`/api/presentations/${presentation._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), visibility }),
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
    try {
      await apiFetch(`/api/presentations/${presentation._id}/editors`, {
        method: 'POST',
        body: JSON.stringify({ username: editorUsername.trim() }),
      });
      setEditorUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add editor');
    }
  };

  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Presentation Settings">
      <div class="modal-box">
        <div class="modal-header">
          <h2>Settings</h2>
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
            <option value="private">Private – only explicit editors</option>
            <option value="team-only">Team only</option>
            <option value="public">Public – anyone can view</option>
          </select>

          {error && <p class="error-msg" role="alert">{error}</p>}

          <div class="modal-actions">
            <button type="button" class="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        {presentation.canEdit && (
          <div class="add-editor-section">
            <h3>Add editor by username</h3>
            <div class="share-form-row">
              <input
                type="text"
                placeholder="Username"
                value={editorUsername}
                onInput={(e) => setEditorUsername((e.target as HTMLInputElement).value)}
                maxLength={40}
                aria-label="Username to add as editor"
              />
              <button class="btn-secondary" onClick={addEditor} type="button">
                Add
              </button>
            </div>
            <p class="login-hint">Users must already be registered to be added as editors.</p>
          </div>
        )}
      </div>
    </div>
  );
}
