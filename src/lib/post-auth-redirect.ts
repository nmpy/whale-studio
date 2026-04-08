// src/lib/post-auth-redirect.ts
// 認証完了後のリダイレクト先を統一的に決定するヘルパー。
//
// source:
//   "login"          — 通常ログイン / 登録 → /oas
//   "invite"         — 招待経由 → /invite/[token] に戻る
//   "reset-password" — パスワードリセット → /oas

/**
 * 認証完了後のリダイレクト先パスを返す。
 *
 * @param source  遷移元（"login" | "invite" | "reset-password"）
 * @param token   invite トークン（source="invite" のとき必須）
 */
export function getPostAuthRedirect(opts: {
  source: "login" | "invite" | "reset-password";
  token?: string;
}): string {
  switch (opts.source) {
    case "invite":
      return opts.token ? `/invite/${opts.token}` : "/oas";
    case "reset-password":
      return "/oas";
    case "login":
    default:
      return "/oas";
  }
}
