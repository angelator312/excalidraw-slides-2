import { useState, useEffect } from 'preact/hooks';

interface Props {
  /** Pre-filled invite token from URL (e.g. /invite/accept?token=...) */
  prefilledToken?: string;
}

type Mode = 'signin' | 'signup' | 'guest';

export function LoginPage({ prefilledToken }: Props) {
  const [mode, setMode] = useState<Mode>(prefilledToken ? 'signup' : 'signin');
  // Sign up state
  const [inviteInput, setInviteInput] = useState(prefilledToken ?? '');
  const [signupToken, setSignupToken] = useState(''); // extracted token
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupStep, setSignupStep] = useState<'token' | 'profile' | 'done'>(prefilledToken ? 'profile' : 'token');
  const [authTokenResult, setAuthTokenResult] = useState(''); // shown after signup
  const [copied, setCopied] = useState(false);
  // Sign in state
  const [signinToken, setSigninToken] = useState('');
  // Guest state
  const [guestName, setGuestName] = useState('');
  // Common
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!prefilledToken) return;
    setMode('signup');
    setInviteInput(prefilledToken);
    setSignupToken(prefilledToken);
    // Pre-validate the token before showing the profile form
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/invite/check?token=${encodeURIComponent(prefilledToken)}`)
      .then((r) => r.json() as Promise<{ valid?: boolean; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (data.valid) {
          setSignupStep('profile');
        } else {
          setError(data.error ?? 'Invalid or expired invite token');
          setSignupStep('token');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not validate token — check your connection');
          setSignupStep('token');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [prefilledToken]);

  const handleInviteContinue = async (e: Event) => {
    e.preventDefault();
    if (!inviteInput.trim()) { setError('Paste your invite link or token first'); return; }
    let t = inviteInput.trim();
    try {
      const url = new URL(t);
      t = url.searchParams.get('token') ?? t;
    } catch { /* not a URL */ }

    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/invite/check?token=${encodeURIComponent(t)}`);
      const data = await res.json() as { valid?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Invalid or expired invite token');
        return;
      }
    } catch {
      setError('Could not validate token — check your connection');
      return;
    } finally {
      setLoading(false);
    }

    setSignupToken(t);
    setSignupStep('profile');
  };

  const handleSignup = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) { setError('Username is required'); return; }
    if (!displayName.trim()) { setError('Display name is required'); return; }
    if (!/^[a-z0-9_]{2,40}$/.test(username.trim())) {
      setError('Username: 2-40 chars, lowercase letters/numbers/underscore');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: signupToken, username: username.trim().toLowerCase(), displayName: displayName.trim() }),
      });
      const data = await res.json() as { sessionToken?: string; authToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Sign up failed');
      localStorage.setItem('sessionToken', data.sessionToken!);
      setAuthTokenResult(data.authToken ?? data.sessionToken!);
      setSignupStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignin = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!signinToken.trim()) { setError('Paste your auth token first'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken: signinToken.trim() }),
      });
      const data = await res.json() as { sessionToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Sign in failed');
      localStorage.setItem('sessionToken', data.sessionToken!);
      window.history.replaceState(null, '', '/');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async (e: Event) => {
    e.preventDefault();
    setError('');
    if (!guestName.trim()) { setError('Display name is required'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: guestName.trim() }),
      });
      const data = await res.json() as { sessionToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create guest session');
      localStorage.setItem('sessionToken', data.sessionToken!);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create guest session');
    } finally {
      setLoading(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(authTokenResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: user must select manually */ }
  };

  const enterApp = () => {
    window.history.replaceState(null, '', '/');
    window.location.reload();
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

        {signupStep !== 'done' && (
          <div class="login-tabs">
            <button class={`tab-btn ${mode === 'signin' ? 'active' : ''}`} onClick={() => { setMode('signin'); setError(''); }} type="button">Sign in</button>
            <button class={`tab-btn ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(''); }} type="button">Sign up</button>
            <button class={`tab-btn ${mode === 'guest' ? 'active' : ''}`} onClick={() => { setMode('guest'); setError(''); }} type="button">View as guest</button>
          </div>
        )}

        {/* ── Sign in ── */}
        {mode === 'signin' && (
          <form onSubmit={handleSignin} class="login-form">
            <label htmlFor="signin-token">Your auth token</label>
            <textarea
              id="signin-token"
              class="auth-token-input"
              placeholder="Paste your auth token here…"
              value={signinToken}
              onInput={(e) => setSigninToken((e.target as HTMLTextAreaElement).value)}
              required
              rows={4}
              autocomplete="off"
              spellcheck={false}
            />
            <p class="login-hint">Your auth token was shown when you first signed up. It looks like a long string starting with <code>eyJ</code>.</p>
            {error && <p class="error-msg" role="alert">{error}</p>}
            <button type="submit" class="btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}

        {/* ── Sign up ── */}
        {mode === 'signup' && signupStep === 'token' && (
          <form onSubmit={(e) => void handleInviteContinue(e)} class="login-form">
            <label htmlFor="invite-input">Invite link or token</label>
            <input
              id="invite-input"
              type="text"
              placeholder="Paste your invite link or token"
              value={inviteInput}
              onInput={(e) => setInviteInput((e.target as HTMLInputElement).value)}
              required
              autocomplete="off"
              spellcheck={false}
            />
            <p class="login-hint">Ask your team owner to send you an invite link from the Admin panel.</p>
            {error && <p class="error-msg" role="alert">{error}</p>}
            <button type="submit" class="btn-primary" disabled={loading}>{loading ? 'Checking…' : 'Continue →'}</button>
          </form>
        )}

        {mode === 'signup' && signupStep === 'profile' && (
          <form onSubmit={handleSignup} class="login-form">
            <p class="login-hint token-chip">🔑 Invite accepted — create your account</p>
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
              pattern="[a-z0-9_]{2,40}"
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
              <button type="button" class="btn-ghost" onClick={() => { setSignupStep('token'); setError(''); }} disabled={loading}>← Back</button>
              <button type="submit" class="btn-primary" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
            </div>
          </form>
        )}

        {/* ── Sign up: success — show auth token ── */}
        {mode === 'signup' && signupStep === 'done' && (
          <div class="signup-success login-form">
            <div class="signup-success-icon" aria-hidden="true">✅</div>
            <h2 class="signup-success-title">Account created!</h2>
            <p class="login-hint">
              <strong>Save your auth token below.</strong> This is your key to sign in again next time.
              Treat it like a password — don't share it.
            </p>
            <div class="auth-token-display">
              <textarea
                class="auth-token-input auth-token-result"
                readOnly
                value={authTokenResult}
                rows={5}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                aria-label="Your auth token"
                spellcheck={false}
              />
              <button class="btn-secondary btn-copy" onClick={copyToken} type="button">
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
            <p class="login-hint" style="color:var(--color-danger)">
              ⚠ This token will NOT be shown again. Copy it somewhere safe before continuing.
            </p>
            <button class="btn-primary" onClick={enterApp} type="button">
              Enter app →
            </button>
          </div>
        )}

        {/* ── Guest ── */}
        {mode === 'guest' && (
          <form onSubmit={handleGuest} class="login-form">
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
            <button type="submit" class="btn-primary" disabled={loading}>{loading ? 'Creating session…' : 'Continue as guest'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
