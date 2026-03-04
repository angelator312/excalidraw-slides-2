import { useState } from 'preact/hooks';
import { PresentationList } from './PresentationList';
import { LoginPage } from './LoginPage';
import { useAuth } from '../hooks/useAuth';

export function App() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<'home' | 'presentation'>('home');

  if (loading) {
    return (
      <div class="loading-screen">
        <div class="spinner" aria-label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div class="app-layout">
      <header class="app-header">
        <div class="app-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#e94560" />
            <rect x="6" y="8" width="16" height="2" rx="1" fill="white" />
            <rect x="6" y="13" width="12" height="2" rx="1" fill="white" />
            <rect x="6" y="18" width="8" height="2" rx="1" fill="white" />
          </svg>
          <span>Excalidraw Slides</span>
        </div>
        <nav class="app-nav">
          <button
            class={`nav-btn ${view === 'home' ? 'active' : ''}`}
            onClick={() => setView('home')}
            aria-current={view === 'home' ? 'page' : undefined}
          >
            Presentations
          </button>
        </nav>
        <div class="app-user">
          <span class="user-badge" title={user.username}>{getInitials(user.displayName || user.username)}</span>
          <span class="user-name">{user.displayName || user.username}</span>
        </div>
      </header>
      <main class="app-main">
        {view === 'home' && <PresentationList />}
      </main>
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
