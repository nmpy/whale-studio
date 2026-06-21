// src/lib/liff-page-delete.ts
// PR-B: LIFF ページの「完全削除」可否判定（純ロジック・no JSX/DB → node テスト可）。
//
// 削除をブロックする条件（安全重視）:
//   - published   : 公開中ページは削除不可（先に非公開 / アーカイブする）。
//   - referenced  : 他の設定（button_link.liff_page_id / Message.imageActionLiffPageId 等）から
//                   参照されているページは削除不可（参照解除は今回やらない）。
// 参照件数（referenceCount）は呼び出し側（API）が DB から集計して渡す。本関数は純粋に可否のみ判定する。
// archived / draft かつ参照なしのみ削除可能。

export type LiffPageDeleteBlockReason = "published" | "referenced";

export const LIFF_PAGE_DELETE_MESSAGES: Record<LiffPageDeleteBlockReason, string> = {
  published:  "公開中のページは削除できません。先に非公開またはアーカイブしてください。",
  referenced: "このページは他の設定から参照されているため削除できません。先に参照を解除してください。",
};

/**
 * 削除をブロックする理由を返す（null = 削除可能）。
 * published を referenced より優先（まず非公開化を促すため）。
 */
export function getLiffPageDeleteBlockReason(args: {
  publishStatus: string;
  referenceCount: number;
}): LiffPageDeleteBlockReason | null {
  if (args.publishStatus === "published") return "published";
  if (args.referenceCount > 0) return "referenced";
  return null;
}

/** 削除可能なら true（archived / draft かつ参照なし）。 */
export function canDeleteLiffPage(args: { publishStatus: string; referenceCount: number }): boolean {
  return getLiffPageDeleteBlockReason(args) === null;
}
