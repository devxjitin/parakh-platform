'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, PublicUser } from '@parakh/shared';
import { api, refreshSession, setAccessToken } from './api';

interface AuthContextValue {
  user: PublicUser | null;
  /** true until the first attempt to restore a session has finished */
  loading: boolean;
  setSession: (session: AuthResponse) => void;
  setUser: (user: PublicUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    refreshSession().then((session) => {
      if (cancelled) return;
      setUserState(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSession = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setUserState(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', auth: false });
    } finally {
      setAccessToken(null);
      setUserState(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, setSession, setUser: setUserState, logout }),
    [user, loading, setSession, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For signed-in pages: redirects to /login/ when there is no session. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace('/login/');
  }, [auth.loading, auth.user, router]);
  return auth;
}

/**
 * For sign-in/sign-up pages: sends already signed-in users to the dashboard.
 * `allowStudent` keeps a signed-in student on the page, so they can reach trainer sign-in.
 */
export function useRedirectIfSignedIn(allowStudent = false) {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (auth.loading || !auth.user) return;
    if (allowStudent && auth.user.role === 'STUDENT') return;
    router.replace('/dashboard/');
  }, [auth.loading, auth.user, router, allowStudent]);
  return auth;
}
