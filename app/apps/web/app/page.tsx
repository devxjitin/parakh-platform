'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';

/**
 * The app has no landing page of its own: the marketing page lives in /website (port 3100).
 * The root of the app just sends people to their dashboard, or to sign in.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard/' : '/login/');
  }, [loading, user, router]);

  return null;
}
