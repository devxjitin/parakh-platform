import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export: served from S3 + CloudFront. Output goes to `out/`.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Shared constants and types are imported straight from the app's shared package source.
  experimental: { externalDir: true },
  // The shared UI lives in ../app/packages/ui. When only the website is installed (as in CI), the
  // app's node_modules is missing, so also look for packages such as react in this site's own.
  webpack(config) {
    config.resolve.modules = [...(config.resolve.modules ?? ['node_modules']), here('./node_modules')];
    return config;
  },
};

export default nextConfig;
