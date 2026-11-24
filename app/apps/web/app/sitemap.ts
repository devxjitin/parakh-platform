import type { MetadataRoute } from 'next';
import { APP_ORIGIN, PUBLIC_PATHS } from '../lib/seo';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: `${APP_ORIGIN}${path}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: path === '/login/' || path === '/register/' ? 0.8 : 0.4,
  }));
}
