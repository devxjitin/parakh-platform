'use client';

import { useRouter } from 'next/navigation';

/**
 * Goes back to the page the visitor came from (a checkout, a join page, the exam editor...).
 * With no earlier page on this site, for example a link opened in a new tab, it goes home.
 */
export function BackButton({ homeLabel = 'Back to home' }: { homeLabel?: string }) {
  const router = useRouter();
  function back() {
    let cameFromHere = false;
    try {
      cameFromHere =
        window.history.length > 1 &&
        document.referrer !== '' &&
        new URL(document.referrer).origin === window.location.origin;
    } catch {
      cameFromHere = false;
    }
    if (cameFromHere) router.back();
    else router.push('/');
  }
  return (
    <button type="button" className="btn btn-secondary btn-small" onClick={back}>
      {homeLabel}
    </button>
  );
}
