// src/__tests__/chain-overflow.test.ts
//
// 連続メッセージの overflow 検出ロジック検証。
//   - chainLengthFrom: 実チェーン長（上限なし）— 「合計N通」表示 + 5通超警告用
//   - estimatePhaseSendBatch: フェーズ入場時の一括送信通数（buildPhaseMessages 踏襲）
//     > 5 なら 6通目以降が Push fallback になる
// 背景: 「通常2」が合計6通でフェーズ一括送信 → 6通目以降が Push → 月間上限で停止。

import { describe, it, expect } from "vitest";
import { chainLengthFrom, estimatePhaseSendBatch, maxResponseSendSize, chainSizeFrom, LINE_REPLY_MAX } from "@/app/oas/[id]/works/[workId]/messages/_list-helpers";

type M = { id: string; next_message_id?: string | null; free_input_enabled?: boolean | null };
const link = (ids: string[]): M[] =>
  ids.map((id, i) => ({ id, next_message_id: i < ids.length - 1 ? ids[i + 1] : null }));

describe("chainLengthFrom（実チェーン長・上限なし）", () => {
  it("head から終端までの実件数を返す（5件で打ち切らない）", () => {
    const msgs = link(["a", "b", "c", "d", "e", "f"]); // 6連鎖
    expect(chainLengthFrom(msgs, "a")).toBe(6);
    // chainSizeFrom は 5 で打ち切る（対比）
    expect(chainSizeFrom(msgs, "a")).toBe(5);
  });

  it("単独メッセージは 1", () => {
    expect(chainLengthFrom([{ id: "x", next_message_id: null }], "x")).toBe(1);
  });

  it("循環があっても無限ループしない", () => {
    const msgs: M[] = [{ id: "a", next_message_id: "b" }, { id: "b", next_message_id: "a" }];
    expect(chainLengthFrom(msgs, "a")).toBe(2);
  });

  it("配列に存在しない next を指したらそこで止まる", () => {
    const msgs: M[] = [{ id: "a", next_message_id: "ghost" }];
    expect(chainLengthFrom(msgs, "a")).toBe(1);
  });
});

describe("estimatePhaseSendBatch（フェーズ一括送信通数）", () => {
  it("単一 head・5連鎖 → 5（上限ちょうど・overflow しない）", () => {
    const msgs = link(["a", "b", "c", "d", "e"]);
    expect(estimatePhaseSendBatch(msgs)).toBe(5);
    expect(estimatePhaseSendBatch(msgs) > LINE_REPLY_MAX).toBe(false);
  });

  it("複数 head の合算で 6 → overflow（通常2 を再現: 5連鎖 + 単独1）", () => {
    // head1: ええ→そんな記憶→あっ→とっても昔→気づいたら手紙 (5)
    const chain1 = link(["h1", "c1", "c2", "c3", "c4"]);
    // head2: ぼくは赤いポスト (1・continuation ではない別 head)
    const head2: M = { id: "h2", next_message_id: null };
    const phase = [...chain1, head2];
    expect(estimatePhaseSendBatch(phase)).toBe(6);
    expect(estimatePhaseSendBatch(phase) > LINE_REPLY_MAX).toBe(true);
  });

  it("各 chain は最大5件で打ち切る（6連鎖 head は 5 として数える）", () => {
    const phase = link(["a", "b", "c", "d", "e", "f"]); // 6連鎖（1 head）
    expect(estimatePhaseSendBatch(phase)).toBe(5);
  });

  it("free_input_enabled に達したらフェーズ全体の走査を停止する", () => {
    // head1 の途中(b)が free_input → b を含めて停止。後続 head2 は送られない。
    const phase: M[] = [
      { id: "h1", next_message_id: "b" },
      { id: "b", next_message_id: "c", free_input_enabled: true },
      { id: "c", next_message_id: null },
      { id: "h2", next_message_id: null }, // 別 head（free_input 後なので送られない）
    ];
    expect(estimatePhaseSendBatch(phase)).toBe(2); // h1, b まで
  });

  it("continuation は head として二重カウントしない", () => {
    // h1→c1→c2 の3連鎖のみ。c1/c2 は continuation。
    const phase = link(["h1", "c1", "c2"]);
    expect(estimatePhaseSendBatch(phase)).toBe(3);
  });
});

describe("maxResponseSendSize（1応答=連続送信単位の最大通数）", () => {
  it("単一 chain 5連鎖 → 5（警告対象）", () => {
    const phase = link(["a", "b", "c", "d", "e"]);
    expect(maxResponseSendSize(phase)).toBe(5);
    expect(maxResponseSendSize(phase) >= LINE_REPLY_MAX).toBe(true);
  });

  it("複数 head はフェーズ総数で合算しない: 2通+3通の別 head → 最大3（警告なし）", () => {
    // ★誤検知の核心ケース: フェーズ総数は5だが、各応答単位は2通/3通で5未満。
    const unitA = link(["a1", "a2"]);          // 入場の連続2通
    const unitB = link(["b1", "b2", "b3"]);    // QR/入力後の別 head（continuation 参照なし）= 別単位
    const phase = [...unitA, ...unitB];
    expect(maxResponseSendSize(phase)).toBe(3);
    expect(maxResponseSendSize(phase) >= LINE_REPLY_MAX).toBe(false);
  });

  it("フェーズ総数10でも各応答が5未満なら警告対象にならない（スクショ事例）", () => {
    const u1 = link(["x1", "x2", "x3"]);       // 3
    const u2 = link(["y1", "y2", "y3"]);       // 3
    const u3 = link(["z1", "z2", "z3", "z4"]); // 4
    const phase = [...u1, ...u2, ...u3];        // 総数10
    expect(maxResponseSendSize(phase)).toBe(4);
    expect(maxResponseSendSize(phase) >= LINE_REPLY_MAX).toBe(false);
  });

  it("free_input プロンプトを含めて打ち切る（以降は別の応答単位）", () => {
    // a→b(freeInput)→c→d→e→f: 同一 chain でも freeInput で区切られ、a,b の2通が単位。
    const phase: M[] = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "c", free_input_enabled: true },
      { id: "c", next_message_id: "d" },
      { id: "d", next_message_id: "e" },
      { id: "e", next_message_id: "f" },
      { id: "f", next_message_id: null },
    ];
    expect(maxResponseSendSize(phase)).toBe(2); // a, b まで（c 以降は continuation で別 head ではないが freeInput で停止）
  });

  it("6連鎖の単一 head は実長6を返す（>=5 で警告）", () => {
    const phase = link(["a", "b", "c", "d", "e", "f"]);
    expect(maxResponseSendSize(phase)).toBe(6);
    expect(maxResponseSendSize(phase) >= LINE_REPLY_MAX).toBe(true);
  });

  it("循環があっても無限ループしない", () => {
    const phase: M[] = [{ id: "a", next_message_id: "b" }, { id: "b", next_message_id: "a" }];
    // a は b に参照され continuation、b は a に参照され continuation → head なし → 0
    expect(maxResponseSendSize(phase)).toBe(0);
  });
});
