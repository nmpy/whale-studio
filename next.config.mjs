/** @type {import('next').NextConfig} */
const nextConfig = {
  // @upstash/redis は HTTP ベースの純粋 JS クライアント。
  // webpack でバンドルせず Node.js の require() でランタイムロードする（推奨）。
  serverExternalPackages: ["@upstash/redis"],

  async rewrites() {
    return [
      // テスターモード: /tester/{oaId}/works/new を
      // /oas/{oaId}/works/new にリライト（URL バーは /tester/ のまま）。
      // ※ :workId パターンより先に定義して "new" を捕捉する。
      {
        source: "/tester/:oaId/works/new",
        destination: "/oas/:oaId/works/new",
      },
      // テスターモード: /tester/{oaId}/works/{workId}/{path+} を
      // /oas/{oaId}/works/{workId}/{path*} にリライト（URL バーは /tester/ のまま）。
      // :path+ はソースで「1 段以上」を要求し、配列としてキャプチャされる。
      // デスティネーションは :path* にしないと path-to-regexp が
      // "Expected to not repeat, got array" エラーを投げて 500 になるため注意。
      // /tester/[oaId]/works/[workId] 自体は Next.js の実ページが存在するため除外される。
      {
        source: "/tester/:oaId/works/:workId/:path+",
        destination: "/oas/:oaId/works/:workId/:path*",
      },
    ];
  },
};

export default nextConfig;
