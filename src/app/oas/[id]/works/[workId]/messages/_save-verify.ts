// src/app/oas/[id]/works/[workId]/messages/_save-verify.ts
//
// メッセージ保存後の「DB反映検証」用の純関数。
// 保存 API 完了後に対象メッセージ＋chain を再 fetch し、期待値と一致するかを比較する。
// 一致しない（= no-op保存 / 途中失敗 / 反映漏れ）場合に成功扱いせず警告するために使う。
//
// 純関数なので vitest で単体テスト可能（I/O は呼び出し側）。

export type SaveVerifyExpected = {
  body:                   string | null;
  characterId:            string | null;
  /** quick_replies の JSON 文字列（保存 payload と同じ）。null = QRなし */
  quickRepliesJson:       string | null;
  freeInputEnabled:       boolean;
  freeInputNextMessageId: string | null;
  /** 期待する chain（head 含む送信順 messageId 列）。例: [head, slot1, slot2] */
  chainIds:               string[];
  /** 今回の保存で削除したスロット messageId（再fetchで存在しないはず） */
  removedIds:             string[];
};

export type SaveVerifyActual = {
  body:                   string | null;
  characterId:            string | null;
  quickRepliesJson:       string | null;
  freeInputEnabled:       boolean;
  freeInputNextMessageId: string | null;
  /** head から next_message_id を walk した実 chain（head 含む） */
  walkedChainIds:         string[];
  /** work 内に存在する全 messageId（削除確認・作成確認用） */
  existingIds:            string[];
};

export type SaveVerifyResult = { ok: boolean; mismatches: string[] };

const nb = (s: string | null | undefined): string => (s ?? "").trim();

/** QR を本質フィールドだけに射影して比較（value/enabled 等のサーバ正規化差で誤検知しないため）。 */
function normQr(json: string | null | undefined): string {
  if (!json) return "[]";
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return "[]";
    return JSON.stringify(
      arr.map((i: Record<string, unknown>) => ({
        label:               i.label ?? null,
        action:              i.action ?? null,
        target_type:         i.target_type ?? null,
        target_phase_id:     i.target_phase_id ?? null,
        target_message_id:   i.target_message_id ?? null,
        response_message_id: i.response_message_id ?? null,
      })),
    );
  } catch {
    return json;
  }
}

/** 保存後の再fetch結果が期待と一致するか検証する。 */
export function verifyMessageSave(exp: SaveVerifyExpected, act: SaveVerifyActual): SaveVerifyResult {
  const mm: string[] = [];

  if (nb(exp.body) !== nb(act.body)) mm.push("本文(body)");
  if ((exp.characterId ?? null) !== (act.characterId ?? null)) mm.push("キャラクター(characterId)");
  if (normQr(exp.quickRepliesJson) !== normQr(act.quickRepliesJson)) mm.push("クイックリプライ(quickReplies)");
  if (!!exp.freeInputEnabled !== !!act.freeInputEnabled) mm.push("自由入力(freeInputEnabled)");
  if ((exp.freeInputNextMessageId ?? null) !== (act.freeInputNextMessageId ?? null)) mm.push("自由入力の次メッセージ(freeInputNextMessageId)");

  // chain（送信順 messageId 列）の一致
  if (exp.chainIds.join(",") !== act.walkedChainIds.join(",")) {
    mm.push(`連続メッセージの並び(chain)（期待 ${exp.chainIds.length}通 / 実際 ${act.walkedChainIds.length}通）`);
  }

  // 削除したスロットが残っていないこと
  const existing = new Set(act.existingIds);
  for (const id of exp.removedIds) {
    if (existing.has(id)) mm.push(`削除したはずのスロットが残存: ${id.slice(0, 8)}`);
  }
  // 期待 chain の各 messageId が存在すること（作成スロット含む）
  for (const id of exp.chainIds) {
    if (!existing.has(id)) mm.push(`期待した chain メッセージが存在しない: ${id.slice(0, 8)}`);
  }

  return { ok: mm.length === 0, mismatches: mm };
}
