// src/lib/qr-branch.ts
//
// QR 分岐（クイックリプライのタップ）で「何を送信の起点にするか」を決める純関数。
// webhook ルート (src/app/api/line/[oaId]/webhook/route.ts) の送信組み立てと
// テストの両方が同じ判定を参照できるよう、決定ロジックをここに集約する。
//
// 仕様:
//   - target_message_id（target_type="message"）がある場合は「target chain」を正とする。
//     = response_message_id のチェーンを target より前に自動で割り込ませない。
//     管理画面で「入力 → あっ」と設定したとおり「入力 → target → target の chain」で届く。
//   - target_message_id が無い場合は従来どおり response_message_id のチェーンを送る（既存互換）。
//   - target_phase_id（フェーズ遷移）は別パスのため、ここでは message target のみを判定対象とする。

export type QrBranchInput = {
  target_type?: "phase" | "message";
  target_message_id?: string | null;
  target_phase_id?: string | null;
  response_message_id?: string | null;
};

export type QrBranchResolution = {
  /** "target_chain" = target を起点に送る / "response_chain" = response を起点に送る */
  mode: "target_chain" | "response_chain";
  /** 送信の起点となるメッセージ ID（無ければ null） */
  selectedRootMessageId: string | null;
  /** response_message_id のチェーンを送るか（target がある場合は false = 混ぜない） */
  sendResponseChain: boolean;
};

/** QR 分岐の送信起点を決定する。 */
export function resolveQrBranchDelivery(item: QrBranchInput): QrBranchResolution {
  const hasMessageTarget = item.target_type === "message" && !!item.target_message_id;
  if (hasMessageTarget) {
    return {
      mode: "target_chain",
      selectedRootMessageId: item.target_message_id ?? null,
      sendResponseChain: false,
    };
  }
  return {
    mode: "response_chain",
    selectedRootMessageId: item.response_message_id ?? null,
    sendResponseChain: true,
  };
}
