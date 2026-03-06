import { useState, useEffect } from 'preact/hooks';

export type Route =
  | { path: 'home' }
  | { path: 'presentation'; id: string }
  | { path: 'admin' }
  | { path: 'teams' }
  | { path: 'invite-accept'; token: string };

function parseRoute(): Route {
  const pathname = window.location.pathname;
  const search = window.location.search;

  const presMatch = pathname.match(/^\/presentation\/([0-9a-f]{24})\/?$/i);
  if (presMatch && presMatch[1]) return { path: 'presentation', id: presMatch[1] };

  if (pathname === '/admin') return { path: 'admin' };

  if (pathname === '/teams') return { path: 'teams' };

  // /invite/accept?token=...
  if (pathname === '/invite/accept' || pathname === '/invite') {
    const params = new URLSearchParams(search);
    const token = params.get('token') ?? '';
    return { path: 'invite-accept', token };
  }

  return { path: 'home' };
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState(null, '', to);
    setRoute(parseRoute());
  };

  const navigateToPresentation = (id: string) => navigate(`/presentation/${id}`);
  const navigateHome = () => navigate('/');
  const navigateAdmin = () => navigate('/admin');
  const navigateTeams = () => navigate('/teams');

  return { route, navigate, navigateToPresentation, navigateHome, navigateAdmin, navigateTeams };
}
