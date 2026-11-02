import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api } from './api';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'learner' | 'editor' | 'reviewer' | 'admin';
  default_language: string;
  audio_mode: string;
  captions: number;
  reduced_motion: number;
};

export type ThemeCard = {
  id: string;
  name: string;
  tagline: string;
  background: string;
  panel: string;
  ink: string;
  accent: string;
};

type SessionValue = {
  user: SessionUser | null;
  themes: ThemeCard[];
  needsAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  bootstrapAdmin: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  canStudio: boolean;
};

const SessionContext = createContext<SessionValue | null>(null);

type MePayload = { user: SessionUser | null; needsAdmin: boolean; themes: ThemeCard[] };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [themes, setThemes] = useState<ThemeCard[]>([]);
  const [needsAdmin, setNeedsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<MePayload>('/api/auth/me');
      setUser(data.user);
      setThemes(data.themes || []);
      setNeedsAdmin(Boolean(data.needsAdmin));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const data = await api<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setUser(data.user);
      setNeedsAdmin(false);
      await refresh();
    },
    [refresh]
  );

  const register = useCallback(
    async (email: string, name: string, password: string) => {
      const data = await api<{ user: SessionUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password })
      });
      setUser(data.user);
      await refresh();
    },
    [refresh]
  );

  const bootstrapAdmin = useCallback(
    async (email: string, name: string, password: string) => {
      const data = await api<{ user: SessionUser }>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ email, name, password })
      });
      setUser(data.user);
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    await refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      themes,
      needsAdmin,
      loading,
      refresh,
      signIn,
      register,
      bootstrapAdmin,
      signOut,
      canStudio: Boolean(user && user.role !== 'learner')
    }),
    [user, themes, needsAdmin, loading, refresh, signIn, register, bootstrapAdmin, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
