/**
 * src/__tests__/message-flow-status.test.ts
 * メッセージ一覧の導線状態集計（analyzeMessageList）の検証。
 */
import { describe, it, expect } from "vitest";
import { analyzeMessageList, type FlowMessage } from "@/lib/message-flow-status";

const phaseIds = new Set(["p1", "p2"]);

function run(messages: FlowMessage[], phases = phaseIds) {
  return analyzeMessageList(messages, phases);
}

describe("analyzeMessageList", () => {
  it("開始メッセージは isStart=true、キーワードありで missingKeyword=false", () => {
    const map = run([{ id: "m1", kind: "start", trigger_keyword: "はじめる" }]);
    const info = map.get("m1")!;
    expect(info.isStart).toBe(true);
    expect(info.missingKeyword).toBe(false);
  });

  it("start/response でキーワード空なら missingKeyword=true", () => {
    const map = run([
      { id: "m1", kind: "start", trigger_keyword: "" },
      { id: "m2", kind: "response", trigger_keyword: null },
      { id: "m3", kind: "normal", trigger_keyword: null }, // normal は必須でない
    ]);
    expect(map.get("m1")!.missingKeyword).toBe(true);
    expect(map.get("m2")!.missingKeyword).toBe(true);
    expect(map.get("m3")!.missingKeyword).toBe(false);
  });

  it("QR分岐（target_message_id）は hasQrBranch=true・nextLinks に解決される", () => {
    const map = run([
      { id: "m1", kind: "normal", quick_replies: [{ action: "text", target_message_id: "m2" }] },
      { id: "m2", kind: "response", trigger_keyword: "x" },
    ]);
    const info = map.get("m1")!;
    expect(info.hasQrBranch).toBe(true);
    expect(info.hasQuickReply).toBe(true);
    expect(info.hasBrokenLink).toBe(false);
    expect(info.nextLinks).toEqual([{ type: "qr_message", targetType: "message", targetId: "m2", exists: true }]);
  });

  it("分岐しない QR（url/hint のみ）は hasQuickReply=true / hasQrBranch=false", () => {
    const map = run([{ id: "m1", kind: "normal", quick_replies: [{ action: "url", value: "https://x" }, { action: "hint" }] }]);
    const info = map.get("m1")!;
    expect(info.hasQuickReply).toBe(true);
    expect(info.hasQrBranch).toBe(false);
    expect(info.nextLinks).toEqual([]);
  });

  it("QR分岐先が存在しない ID → hasBrokenLink=true（遷移先未設定）", () => {
    const map = run([{ id: "m1", kind: "normal", quick_replies: [{ action: "text", target_message_id: "missing" }] }]);
    const info = map.get("m1")!;
    expect(info.hasBrokenLink).toBe(true);
    expect(info.nextLinks[0]).toMatchObject({ targetId: "missing", exists: false });
  });

  it("自由入力 ON + 次メッセージ実在 → hasFreeInput=true / free_input リンク", () => {
    const map = run([
      { id: "m1", kind: "normal", free_input_enabled: true, free_input_next_message_id: "m2" },
      { id: "m2", kind: "normal" },
    ]);
    const info = map.get("m1")!;
    expect(info.hasFreeInput).toBe(true);
    expect(info.nextLinks).toContainEqual({ type: "free_input", targetType: "message", targetId: "m2", exists: true });
  });

  it("画像タップ（image_action_type != none）→ hasImageTap=true、none は false", () => {
    const map = run([
      { id: "m1", kind: "normal", image_action_type: "uri" },
      { id: "m2", kind: "normal", image_action_type: "none" },
    ]);
    expect(map.get("m1")!.hasImageTap).toBe(true);
    expect(map.get("m2")!.hasImageTap).toBe(false);
  });

  it("謎の正解後フェーズ遷移を puzzle_phase リンクで解決（不在なら broken）", () => {
    const map = run([
      { id: "m1", kind: "puzzle", correct_action: "transition", correct_next_phase_id: "p2" },
      { id: "m2", kind: "puzzle", correct_action: "transition", correct_next_phase_id: "nope" },
    ]);
    expect(map.get("m1")!.nextLinks).toContainEqual({ type: "puzzle_phase", targetType: "phase", targetId: "p2", exists: true });
    expect(map.get("m1")!.hasBrokenLink).toBe(false);
    expect(map.get("m2")!.hasBrokenLink).toBe(true);
  });

  it("chain head は continuation を畳んで集計（QR が末尾にあっても head 行に出る）", () => {
    const map = run([
      { id: "h", kind: "normal", next_message_id: "c1" },
      { id: "c1", kind: "normal", next_message_id: "c2" },
      { id: "c2", kind: "normal", quick_replies: [{ action: "text", target_message_id: "t" }] },
      { id: "t", kind: "response", trigger_keyword: "x" },
    ]);
    // continuation (c1/c2) は head として出さない
    expect(map.has("c1")).toBe(false);
    expect(map.has("c2")).toBe(false);
    const head = map.get("h")!;
    expect(head.hasQrBranch).toBe(true);
    // chain 内部リンク（h→c1→c2）は外向き遷移に出さない。塊外の t のみ。
    expect(head.nextLinks).toEqual([{ type: "qr_message", targetType: "message", targetId: "t", exists: true }]);
  });

  it("未接続: 参照されずキーワードも無い response は true / 有効フェーズの normal は false", () => {
    const map = run([
      { id: "orphan", kind: "response", trigger_keyword: "" },
      { id: "auto",   kind: "normal", phase_id: "p1" }, // 有効フェーズ→入場で自動送信されるので未接続にしない
    ]);
    expect(map.get("orphan")!.unreferenced).toBe(true);
    expect(map.get("auto")!.unreferenced).toBe(false);
  });

  it("未接続: フェーズに属さず参照もキーワードも無い normal は true（孤立）／start/system_notice は除外", () => {
    const map = run([
      { id: "lost",   kind: "normal",         phase_id: null },        // 孤立
      { id: "badph",  kind: "puzzle",         phase_id: "deleted" },   // 不在フェーズ＝孤立
      { id: "st",     kind: "start",          phase_id: null, trigger_keyword: "" }, // start は除外
      { id: "sys",    kind: "system_notice",  phase_id: null },        // システム送信＝除外
    ]);
    expect(map.get("lost")!.unreferenced).toBe(true);
    expect(map.get("badph")!.unreferenced).toBe(true);
    expect(map.get("st")!.unreferenced).toBe(false);
    expect(map.get("sys")!.unreferenced).toBe(false);
  });

  it("参照されている response は unreferenced=false", () => {
    const map = run([
      { id: "m1", kind: "normal", phase_id: "p1", quick_replies: [{ action: "text", response_message_id: "r1" }] },
      { id: "r1", kind: "response", trigger_keyword: "" },
    ]);
    expect(map.get("r1")!.unreferenced).toBe(false);
  });

  it("画像タップ: アクション設定ありで宛先値が空なら hasBrokenLink=true（type 別に検証）", () => {
    const map = run([
      { id: "u_ok",  kind: "normal", phase_id: "p1", image_action_type: "uri", image_action_url: "https://x" },
      { id: "u_ng",  kind: "normal", phase_id: "p1", image_action_type: "uri", image_action_url: "" },
      { id: "m_ng",  kind: "normal", phase_id: "p1", image_action_type: "message", image_action_text: "  " },
      { id: "l_ng",  kind: "normal", phase_id: "p1", image_action_type: "liff", image_action_liff_page_id: null },
    ]);
    expect(map.get("u_ok")!.hasImageTap).toBe(true);
    expect(map.get("u_ok")!.hasBrokenLink).toBe(false);
    expect(map.get("u_ng")!.hasBrokenLink).toBe(true);
    expect(map.get("m_ng")!.hasBrokenLink).toBe(true);
    expect(map.get("l_ng")!.hasBrokenLink).toBe(true);
  });

  it("分岐しない QR でも url/custom の宛先値が空なら hasBrokenLink=true", () => {
    const map = run([
      { id: "m1", kind: "normal", phase_id: "p1", quick_replies: [{ action: "url", value: "" }] },
      { id: "m2", kind: "normal", phase_id: "p1", quick_replies: [{ action: "custom", value: "do" }] },
    ]);
    expect(map.get("m1")!.hasBrokenLink).toBe(true);
    expect(map.get("m1")!.hasQrBranch).toBe(false);
    expect(map.get("m2")!.hasBrokenLink).toBe(false);
  });

  it("chain 子メッセージの キーワード未設定 / 遷移先未設定 が head に集約される", () => {
    const map = run([
      { id: "h",  kind: "normal", phase_id: "p1", next_message_id: "c1" },
      // 子: 応答キーワード必須(response)なのに空 + 画像タップ宛先空
      { id: "c1", kind: "response", phase_id: "p1", trigger_keyword: "",
        image_action_type: "uri", image_action_url: "" },
    ]);
    const head = map.get("h")!;
    expect(head.missingKeyword).toBe(true);
    expect(head.hasBrokenLink).toBe(true);
  });
});
