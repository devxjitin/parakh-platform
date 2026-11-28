import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "./globals.css";
import "./premium.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "../lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s | NandiRank" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "online exam platform",
    "online exams India",
    "proctored online exam",
    "online test maker",
    "verified certificates",
    "certificate verification",
    "exam software for trainers",
    "NandiRank",
    "NandiVex Technologies",
  ],
  authors: [{ name: "NandiVex Technologies" }],
  creator: "NandiVex Technologies",
  publisher: "NandiVex Technologies",
  category: "education",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_IN",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "NandiRank by NandiVex Technologies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // The tab icon is the NandiRank badge: .ico for older browsers, PNGs for modern ones.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "256x256" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563eb",
};

/** Structured data: who runs the site, the site itself, and the web app it describes. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "NandiVex Technologies",
      url: "https://nandivex.com",
      logo: `${SITE_URL}/icon-512.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en-IN",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Any (web browser)",
      description: SITE_DESCRIPTION,
      image: `${SITE_URL}/og-image.png`,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" data-theme="light">
      <body>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {children}
      </body>
    </html>
  );
}
