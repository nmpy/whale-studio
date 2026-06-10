// src/__tests__/qr-frontier.test.ts
//
// QR frontier（現在地に紐づく QR だけを有効にする）ロジックの検証。
// 背景: target_message_id 分岐後に進行位置が動かず、過去 QR の再タップで同じ chain が
//   無限再送される問題への対策（UserProgress.lastSentMessageIds で QR 照合範囲を限定）。

import { describe, it, expect } from "vitest";
import { parseFrontier, selectQrScope } from "@/lib/qr-frontier";

describe("parseFrontier", () => {
  it("正常な JSON string[] を Set にする", () => {
    const f = parseFrontier(JSON.stringify(["a", "b", "c"]));
    expect(f).toBeInstanceOf(Set);
    expect([...(f as Set<string>)]).toEqual(["a", "b", "c"]);
  });

  it("null / undefined / 空文字 は null（レガシー fallback）", () => {
    expect(parseFrontier(null)).toBeNull();
    expect(parseFrontier(undefined)).toBeNull();
    expect(parseFrontier("")).toBeNull();
  });

  it("空配列 は null（fallback）", () => {
    expect(parseFrontier("[]")).toBeNull();
  });

  it("壊れた JSON は null（本番で落ちない）", () => {
    expect(parseFrontier("{not json")).toBeNull();
    expect(parseFrontier("nope")).toBeNull();
  });

  it("非配列 JSON は null", () => {
    expect(parseFrontier('{"a":1}')).toBeNull();
    expect(parseFrontier('"str"')).toBeNull();
  });

  it("文字列以外の要素は除外する", () => {
    const f = parseFrontier(JSON.stringify(["x", 1, null, "y", true]));
    expect([...(f as Set<string>)]).toEqual(["x", "y"]);
  });
});

type Msg = { id: string; quickReplies: string | null };
const msg = (id: string, qr = false): Msg => ({
  id,
  quickReplies: qr ? JSON.stringify([{ label: "ポストが！？", action: "text", target_message_id: "T1" }]) : null,
});

describe("selectQrScope（QR 照合範囲の決定）", () => {
  const S = msg("S", true);                 // QR を持つ source メッセージ
  const chain = [msg("T1"), msg("T2"), msg("T3"), msg("T4")]; // target chain（QR なし）
  const phaseMessages = [S, ...chain];

  it("frontier=null（レガシー）→ 全メッセージを走査（mode=phase_legacy）", () => {
    const { scoped, mode } = selectQrScope(phaseMessages, null);
    expect(mode).toBe("phase_legacy");
    expect(scoped.map((m) => m.id)).toEqual(["S", "T1", "T2", "T3", "T4"]);
  });

  it("frontier=[S]（現在地が source）→ S だけが候補 = QR 有効", () => {
    const { scoped, mode } = selectQrScope(phaseMessages, new Set(["S"]));
    expect(mode).toBe("frontier");
    expect(scoped.map((m) => m.id)).toEqual(["S"]);
  });

  it("frontier=[T1..T4]（chain 送信後）→ S は範囲外 = 古い QR は無効（無限再送を防ぐ）", () => {
    const { scoped, mode } = selectQrScope(phaseMessages, new Set(["T1", "T2", "T3", "T4"]));
    expect(mode).toBe("frontier");
    expect(scoped.map((m) => m.id)).toEqual(["T1", "T2", "T3", "T4"]);
    // S が候補に含まれない = S の QR「ポストが！？」は再マッチしない
    expect(scoped.some((m) => m.id === "S")).toBe(false);
  });

  it("chain 終端に QR がなければ frontier 内に有効 QR が無い（= 古い QR 再表示でも再実行されない）", () => {
    const { scoped } = selectQrScope(phaseMessages, new Set(["T1", "T2", "T3", "T4"]));
    const hasAnyQr = scoped.some((m) => m.quickReplies);
    expect(hasAnyQr).toBe(false);
  });

  it("chain 終端に QR があれば、その終端メッセージの QR だけが有効", () => {
    const t4WithQr = msg("T4", true);
    const messages = [S, msg("T1"), msg("T2"), msg("T3"), t4WithQr];
    const { scoped } = selectQrScope(messages, new Set(["T1", "T2", "T3", "T4"]));
    const qrMsgs = scoped.filter((m) => m.quickReplies);
    expect(qrMsgs.map((m) => m.id)).toEqual(["T4"]);
  });
});
