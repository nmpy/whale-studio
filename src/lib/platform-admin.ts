// src/lib/platform-admin.ts
// プラットフォームオーナー判定ユーティリティ（サーバーサイド専用）
//
// 環境変数 PLATFORM_ADMIN_USER_IDS にカンマ区切りのSupabase User IDを列挙することで
// 本番環境でもプラットフォームオーナーを設定できます。
//
// 暫定ルール（β版）:
//   BYPASS_AUTH=true 時の bypass-admin、
//   および開発環境（Supabase 未設定）の dev-user は常にオーナー扱い

/**
 * 指定ユーザーがプラットフォームオーナーかどうかを判定する。
 *
 * プラットフォームオーナーは:
 *   - 全 OA の一覧を閲覧できる
 *   - お知らせを投稿・編集できる
 *   - サポート PDF をアップロードできる
 *   - 他のロールからの見え方をプレビューできる
 */
export function isPlatformOwner(userId: string): boolean {
  // BYPASS_AUTH=true 時のスタブ（開発環境のみ）
  if (userId === "bypass-admin" && process.env.NODE_ENV !== "production") return true;

  // 環境変数で設定されたプラットフォームオーナーリスト（設定済みの場合はこれを優先）
  // PLATFORM_ADMIN_USER_IDS が設定されている場合はリストのみで判定し、開発スタブは適用しない。
  // 例: PLATFORM_ADMIN_USER_IDS=dev-user          → dev-user のみオーナー
  //     PLATFORM_ADMIN_USER_IDS=some-other-id     → dev-user は非オーナーとして動作（UI確認用）
  //     PLATFORM_ADMIN_USER_IDS=（未設定 or 空）   → 開発スタブにフォールバック
  const envIds = process.env.PLATFORM_ADMIN_USER_IDS ?? "";
  const allowlist = envIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }

  // 開発スタブ: Supabase 未設定 + PLATFORM_ADMIN_USER_IDS 未設定の開発環境では
  // dev-user を常にオーナーとする（初期セットアップの利便性のため）
  if (
    userId === "dev-user" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NODE_ENV === "development"
  ) {
    return true;
  }

  return false;
}
