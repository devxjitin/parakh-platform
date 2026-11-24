'use client';

import Link from 'next/link';

/**
 * The two ways into Parakh, side by side: students join an exam, trainers sign in to conduct
 * them. A segmented switch shown on the sign-in, join and trainer sign-up pages.
 */
export function AudienceSwitch({ active }: { active: 'join' | 'trainer' }) {
  const items = [
    { key: 'trainer', href: '/login/', title: 'Conduct Exam' },
    { key: 'join', href: '/join/', title: 'Join Exam' },
  ] as const;
  return (
    <nav className="audience-switch" aria-label="Choose how you are using Parakh">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`as-item${active === it.key ? ' on' : ''}`}
          aria-current={active === it.key ? 'page' : undefined}
        >
          {it.title}
        </Link>
      ))}
    </nav>
  );
}
