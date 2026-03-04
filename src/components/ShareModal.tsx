import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';

interface Props {
  presentationId: string;
  onClose: () => void;
}

interface ShareLink {
  token: string;
  role: 'view' | 'edit';
  expiresAt?: string;
}

export function ShareModal({ presentationId, onClose }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [expiryDays, setExpiryDays] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { void loadLinks(); }, []);

  const loadLinks = async () => {
    try {
      const data = await apiFetch<ShareLink[]>(`/api/presentations/${presentationId}/share-links`);
      setLinks(data);
    } catch { /* ignore */ }
  };

  const createLink = async () => {
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = { role };
      if (expiryDays !== '') body.expiryDays = Number(expiryDays);
      const data = await apiFetch<ShareLink>(`/api/presentations/${presentationId}/share-links`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLinks((prev) => [...prev, data]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link');
    } finally {
      setLoading(false);
    }
  };

  const revokeLink = async (token: string) => {
    try {
      await apiFetch(`/api/presentations/${presentationId}/share-links/${token}`, { method: 'DELETE' });
      setLinks((prev) => prev.filter((l) => l.token !== token));
    } catch { /* ignore */ }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    void navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Share Presentation">
      <div class="modal-box modal-wide">
        <div class="modal-header">
          <h2>Share Presentation</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div class="share-create">
          <h3>Create share link</h3>
          <div class="share-form-row">
            <select
              value={role}
              onChange={(e) => setRole((e.target as HTMLSelectElement).value as 'view' | 'edit')}
              aria-label="Link role"
            >
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </select>
            <input
              type="number"
              placeholder="Expires in days (optional)"
              value={expiryDays}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setExpiryDays(v === '' ? '' : Number(v));
              }}
              min={1}
              max={365}
              style="width:200px"
              aria-label="Expiry in days"
            />
            <button class="btn-primary" onClick={createLink} disabled={loading}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error && <p class="error-msg">{error}</p>}
        </div>

        <div class="share-links-list">
          <h3>Active links</h3>
          {links.length === 0 ? (
            <p class="text-muted">No share links yet.</p>
          ) : (
            <ul>
              {links.map((l) => (
                <li key={l.token} class="share-link-item">
                  <span class={`role-badge ${l.role}`}>{l.role}</span>
                  <span class="link-token" title={l.token}>
                    {`${window.location.origin}/join/${l.token.slice(0, 12)}…`}
                  </span>
                  {l.expiresAt && (
                    <span class="text-muted">expires {new Date(l.expiresAt).toLocaleDateString()}</span>
                  )}
                  <button
                    class="btn-icon"
                    onClick={() => copyLink(l.token)}
                    aria-label="Copy link"
                    title="Copy link"
                  >
                    {copied === l.token ? '✓' : '📋'}
                  </button>
                  <button
                    class="btn-icon btn-danger"
                    onClick={() => void revokeLink(l.token)}
                    aria-label="Revoke link"
                    title="Revoke"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
