import type { ReactNode } from 'react';
import { SiteLinks } from '../components/legal';
import { NoWheelNumber } from '../components/no-wheel-number';
import { DialogHost } from '../components/dialogs';
import { AuthProvider } from '../lib/auth';
import '@fontsource-variable/inter';
import 'katex/dist/katex.min.css';
import './globals.css';
import './premium.css';

export const metadata = {
  title: 'Parakh',
  description: 'Online assessments and verified certificates by NandiVex Technologies',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <NoWheelNumber />
        <DialogHost />
        <AuthProvider>{children}</AuthProvider>
        <footer className="site-footer">
          <SiteLinks />
          <span>© NandiVex Technologies</span>
        </footer>
      </body>
    </html>
  );
}
