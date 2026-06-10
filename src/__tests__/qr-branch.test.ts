// src/__tests__/qr-branch.test.ts
//
// QR 分岐の送信起点決定 (resolveQrBranchDelivery) と、その結果に基づく
// 最終送信順の検証。
//
// 背景: 「見せてほしい」分岐で実機の送信順が管理画面の設定と一致しなかった不具合。
//   旧挙動: response_message_id のチェーン → target_message_id のチェーン（response が先に割り込む）
//   新挙動: target_message_id がある場合は target chain のみを正として送る。

import { describe, it, expect } from "vitest";
import { resolveQrBranchDelivery, type QrBranchInput } from "@/lib/qr-branch";

describe("resolveQrBranchDelivery（QR 分岐の送信起点）", () => {
  it("target_message_id（target_type=message）があれば target を正とし response は送らない", () => {
    const item: QrBranchInput = {
      target_type: "message",
      target_message_id: "T1",
      response_message_id: "R1",
    };
    const r = resolveQrBranchDelivery(item);
    expect(r.mode).toBe("target_chain");
    expect(r.selectedRootMessageId).toBe("T1");
    expect(r.sendResponseChain).toBe(false);
  });

  it("target_message_id が無ければ従来どおり response を起点に送る（既存互換）", () => {
    const item: QrBranchInput = {
      response_message_id: "R1",
    };
    const r = resolveQrBranchDelivery(item);
    expect(r.mode).toBe("response_chain");
    expect(r.selectedRootMessageId).toBe("R1");
    expect(r.sendResponseChain).toBe(true);
  });

  it("target_type=phase は message target ではないので response_chain（フェーズ遷移は別パス）", () => {
    const item: QrBranchInput = {
      target_type: "phase",
      target_phase_id: "P1",
      response_message_id: "R1",
    };
    const r = resolveQrBranchDelivery(item);
    expect(r.mode).toBe("response_chain");
    expect(r.sendResponseChain).toBe(true);
  });

  it("target_type=message でも target_message_id が空なら response_chain にフォールバック", () => {
    const item: QrBranchInput = {
      target_type: "message",
      target_message_id: null,
      response_message_id: "R1",
    };
    const r = resolveQrBranchDelivery(item);
    expect(r.mode).toBe("response_chain");
    expect(r.selectedRootMessageId).toBe("R1");
  });

  it("response も target も無ければ selectedRootMessageId は null", () => {
    expect(resolveQrBranchDelivery({}).selectedRootMessageId).toBeNull();
  });
});

// ── 最終送信順の検証 ──
// resolveQrBranchDelivery の結果に従って webhook ルートが組み立てる qrMsgs の順序を、
// nextMessageId チェーン walk のミニ実装で再現して検証する。
// （ルート本体の組み立て: target なら response を push せず target chain のみを push する）

type MsgRow = { id: string; body: string; nextMessageId: string | null };

function walkChain(store: Map<string, MsgRow>, headId: string | null, limit = 5): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  let cur = headId;
  while (cur && !visited.has(cur) && out.length < limit) {
    const row = store.get(cur);
    if (!row) break;
    visited.add(cur);
    out.push(row.id);
    cur = row.nextMessageId;
  }
  return out;
}

/** webhook ルートの qrMsgs 組み立てを最小再現して、最終送信 ID 列を返す。 */
function assembleQrSendOrder(item: QrBranchInput, store: Map<string, MsgRow>): string[] {
  const r = resolveQrBranchDelivery(item);
  const ids: string[] = [];
  // Step 2: response chain（target がある場合は送らない）
  if (r.sendResponseChain && item.response_message_id) {
    ids.push(...walkChain(store, item.response_message_id));
  }
  // Step 3a: target chain
  if (r.mode === "target_chain") {
    ids.push(...walkChain(store, item.target_message_id ?? null));
  }
  return ids;
}

describe("QR 分岐の最終送信順（[line:delivery:final-order] に相当）", () => {
  // 「見せてほしい」分岐の再現データ
  const store = new Map<string, MsgRow>([
    ["R1", { id: "R1", body: "うん、一緒に探して", nextMessageId: "R2" }],
    ["R2", { id: "R2", body: "ただその前に", nextMessageId: null }],
    ["T1", { id: "T1", body: "あっ", nextMessageId: "T2" }],
    ["T2", { id: "T2", body: "それはね", nextMessageId: "T3" }],
    ["T3", { id: "T3", body: "昨日、上から赤いポストが", nextMessageId: "T4" }],
    ["T4", { id: "T4", body: "そのポストは", nextMessageId: null }],
  ]);

  it("target あり: final-order は target chain だけ（response は割り込まない）", () => {
    const item: QrBranchInput = {
      target_type: "message",
      target_message_id: "T1",
      response_message_id: "R1",
    };
    const order = assembleQrSendOrder(item, store);
    expect(order).toEqual(["T1", "T2", "T3", "T4"]);
    // 旧 NG 挙動 (R1,R2 が先頭) になっていないこと
    expect(order[0]).not.toBe("R1");
    expect(order).not.toContain("R1");
    expect(order).not.toContain("R2");
  });

  it("target なし: 従来どおり response chain が送られる（既存互換）", () => {
    const item: QrBranchInput = { response_message_id: "R1" };
    const order = assembleQrSendOrder(item, store);
    expect(order).toEqual(["R1", "R2"]);
  });
});
