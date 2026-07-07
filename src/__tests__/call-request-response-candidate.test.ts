/**
 * src/__tests__/call-request-response-candidate.test.ts
 *
 * QR Step2「返す内容（応答メッセージ）」候補に通話リクエストが出るか（問題B）。
 *   - messageOptionLabel: call_request を「通話リクエスト」と識別表示（body 空でも "(本文なし)" にしない）。
 *   - filterResponseMessageCandidates: kind="response" のみ候補（call_request も kind=response なら含む）。
 *     kind="normal" の call_request は候補外（＝「応答メッセージのみ選択可」仕様の維持）。
 */
import { describe, it, expect } from "vitest";
import {
  messageOptionLabel,
  filterResponseMessageCandidates,
  type OptionCandidateMessage,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

describe("messageOptionLabel", () => {
  it("call_request（body 空）→「通話リクエスト」", () => {
    expect(messageOptionLabel({ message_type: "call_request", body: null })).toBe("通話リクエスト");
    expect(messageOptionLabel({ message_type: "call_request", body: "" })).toBe("通話リクエスト");
  });
  it("call_request（body あり）→「通話リクエスト: 本文」", () => {
    expect(messageOptionLabel({ message_type: "call_request", body: "至急" })).toBe("通話リクエスト: 至急");
  });
  it("既存種別は従来どおり body を表示（text/image/flex は変更しない）", () => {
    expect(messageOptionLabel({ message_type: "text", body: "こんにちは" })).toBe("こんにちは");
    expect(messageOptionLabel({ message_type: "image", body: null })).toBe("(本文なし)");
    expect(messageOptionLabel({ message_type: "flex", body: null })).toBe("(本文なし)");
  });
});

describe("filterResponseMessageCandidates（QR Step2 返す内容の候補抽出）", () => {
  const msgs: OptionCandidateMessage[] = [
    { id: "text-resp",  kind: "response", message_type: "text",         body: "応答テキスト", phase_id: "p1" },
    { id: "cr-resp",    kind: "response", message_type: "call_request", body: null,           phase_id: "p1" }, // 通話リクエスト（応答）
    { id: "cr-normal",  kind: "normal",   message_type: "call_request", body: null,           phase_id: "p1" }, // 通話リクエスト（通常）
    { id: "text-normal", kind: "normal",  message_type: "text",         body: "通常テキスト",  phase_id: "p1" },
    { id: "self",       kind: "response", message_type: "text",         body: "編集中",        phase_id: "p1" },
  ];

  it("5) kind=response の call_request は候補に含まれる", () => {
    const ids = filterResponseMessageCandidates(msgs, undefined).map((m) => m.id);
    expect(ids).toContain("cr-resp");
    expect(ids).toContain("text-resp");
  });

  it("候補ラベルで call_request を「通話リクエスト」と識別できる", () => {
    const crResp = filterResponseMessageCandidates(msgs, undefined).find((m) => m.id === "cr-resp")!;
    expect(messageOptionLabel(crResp)).toBe("通話リクエスト");
  });

  it("7) kind=normal の call_request は候補に出ない（応答メッセージのみ選択可の仕様）", () => {
    const ids = filterResponseMessageCandidates(msgs, undefined).map((m) => m.id);
    expect(ids).not.toContain("cr-normal");
    expect(ids).not.toContain("text-normal");
  });

  it("編集中メッセージ自身は候補から除外", () => {
    const ids = filterResponseMessageCandidates(msgs, "self").map((m) => m.id);
    expect(ids).not.toContain("self");
  });
});
