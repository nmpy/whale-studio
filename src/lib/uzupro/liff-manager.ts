// src/lib/uzupro/liff-manager.ts
// for UZU Pro の「LIFF 管理者」判定（サーバー専用）。
//
// 目的: LIFF URL 発行/再発行/一括発行、および LINE User ID の手動登録/手動解除は、
//   通常の for UZU Pro 閲覧権限（canAccessUzuPro = Work.uzuProEnabled ∧ UzuProGrant ∧ active member）
//   とは **別に**、明示的に許可された単一（将来複数可）の認証ユーザーだけに限定する。
//
// 設計判断（最小・安全・既存踏襲）:
//   - 既存の platform-admin (PLATFORM_ADMIN_USER_IDS) と同じ「サーバー側 env allowlist に
//     Supabase User ID を列挙」方式を採用（優先順位 (1)）。クライアント申告 ID / メール比較は使わない。
//   - isPlatformOwner / Admin による自動迂回は **しない**（発行・手動操作は allowlist のみで判定）。
//   - allowlist が空（未設定）なら誰も LIFF 管理者ではない（fail-closed）。dev スタブ迂回も設けない。
//   - 単一アカウント運用を既定とし、必要なら env にカンマ区切りで追加して allowlist を拡張できる。
//
// 環境変数: UZU_PRO_LIFF_MANAGER_USER_IDS
//   形式: カンマ区切りの Supabase User ID（例: "11111111-2222-3333-4444-555555555555"）。
//   単一運用なら 1 件のみ設定する。

/**
 * 指定ユーザーが for UZU Pro の LIFF 管理者（発行・手動 LINE 操作の実行者）かを判定する。
 * env allowlist に含まれる場合のみ true。未設定/空なら常に false（fail-closed）。
 */
export function isAuthorizedLiffManager(userId: string | null | undefined): boolean {
  const id = (userId ?? "").trim();
  if (!id) return false;
  const allowlist = (process.env.UZU_PRO_LIFF_MANAGER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.includes(id);
}
