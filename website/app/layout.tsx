import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import './globals.css';
import './premium.css';

export const metadata = {
  title: 'Parakh | Online exams and verified certificates',
  description: 'Online assessments and verified certificates by NandiVex Technologies',
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
