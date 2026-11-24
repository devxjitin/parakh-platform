import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Join an exam',
  description: 'Enter your exam code to join an online exam on Parakh.',
  alternates: { canonical: '/join/' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
