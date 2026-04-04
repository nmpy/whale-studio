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
  // BYPASS_AUTH=true 時のスタブ
  if (userId === "bypass-admin") return true;

  // 開発スタブ: Supabase 未設定の開発環境では dev-user を常にオーナーとする
  if (
    userId === "dev-user" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NODE_ENV === "development"
  ) {
    return true;
  }

  // 環境変数で設定されたプラットフォームオーナー
  const envIds = process.env.PLATFORM_ADMIN_USER_IDS ?? "";
  if (!envIds.trim()) return false;

  return envIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}
