// src/lib/free-input.ts
// 自由入力受付メッセージ判定の共通 helper。
//
// 背景:
//   runtime には camelCase (Prisma 直接 fetch / KeywordMessageRecord) と snake_case
//   (messageRowToRuntime 経由の RuntimePhaseMessage) の両方の message オブジェクトが
//   流れている。停止判定をどちらかの片方だけで行うと、フィールド名が不一致な経路で
//   stop が発火せず、自由入力プロンプト後の不要送信が漏れる事故が起きやすい。
//
//   この helper を全ての停止判定で使うことで、フィールド名差異による判定漏れを
//   構造的に防ぐ。
//
// 仕様:
//   - `m.freeInputEnabled === true` または `m.free_input_enabled === true` で true
//   - その他 (null / undefined / false) は全て false
//   - PII / id は出さない (= 純粋関数)

/**
 * 自由入力受付メッセージかどうかを判定する。
 * camelCase (Prisma raw) と snake_case (RuntimePhaseMessage) の両方に対応。
 *
 * 使用箇所:
 *   - src/lib/line.ts buildPhaseMessages の chain walk 停止判定
 *   - src/app/api/line/[oaId]/webhook/route.ts buildMessageChain の chain walk 停止判定
 */
export function isFreeInputPrompt(m: {
  freeInputEnabled?:  boolean | null;
  free_input_enabled?: boolean | null;
} | null | undefined): boolean {
  if (!m) return false;
  return m.freeInputEnabled === true || m.free_input_enabled === true;
}
