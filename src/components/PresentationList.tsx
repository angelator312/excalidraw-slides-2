import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import { PresentationEditor } from './PresentationEditor';
import { CreatePresentationModal } from './CreatePresentationModal';

export interface Presentation {
  _id: string;
  title: string;
  visibility: 'public' | 'private' | 'team-only';
  ownerUsername: string;
  slideCount: number;
  updatedAt: string;
  canEdit: boolean;
}

export function PresentationList() {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<Presentation[]>('/api/presentations');
      setPresentations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load presentations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (selected) {
    return (
      <PresentationEditor
        presentationId={selected}
        onBack={() => { setSelected(null); void load(); }}
      />
    );
  }

  return (
    <div class="presentation-list-page">
      <div class="page-header">
        <h2>My Presentations</h2>
        <button class="btn-primary" onClick={() => setShowCreate(true)}>
          + New Presentation
        </button>
      </div>

      {error && <p class="error-msg" role="alert">{error}</p>}

      {loading ? (
        <div class="loading-placeholder">Loading…</div>
      ) : presentations.length === 0 ? (
        <div class="empty-state">
          <p>You have no presentations yet.</p>
          <button class="btn-primary" onClick={() => setShowCreate(true)}>Create your first</button>
        </div>
      ) : (
        <ul class="presentation-grid" role="list">
          {presentations.map((p) => (
            <li key={p._id} class="presentation-card" role="listitem">
              <button
                class="card-body"
                onClick={() => setSelected(p._id)}
                aria-label={`Open "${p.title}"`}
              >
                <div class="card-thumb" aria-hidden="true">
                  <span class="card-slide-count">{p.slideCount} slide{p.slideCount !== 1 ? 's' : ''}</span>
                </div>
                <div class="card-info">
                  <h3 class="card-title">{p.title}</h3>
                  <span class={`visibility-badge ${p.visibility}`}>{p.visibility}</span>
                  <p class="card-meta">
                    by {p.ownerUsername} · {formatDate(p.updatedAt)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreatePresentationModal
          onClose={() => setShowCreate(false)}
          onCreate={() => { setShowCreate(false); void load(); }}
        />
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}
