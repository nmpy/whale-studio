// src/hooks/platform-owner.ts
// /api/admin/me のレスポンスから is_platform_owner を導出する純関数（PR-AUTH2）。
// 「true だけでなく false も明示反映する／!ok(body=null) も false に確定する」ロジックを一箇所に集約し、
// React 非依存で node 環境でも単体テストできるようにする。usePlatformRole から利用。

export function platformOwnerFromResponseBody(
  body: { data?: { is_platform_owner?: boolean } } | null | undefined,
): boolean {
  return Boolean(body?.data?.is_platform_owner);
}
