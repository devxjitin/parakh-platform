/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@parakh/shared', '@parakh/ui'],
  // Static export: served from S3 + CloudFront (see infra/terraform/cdn.tf). Output goes to `out/`.
  output: 'export',
  // /register/ -> register/index.html (served by the CloudFront rewrite function)
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
