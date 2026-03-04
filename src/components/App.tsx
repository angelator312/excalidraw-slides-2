import { PresentationList } from './PresentationList';
import { LoginPage } from './LoginPage';
import { PresentationEditor } from './PresentationEditor';
import { useAuth } from '../hooks/useAuth';
import { useRouter } from '../hooks/useRouter';

export function App() {
  const { user, loading, logout } = useAuth();
  const { route, navigateToPresentation, navigateHome } = useRouter();

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

  // Route: /presentation/:id
  if (route.path === 'presentation') {
    return (
      <PresentationEditor
        presentationId={route.id}
        onBack={navigateHome}
      />
    );
  }

  // Route: / (home)
  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header-left">
          <div class="app-logo" aria-label="Excalidraw Slides">
            {/* Excalidraw-style pencil/wave logo */}
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#6965db" />
              <path d="M8 22 L13 10 L18 18 L21 14 L25 22" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <span class="app-logo-text">Excalidraw Slides</span>
          </div>
        </div>

        <nav class="app-nav" aria-label="Main navigation">
          <button class="nav-btn active" aria-current="page">
            Presentations
          </button>
        </nav>

        <div class="app-header-right">
          <div class="user-info">
            <span class="user-avatar" title={user.username} aria-label={user.displayName || user.username}>
              {getInitials(user.displayName || user.username)}
            </span>
            <span class="user-name" aria-hidden="true">{user.displayName || user.username}</span>
          </div>
          <button class="btn-ghost" onClick={logout} aria-label="Log out">
            Log out
          </button>
        </div>
      </header>

      <main class="app-main">
        <PresentationList onOpen={navigateToPresentation} />
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
