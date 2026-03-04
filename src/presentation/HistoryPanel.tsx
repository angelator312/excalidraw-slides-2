import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';

interface Version {
  _id: string;
  type: 'auto' | 'snapshot';
  name?: string;
  description?: string;
  createdAt: string;
  userId?: string;
}

interface Props {
  presentationId: string;
  slideId: string;
  onClose: () => void;
  onRestore: () => void;
}

export function HistoryPanel({ presentationId, slideId, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapName, setSnapName] = useState('');
  const [snapDesc, setSnapDesc] = useState('');
  const [savingSnap, setSavingSnap] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slideId) return;
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Version[]>(
        `/api/presentations/${presentationId}/slides/${slideId}/versions`,
      );
      setVersions(data);
    } finally {
      setLoading(false);
    }
  };

  const createSnapshot = async (e: Event) => {
    e.preventDefault();
    if (!snapName.trim()) { setError('Snapshot name is required'); return; }
    setSavingSnap(true);
    setError('');
    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slideId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ name: snapName.trim(), description: snapDesc.trim() }),
      });
      setSnapName('');
      setSnapDesc('');
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save snapshot');
    } finally {
      setSavingSnap(false);
    }
  };

  const restore = async (versionId: string) => {
    if (!confirm('Restore this version? Current slide will be replaced.')) return;
    try {
      await apiFetch(
        `/api/presentations/${presentationId}/slides/${slideId}/versions/${versionId}/restore`,
        { method: 'POST' },
      );
      onRestore();
    } catch { /* ignore */ }
  };

  const deleteSnapshot = async (versionId: string) => {
    if (!confirm('Delete this snapshot?')) return;
    try {
      await apiFetch(
        `/api/presentations/${presentationId}/slides/${slideId}/versions/${versionId}`,
        { method: 'DELETE' },
      );
      await loadVersions();
    } catch { /* ignore */ }
  };

  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Slide History">
      <div class="modal-box modal-wide">
        <div class="modal-header">
          <h2>Slide History</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={createSnapshot} class="snapshot-form">
          <h3>Save snapshot</h3>
          <input
            type="text"
            placeholder="Snapshot name"
            value={snapName}
            onInput={(e) => setSnapName((e.target as HTMLInputElement).value)}
            required
            maxLength={80}
          />
          <textarea
            placeholder="Description (optional)"
            value={snapDesc}
            onInput={(e) => setSnapDesc((e.target as HTMLTextAreaElement).value)}
            rows={2}
            maxLength={300}
          />
          {error && <p class="error-msg">{error}</p>}
          <button type="submit" class="btn-primary" disabled={savingSnap}>
            {savingSnap ? 'Saving…' : 'Save Snapshot'}
          </button>
        </form>

        <div class="version-list">
          <h3>Versions</h3>
          {loading ? (
            <p>Loading…</p>
          ) : versions.length === 0 ? (
            <p class="text-muted">No versions yet.</p>
          ) : (
            <ul>
              {versions.map((v) => (
                <li key={v._id} class="version-item">
                  <div class="version-meta">
                    <span class={`version-type ${v.type}`}>{v.type}</span>
                    {v.name && <strong>{v.name}</strong>}
                    <span class="text-muted">{new Date(v.createdAt).toLocaleString()}</span>
                    {v.description && <p class="version-desc">{v.description}</p>}
                  </div>
                  <div class="version-actions">
                    <button
                      class="btn-secondary"
                      onClick={() => void restore(v._id)}
                      aria-label={`Restore version from ${v.createdAt}`}
                    >
                      Restore
                    </button>
                    {v.type === 'snapshot' && (
                      <button
                        class="btn-icon btn-danger"
                        onClick={() => void deleteSnapshot(v._id)}
                        aria-label="Delete snapshot"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
