import type { MetadataRoute } from 'next';
import { APP_ORIGIN, PRIVATE_PATHS, PUBLIC_PATHS } from '../lib/seo';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: [...PUBLIC_PATHS], disallow: [...PRIVATE_PATHS] }],
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
    host: APP_ORIGIN,
  };
}
