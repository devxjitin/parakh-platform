import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_VERSION } from '@parakh/shared';
import { Brand } from './app-shell';
import { BackButton } from './back-button';

/** Shown on every legal page until the owner or a lawyer has approved the wording. */
const DRAFT_NOTICE =
  'Draft wording. It describes how the platform works today and has not yet been reviewed by a lawyer. Items in [square brackets] must be filled in or confirmed by NandiVex Technologies before launch.';

export const LEGAL_LINKS = [
  { href: '/terms/', label: 'Terms' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/refund-policy/', label: 'Refund policy' },
  { href: '/contact/', label: 'Contact' },
];

/** Signed-out page frame for the static legal pages. */
export function LegalPage({
  title,
  updated,
  draft = true,
  children,
}: {
  title: string;
  updated?: string;
  /** False once the page has no [bracketed] items left and the owner has approved the wording. */
  draft?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="public">
      <header className="public-bar">
        <Brand />
        <BackButton homeLabel="Back" />
      </header>
      <main className="page legal">
        <h1>{title}</h1>
        <p className="muted">
          Version {LEGAL_VERSION}
          {updated ? `, ${updated}` : ''}
        </p>
        {draft && (
          <div className="alert alert-info" role="note">
            {DRAFT_NOTICE}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** Links to every legal page; used as the footer on public pages and under the legal pages. */
export function SiteLinks() {
  return (
    <nav className="site-links" aria-label="Legal">
      {LEGAL_LINKS.map((l) => (
        <Link key={l.href} href={l.href}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
