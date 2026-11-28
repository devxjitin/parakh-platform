import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NandiRank by NandiVex Technologies',
    short_name: 'NandiRank',
    description:
      'NandiRank by NandiVex Technologies: create, proctor and grade online exams, and issue certificates anyone can verify with a serial number and QR code.',
    start_url: '/dashboard/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
