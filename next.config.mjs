/** @type {import('next').NextConfig} */
const nextConfig = {
  // @upstash/redis は HTTP ベースの純粋 JS クライアント。
  // webpack でバンドルせず Node.js の require() でランタイムロードする（推奨）。
  serverExternalPackages: ["@upstash/redis"],
};

export default nextConfig;
