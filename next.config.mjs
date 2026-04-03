/** @type {import('next').NextConfig} */
const nextConfig = {
  // @upstash/redis は HTTP ベースの純粋 JS クライアント。
  // webpack でバンドルせず Node.js の require() でランタイムロードする（推奨）。
  serverExternalPackages: ["@upstash/redis"],

  async rewrites() {
    return [
      // テスターモード: /tester/{oaId}/works/{workId}/{path+} を
      // /oas/{oaId}/works/{workId}/{path} にリライト（URL バーは /tester/ のまま）。
      // /tester/[oaId]/works/[workId] 自体は Next.js の実ページが存在するため除外される。
      {
        source: "/tester/:oaId/works/:workId/:path+",
        destination: "/oas/:oaId/works/:workId/:path",
      },
    ];
  },
};

export default nextConfig;
