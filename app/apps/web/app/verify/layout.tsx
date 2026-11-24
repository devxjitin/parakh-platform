import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  description: 'Check a Parakh certificate: enter its serial number to confirm it is genuine.',
  alternates: { canonical: '/verify/' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
