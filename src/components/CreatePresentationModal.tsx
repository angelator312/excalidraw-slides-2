import { useState } from 'preact/hooks';
import { apiFetch } from '../lib/api';

interface Props {
  onClose: () => void;
  onCreate: () => void;
}

export function CreatePresentationModal({ onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'team-only'>('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    setLoading(true);
    try {
      await apiFetch('/api/presentations', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), visibility }),
      });
      onCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create presentation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Presentation">
      <div class="modal-box">
        <div class="modal-header">
          <h2>New Presentation</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} class="modal-form">
          <label htmlFor="pres-title">Title</label>
          <input
            id="pres-title"
            type="text"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            placeholder="My awesome presentation"
            maxLength={120}
            required
          />

          <label htmlFor="pres-visibility">Visibility</label>
          <select
            id="pres-visibility"
            value={visibility}
            onChange={(e) => setVisibility((e.target as HTMLSelectElement).value as typeof visibility)}
          >
            <option value="private">Private – only you and explicit editors</option>
            <option value="team-only">Team only – your team can view/edit</option>
            <option value="public">Public – anyone can view</option>
          </select>

          {error && <p class="error-msg" role="alert">{error}</p>}

          <div class="modal-actions">
            <button type="button" class="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" class="btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
