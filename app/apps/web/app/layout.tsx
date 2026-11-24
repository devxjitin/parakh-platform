import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteLinks } from '../components/legal';
import { NoWheelNumber } from '../components/no-wheel-number';
import { DialogHost } from '../components/dialogs';
import { AuthProvider } from '../lib/auth';
import { APP_ORIGIN } from '../lib/seo';
import '@fontsource-variable/inter';
import 'katex/dist/katex.min.css';
import './globals.css';
import './premium.css';

const DESCRIPTION =
  'Parakh by NandiVex Technologies: create, proctor and grade online exams, and issue certificates anyone can verify with a serial number and QR code.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: { default: 'Parakh | Online exams and verified certificates', template: '%s | Parakh' },
  description: DESCRIPTION,
  applicationName: 'Parakh',
  authors: [{ name: 'NandiVex Technologies' }],
  creator: 'NandiVex Technologies',
  publisher: 'NandiVex Technologies',
  openGraph: {
    type: 'website',
    siteName: 'Parakh',
    locale: 'en_IN',
    title: 'Parakh | Online exams and verified certificates',
    description: DESCRIPTION,
    images: [
      { url: '/og-image.png', width: 1200, height: 630, alt: 'Parakh by NandiVex Technologies' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Parakh | Online exams and verified certificates',
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
  // Signed-in pages override this with noindex in their own layout.
  robots: { index: true, follow: true },
  // The tab icon is the Parakh badge: .ico for older browsers, PNGs for modern ones.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.png', type: 'image/png', sizes: '256x256' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" data-theme="light">
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
