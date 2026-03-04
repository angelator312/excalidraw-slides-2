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
    <aside class="side-panel" role="complementary" aria-label="Slide History">
      <div class="side-panel-header">
        <h2>History</h2>
        <button class="panel-close-btn" onClick={onClose} aria-label="Close history panel">✕</button>
      </div>

      <div class="side-panel-body">
        {/* Save snapshot form */}
        <section class="history-snapshot-form">
          <h3 class="panel-section-title">Save snapshot</h3>
          <form onSubmit={createSnapshot} class="snapshot-form">
            <input
              type="text"
              class="panel-input"
              placeholder="Snapshot name"
              value={snapName}
              onInput={(e) => setSnapName((e.target as HTMLInputElement).value)}
              required
              maxLength={80}
            />
            <textarea
              class="panel-input"
              placeholder="Description (optional)"
              value={snapDesc}
              onInput={(e) => setSnapDesc((e.target as HTMLTextAreaElement).value)}
              rows={2}
              maxLength={300}
            />
            {error && <p class="error-msg" role="alert">{error}</p>}
            <button type="submit" class="btn-primary btn-sm" disabled={savingSnap}>
              {savingSnap ? 'Saving…' : 'Save snapshot'}
            </button>
          </form>
        </section>

        {/* Version list */}
        <section class="history-versions">
          <h3 class="panel-section-title">Versions</h3>
          {loading ? (
            <div class="panel-loading"><div class="spinner spinner-sm"/></div>
          ) : versions.length === 0 ? (
            <p class="text-muted">No versions yet.</p>
          ) : (
            <ul class="version-list">
              {versions.map((v) => (
                <li key={v._id} class="version-item">
                  <div class="version-item-header">
                    <span class={`version-badge version-${v.type}`}>{v.type}</span>
                    {v.name && <strong class="version-name">{v.name}</strong>}
                  </div>
                  <time class="version-date text-muted">
                    {new Date(v.createdAt).toLocaleString()}
                  </time>
                  {v.description && <p class="version-desc text-muted">{v.description}</p>}
                  <div class="version-actions">
                    <button
                      class="btn-ghost btn-sm"
                      onClick={() => void restore(v._id)}
                      aria-label={`Restore version from ${v.createdAt}`}
                    >
                      Restore
                    </button>
                    {v.type === 'snapshot' && (
                      <button
                        class="btn-icon btn-danger-ghost btn-sm"
                        onClick={() => void deleteSnapshot(v._id)}
                        aria-label="Delete snapshot"
                        title="Delete"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
