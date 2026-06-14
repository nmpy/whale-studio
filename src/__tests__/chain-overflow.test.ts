// src/__tests__/chain-overflow.test.ts
//
// 連続メッセージの overflow 検出ロジック検証。
//   - chainLengthFrom: 実チェーン長（上限なし）— 「合計N通」表示 + 5通超警告用
//   - estimatePhaseSendBatch: フェーズ入場時の一括送信通数（buildPhaseMessages 踏襲）
//     > 5 なら 6通目以降が Push fallback になる
// 背景: 「通常2」が合計6通でフェーズ一括送信 → 6通目以降が Push → 月間上限で停止。

import { describe, it, expect } from "vitest";
import { chainLengthFrom, estimatePhaseSendBatch, estimateMaxSendUnit, chainSizeFrom, LINE_REPLY_MAX } from "@/app/oas/[id]/works/[workId]/messages/_list-helpers";
import type { SendUnitMessage } from "@/app/oas/[id]/works/[workId]/messages/_list-helpers";

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

describe("estimateMaxSendUnit（実送信=1 replyToken 単位の最大通数）", () => {
  // kind 未指定は normal 扱い。link() は kind を持たないため normal の連鎖になる。
  const u = (m: Partial<SendUnitMessage> & { id: string }): SendUnitMessage => ({ kind: "normal", ...m });

  it("入場の単一 chain 5連鎖 → 5（警告対象）", () => {
    const phase = link(["a", "b", "c", "d", "e"]) as SendUnitMessage[];
    expect(estimateMaxSendUnit(phase)).toBe(5);
    expect(estimateMaxSendUnit(phase) >= LINE_REPLY_MAX).toBe(true);
  });

  it("入場は複数 head を連結して送る（2通+3通の独立 head → 入場で5通＝警告）", () => {
    // runtime: 自動送信 head を sortOrder 順に連結し、wait node が無ければまとめて送る。
    const phase = [...link(["a1", "a2"]), ...link(["b1", "b2", "b3"])] as SendUnitMessage[];
    expect(estimateMaxSendUnit(phase)).toBe(5);
  });

  it("途中に puzzle（回答待ち）が挟まると入場送信はそこで区切られる（スクショ事例）", () => {
    // 入場: n1→n2→puzzle(停止) = 3通。puzzle 後の応答 head は別トリガーで別単位。
    const phase: SendUnitMessage[] = [
      u({ id: "n1", next_message_id: "n2" }),
      u({ id: "n2", next_message_id: "pz" }),
      u({ id: "pz", kind: "puzzle", next_message_id: null }),
      // 謎正解後に送る想定の別 head 群（入場では送られない別単位・各<5）
      ...(link(["r1", "r2", "r3"]) as SendUnitMessage[]).map((m) => u(m)),
    ];
    // フェーズ総数は6だが、入場は3通で停止・応答も3通 → 5未満で警告なし。
    expect(estimateMaxSendUnit(phase)).toBe(3);
    expect(estimateMaxSendUnit(phase) >= LINE_REPLY_MAX).toBe(false);
  });

  it("QR 末尾で入場送信が停止する（QR 分岐先は入場に含めない）", () => {
    // 入場: h→（QR付き末尾）で停止 = 2通。QR target t1→t2→t3→t4→t5 は別トリガー＝5通で警告。
    const phase: SendUnitMessage[] = [
      u({ id: "h", next_message_id: "q" }),
      u({ id: "q", next_message_id: null, quick_replies: [{ action: "next", target_message_id: "t1" }] }),
      u({ id: "t1", next_message_id: "t2" }),
      u({ id: "t2", next_message_id: "t3" }),
      u({ id: "t3", next_message_id: "t4" }),
      u({ id: "t4", next_message_id: "t5" }),
      u({ id: "t5", next_message_id: null }),
    ];
    // QR応答（t1..t5）が5通 → 警告対象。
    expect(estimateMaxSendUnit(phase)).toBe(5);
    expect(estimateMaxSendUnit(phase) >= LINE_REPLY_MAX).toBe(true);
  });

  it("free_input 後の応答(freeInputNext)は別単位として数える", () => {
    // 入場: a→b(freeInput,停止)=2通。入力後 r1→r2=2通。どちらも<5。
    const phase: SendUnitMessage[] = [
      u({ id: "a", next_message_id: "b" }),
      u({ id: "b", free_input_enabled: true, free_input_next_message_id: "r1", next_message_id: null }),
      u({ id: "r1", next_message_id: "r2" }),
      u({ id: "r2", next_message_id: null }),
    ];
    expect(estimateMaxSendUnit(phase)).toBe(2);
    expect(estimateMaxSendUnit(phase) >= LINE_REPLY_MAX).toBe(false);
  });

  it("response/hint は入場送信に含めない（キーワード応答は別単位）", () => {
    const phase: SendUnitMessage[] = [
      u({ id: "a", next_message_id: null }),                               // 入場 1通
      u({ id: "resp", kind: "response", trigger_keyword: "あいことば", next_message_id: "r2" }),
      u({ id: "r2", next_message_id: "r3" }),
      u({ id: "r3", next_message_id: null }),
    ];
    // 入場は a の1通のみ。response トリガー応答は resp→r2→r3=3通。最大3。
    expect(estimateMaxSendUnit(phase)).toBe(3);
  });

  it("循環があっても無限ループしない", () => {
    const phase: SendUnitMessage[] = [
      u({ id: "a", next_message_id: "b" }),
      u({ id: "b", next_message_id: "a" }),
    ];
    expect(estimateMaxSendUnit(phase)).toBe(0); // 両者 continuation → 入場 head なし
  });
});
