'use client';

import { captureException } from '@sentry/browser';
import { useEffect } from 'react';

// Deliberately independent of Shell and AuthProvider: this page must still render when they fail.
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <div className="public">
      <main className="page">
        <section className="card" role="alert">
          <h1>Something went wrong</h1>
          <p className="muted">
            This page hit an unexpected problem. Try again, or go back to the home page. If it keeps
            happening, please tell us on the <a href="/contact">contact page</a>.
          </p>
          <div className="stack">
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
            <a className="btn btn-secondary" href="/">
              Go to home
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
