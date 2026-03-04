import { useState, useEffect } from 'preact/hooks';
import { apiFetch } from '../lib/api';

export interface AuthUser {
  _id: string;
  username: string;
  displayName?: string;
  role: 'owner' | 'user' | 'anonymous';
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sessionToken');
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<AuthUser>('/api/auth/me')
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem('sessionToken');
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    localStorage.removeItem('sessionToken');
    window.location.href = '/';
  };

  return { user, loading, logout };
}
