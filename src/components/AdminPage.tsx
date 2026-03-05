import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

interface InviteToken {
  _id: string;
  token: string;
  email?: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt?: string;
  createdAt: string;
}

interface UserItem {
  _id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt?: string;
}

interface Props {
  onBack: () => void;
}

export function AdminPage({ onBack }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'invites' | 'users'>('invites');

  // Invites state
  const [tokens, setTokens] = useState<InviteToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDays, setNewDays] = useState(7);
  const [newMaxUses, setNewMaxUses] = useState(1);
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState('');

  // Users state
  const [users, setUsers] = useState<UserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');

  const siteOrigin = window.location.origin;

  useEffect(() => {
    if (tab === 'invites') void loadTokens();
    else void loadUsers();
  }, [tab]);

  const loadTokens = async () => {
    setTokensLoading(true);
    setTokensError('');
    try {
      const data = await apiFetch<InviteToken[]>('/api/admin/invite');
      setTokens(data);
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setTokensLoading(false);
    }
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const data = await apiFetch<UserItem[]>('/api/admin/users');
      setUsers(data);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  const createInvite = async (e: Event) => {
    e.preventDefault();
    setCreating(true);
    setNewLink('');
    try {
      const data = await apiFetch<{ link: string; token: string }>('/api/admin/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail.trim() || undefined,
          expiresInDays: newDays,
          maxUses: newMaxUses,
        }),
      });
      setNewLink(`${siteOrigin}/invite/accept?token=${data.token}`);
      setNewEmail('');
      await loadTokens();
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (token: string) => {
    if (!confirm('Revoke this invite token?')) return;
    try {
      await apiFetch(`/api/admin/invite/${token}/revoke`, { method: 'POST' });
      await loadTokens();
    } catch (err) {
      setTokensError(err instanceof Error ? err.message : 'Failed to revoke token');
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // fallback: select the text
    }
  };

  if (user?.role !== 'owner') {
    return (
      <div class="admin-page">
        <div class="admin-forbidden">
          <h2>Access Denied</h2>
          <p>Only owners can access the admin panel.</p>
          <button class="btn-primary" onClick={onBack}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div class="admin-page">
      <div class="admin-header">
        <button class="btn-icon admin-back" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <h1 class="admin-title">Admin Panel</h1>
        <span class="admin-badge">owner</span>
      </div>

      <div class="admin-tabs">
        <button
          class={`admin-tab-btn ${tab === 'invites' ? 'active' : ''}`}
          onClick={() => setTab('invites')}
        >
          🔗 Invite Tokens
        </button>
        <button
          class={`admin-tab-btn ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          👥 Users
        </button>
      </div>

      {tab === 'invites' && (
        <div class="admin-section">
          {/* Create invite form */}
          <div class="admin-card">
            <h2>Create Invite Link</h2>
            <p class="admin-hint">Share the generated link with a new user. They can set their own username and display name when they accept it.</p>
            <form class="admin-form" onSubmit={createInvite}>
              <div class="admin-form-row">
                <div class="admin-form-field">
                  <label htmlFor="invite-email">Email (optional)</label>
                  <input
                    id="invite-email"
                    type="email"
                    placeholder="alice@example.com"
                    value={newEmail}
                    onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)}
                    maxLength={254}
                  />
                </div>
                <div class="admin-form-field admin-form-field--narrow">
                  <label htmlFor="invite-days">Expires in (days)</label>
                  <input
                    id="invite-days"
                    type="number"
                    min={1}
                    max={365}
                    value={newDays}
                    onInput={(e) => setNewDays(parseInt((e.target as HTMLInputElement).value, 10) || 7)}
                  />
                </div>
                <div class="admin-form-field admin-form-field--narrow">
                  <label htmlFor="invite-uses">Max uses</label>
                  <input
                    id="invite-uses"
                    type="number"
                    min={1}
                    max={100}
                    value={newMaxUses}
                    onInput={(e) => setNewMaxUses(parseInt((e.target as HTMLInputElement).value, 10) || 1)}
                  />
                </div>
              </div>
              {tokensError && <p class="error-msg" role="alert">{tokensError}</p>}
              <button type="submit" class="btn-primary" disabled={creating}>
                {creating ? 'Generating…' : '+ Generate invite link'}
              </button>
            </form>

            {newLink && (
              <div class="invite-result">
                <p class="invite-result-label">✅ New invite link — copy and send to the user:</p>
                <div class="invite-link-row">
                  <input
                    type="text"
                    class="invite-link-input"
                    value={newLink}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="Invite link"
                  />
                  <button class="btn-secondary" onClick={() => void copyLink(newLink)} type="button">
                    Copy
                  </button>
                </div>
                <p class="admin-hint">The link works for <strong>{newMaxUses}</strong> {newMaxUses === 1 ? 'use' : 'uses'} and expires in <strong>{newDays} days</strong>.</p>
              </div>
            )}
          </div>

          {/* Token list */}
          <div class="admin-card">
            <h2>All invite tokens ({tokens.filter((t) => !t.revokedAt && new Date(t.expiresAt) > new Date() && t.uses < t.maxUses).length} active)</h2>
            {tokensLoading ? (
              <div class="loading-placeholder"><div class="spinner" /></div>
            ) : tokens.length === 0 ? (
              <p class="text-muted">No invite tokens yet.</p>
            ) : (
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Uses</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const expired = new Date(t.expiresAt) < new Date();
                    const exhausted = t.uses >= t.maxUses;
                    const revoked = !!t.revokedAt;
                    const status = revoked ? 'revoked' : expired ? 'expired' : exhausted ? 'exhausted' : 'active';
                    return (
                      <tr key={t._id} class={`token-row token-${status}`}>
                        <td>{t.email || <span class="text-muted">—</span>}</td>
                        <td>{t.uses} / {t.maxUses}</td>
                        <td>{new Date(t.expiresAt).toLocaleDateString()}</td>
                        <td><span class={`status-badge status-${status}`}>{status}</span></td>
                        <td>
                          {status === 'active' && (
                            <div class="token-actions">
                              <button
                                class="btn-ghost btn-sm"
                                onClick={() => void copyLink(`${siteOrigin}/invite/accept?token=${t.token}`)}
                                title="Copy link"
                              >
                                Copy link
                              </button>
                              <button
                                class="btn-danger-ghost btn-sm"
                                onClick={() => void revokeToken(t.token)}
                                title="Revoke"
                              >
                                Revoke
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div class="admin-section">
          <div class="admin-card">
            <h2>Registered Users</h2>
            {usersLoading ? (
              <div class="loading-placeholder"><div class="spinner" /></div>
            ) : usersError ? (
              <p class="error-msg">{usersError}</p>
            ) : users.length === 0 ? (
              <p class="text-muted">No users found.</p>
            ) : (
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Display name</th>
                    <th>Role</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u._id} class={u._id === user?._id ? 'current-user-row' : ''}>
                      <td><code class="username-code">{u.username}</code></td>
                      <td>{u.displayName}</td>
                      <td><span class={`role-badge role-${u.role}`}>{u.role}</span></td>
                      <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
