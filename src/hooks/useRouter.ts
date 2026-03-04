import { useState, useEffect } from 'preact/hooks';

export type Route =
  | { path: 'home' }
  | { path: 'presentation'; id: string };

function parseRoute(): Route {
  const pathname = window.location.pathname;
  const match = pathname.match(/^\/presentation\/([0-9a-f]{24})\/?$/i);
  if (match && match[1]) return { path: 'presentation', id: match[1] };
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

  return { route, navigate, navigateToPresentation, navigateHome };
}
