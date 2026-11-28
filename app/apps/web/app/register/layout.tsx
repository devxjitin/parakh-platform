import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Create trainer account',
  description:
    'Create a free NandiRank account to run online exams as a trainer or take exams as a student.',
  alternates: { canonical: '/register/' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
