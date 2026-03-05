import { useState, useEffect } from 'preact/hooks';

interface Props {
  /** Pre-filled invite token from URL (e.g. /invite/accept?token=...) */
  prefilledToken?: string;
}

export function LoginPage({ prefilledToken }: Props) {
  const [mode, setMode] = useState<'invite' | 'anonymous'>(prefilledToken ? 'invite' : 'invite');
  const [token, setToken] = useState(prefilledToken ?? '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [step, setStep] = useState<'token' | 'profile'>(prefilledToken ? 'profile' : 'token');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // When a pre-filled token arrives, skip straight to profile step
  useEffect(() => {
    if (prefilledToken) {
      setToken(prefilledToken);
      setStep('profile');
    }
  }, [prefilledToken]);

  const handleTokenContinue = (e: Event) => {
    e.preventDefault();
    if (!token.trim()) { setError('Paste your invite link or token first'); return; }
    // Support pasting the full URL
    let t = token.trim();
    try {
      const url = new URL(t);
      t = url.searchParams.get('token') ?? t;
    } catch { /* not a URL, use as-is */ }
    setToken(t);
    setError('');
    setStep('profile');
  };

  const handleInviteAccept = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) { setError('Username is required'); return; }
    if (!displayName.trim()) { setError('Display name is required'); return; }
    if (!/^[a-z0-9_]{2,40}$/.test(username.trim())) {
      setError('Username must be 2-40 chars, letters/numbers/underscore only');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username: username.trim().toLowerCase(), displayName: displayName.trim() }),
      });
      const data = await res.json() as { sessionToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to authenticate');
      localStorage.setItem('sessionToken', data.sessionToken!);
      window.history.replaceState(null, '', '/');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymous = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!guestName.trim()) {
      setError('Display name is required for guest access');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: guestName.trim() }),
      });
      const data = await res.json() as { sessionToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create session');
      localStorage.setItem('sessionToken', data.sessionToken!);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <svg width="56" height="56" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#6965db" />
            <path d="M8 22 L13 10 L18 18 L21 14 L25 22" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <h1>Excalidraw Slides</h1>
          <p class="login-tagline">Collaborative presentations, built on Excalidraw</p>
        </div>

        <div class="login-tabs">
          <button
            class={`tab-btn ${mode === 'invite' ? 'active' : ''}`}
            onClick={() => { setMode('invite'); setStep('token'); setError(''); }}
            type="button"
          >
            Sign in with invite
          </button>
          <button
            class={`tab-btn ${mode === 'anonymous' ? 'active' : ''}`}
            onClick={() => { setMode('anonymous'); setError(''); }}
            type="button"
          >
            View as guest
          </button>
        </div>

        {mode === 'invite' ? (
          step === 'token' ? (
            <form onSubmit={handleTokenContinue} class="login-form">
              <label htmlFor="invite-token">Invite link or token</label>
              <input
                id="invite-token"
                type="text"
                placeholder="Paste your invite link or token"
                value={token}
                onInput={(e) => setToken((e.target as HTMLInputElement).value)}
                required
                autocomplete="off"
                spellcheck={false}
              />
              <p class="login-hint">
                Ask your team owner to send you an invite link from the Admin panel.
              </p>
              {error && <p class="error-msg" role="alert">{error}</p>}
              <button type="submit" class="btn-primary" disabled={loading}>
                Continue →
              </button>
            </form>
          ) : (
            <form onSubmit={handleInviteAccept} class="login-form">
              <p class="login-hint token-chip">🔑 Invite token accepted — set up your account</p>

              <label htmlFor="reg-username">Username</label>
              <input
                id="reg-username"
                type="text"
                placeholder="e.g. alice_smith"
                value={username}
                onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                required
                minLength={2}
                maxLength={40}
                autocomplete="username"
                pattern="[a-zA-Z0-9_]+"
              />

              <label htmlFor="reg-display">Display name</label>
              <input
                id="reg-display"
                type="text"
                placeholder="e.g. Alice Smith"
                value={displayName}
                onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                required
                minLength={2}
                maxLength={60}
                autocomplete="name"
              />

              {error && <p class="error-msg" role="alert">{error}</p>}

              <div class="login-btn-row">
                <button
                  type="button"
                  class="btn-ghost"
                  onClick={() => { setStep('token'); setError(''); }}
                  disabled={loading}
                >
                  ← Back
                </button>
                <button type="submit" class="btn-primary" disabled={loading}>
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handleAnonymous} class="login-form">
            <label htmlFor="guest-name">Your display name</label>
            <input
              id="guest-name"
              type="text"
              placeholder="e.g. Alice"
              value={guestName}
              onInput={(e) => setGuestName((e.target as HTMLInputElement).value)}
              required
              minLength={2}
              maxLength={40}
            />
            <p class="login-hint">Guest access lets you view public presentations.</p>
            {error && <p class="error-msg" role="alert">{error}</p>}
            <button type="submit" class="btn-primary" disabled={loading}>
              {loading ? 'Creating session…' : 'Continue as guest'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
