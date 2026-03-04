import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';
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

interface Props {
  onOpen: (id: string) => void;
}

export function PresentationList({ onOpen }: Props) {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  return (
    <div class="pres-list-page">
      <div class="pres-list-header">
        <h1 class="pres-list-title">My Presentations</h1>
        <button class="btn-primary" onClick={() => setShowCreate(true)}>
          + New presentation
        </button>
      </div>

      {error && <p class="error-msg" role="alert">{error}</p>}

      {loading ? (
        <div class="loading-placeholder"><div class="spinner" /></div>
      ) : presentations.length === 0 ? (
        <div class="pres-empty">
          <div class="pres-empty-icon" aria-hidden="true">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect x="8" y="12" width="48" height="40" rx="6" stroke="#d1d5db" stroke-width="2" fill="white"/>
              <rect x="16" y="22" width="20" height="3" rx="1.5" fill="#d1d5db"/>
              <rect x="16" y="30" width="32" height="3" rx="1.5" fill="#d1d5db"/>
              <rect x="16" y="38" width="24" height="3" rx="1.5" fill="#d1d5db"/>
            </svg>
          </div>
          <p class="pres-empty-msg">No presentations yet.</p>
          <button class="btn-primary" onClick={() => setShowCreate(true)}>
            Create your first presentation
          </button>
        </div>
      ) : (
        <ul class="pres-grid" role="list">
          {presentations.map((p) => (
            <li key={p._id} class="pres-card" role="listitem">
              <button
                class="pres-card-btn"
                onClick={() => onOpen(p._id)}
                aria-label={`Open "${p.title}"`}
              >
                <div class="pres-card-thumb" aria-hidden="true">
                  <svg width="100%" height="100%" viewBox="0 0 240 135" fill="none">
                    <rect width="240" height="135" fill="#f8f7ff"/>
                    <rect x="20" y="40" width="80" height="8" rx="4" fill="#c4c3f0"/>
                    <rect x="20" y="56" width="120" height="6" rx="3" fill="#dddcf8"/>
                    <rect x="20" y="70" width="100" height="6" rx="3" fill="#dddcf8"/>
                    <rect x="20" y="84" width="60" height="6" rx="3" fill="#dddcf8"/>
                  </svg>
                  <div class="pres-card-count">{p.slideCount} slide{p.slideCount !== 1 ? 's' : ''}</div>
                </div>
                <div class="pres-card-info">
                  <h3 class="pres-card-title">{p.title}</h3>
                  <div class="pres-card-meta">
                    <span class={`vis-badge vis-${p.visibility}`}>{p.visibility}</span>
                    <span class="pres-card-date">{formatDate(p.updatedAt)}</span>
                  </div>
                  <p class="pres-card-owner">by {p.ownerUsername}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreatePresentationModal
          onClose={() => setShowCreate(false)}
          onCreate={(id) => { setShowCreate(false); onOpen(id); }}
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
