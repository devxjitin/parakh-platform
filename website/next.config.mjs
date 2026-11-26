/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export: served from S3 + CloudFront. Output goes to `out/`.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Shared constants and types are imported straight from the app's shared package source.
  experimental: { externalDir: true },
};

export default nextConfig;
