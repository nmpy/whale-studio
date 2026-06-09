/**
 * src/__tests__/list-shapes.test.ts
 *
 * src/lib/api/list-shapes.ts の整形関数を検証する。
 *
 * 背景（回帰防止）:
 *   messages bootstrap API (PR #205) と 旧 /api/messages・/api/phases・/api/transitions は
 *   **同じ整形関数**（messageToResponse / phaseToResponse / transitionToResponse）を共有する。
 *   よって bootstrap と旧 API の shape は構造的に一致する。本テストは、その共有 shaper が
 *   一覧 UI で使うフィールドを欠落させないことを固定し、将来の編集で field が静かに消えるのを防ぐ。
 */

import { describe, it, expect } from "vitest";
import {
  messageToResponse,
  phaseToResponse,
  transitionToResponse,
} from "@/lib/api/list-shapes";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("messageToResponse — 一覧 UI が使う全フィールドを保持する", () => {
  const row = {
    id: "m1", workId: "w1", phaseId: "p1", characterId: "c1",
    messageType: "image", kind: "normal", body: "本文", assetUrl: "https://x/y.png",
    triggerKeyword: "kw", targetSegment: null, notifyText: null, riddleId: null,
    quickReplies: JSON.stringify([{ label: "はい", action: "text", value: "はい" }]),
    nextMessageId: "m2",
    altText: "alt", flexPayloadJson: "{\"k\":1}",
    puzzleType: null, answer: null, puzzleHintText: null, answerMatchType: JSON.stringify(["exact"]),
    correctAction: null, correctText: null, incorrectText: null, incorrectQuickReplies: null,
    correctNextPhaseId: null, hintMode: "always", lagMs: 3,
    readReceiptMode: null, readDelayMs: null, typingEnabled: null, typingMinMs: null, typingMaxMs: null,
    loadingEnabled: null, loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null,
    tapDestinationId: null, tapUrl: null,
    imageActionType: "url", imageActionText: "開く", imageActionUrl: "https://z", imageActionLiffPageId: null, imageActionPostbackData: null,
    freeInputEnabled: true, freeInputVariableKey: "name", freeInputNextMessageId: "m3",
    sortOrder: 5, isActive: false, createdAt: NOW, updatedAt: NOW,
    phase: { id: "p1", name: "開始", phaseType: "start" },
    character: { id: "c1", name: "ナビ", iconType: "image", iconText: null, iconImageUrl: "https://i", iconColor: null },
  };
  const out = messageToResponse(row);

  it("一覧描画・チェーン・並び替えに使う主要 field がある", () => {
    for (const k of [
      "id", "work_id", "phase_id", "character_id", "message_type", "kind", "body",
      "asset_url", "sort_order", "is_active", "created_at", "updated_at",
      "next_message_id", "free_input_enabled", "free_input_next_message_id",
      "image_action_type", "quick_replies", "trigger_keyword",
    ]) {
      expect(out).toHaveProperty(k);
    }
  });

  it("値マッピング: snake_case 変換 / quick_replies は配列に parse / is_active 保持", () => {
    expect(out.message_type).toBe("image");
    expect(out.sort_order).toBe(5);
    expect(out.is_active).toBe(false); // inactive も保持（一覧でトグル表示）
    expect(Array.isArray(out.quick_replies)).toBe(true);
    expect(out.quick_replies?.[0]?.label).toBe("はい");
    expect(out.next_message_id).toBe("m2");
    expect(out.free_input_enabled).toBe(true);
  });

  it("phase / character の nested shape（icon 等）が保持される", () => {
    expect(out.phase).toEqual({ id: "p1", name: "開始", phase_type: "start" });
    expect(out.character).toMatchObject({
      id: "c1", name: "ナビ", icon_type: "image", icon_image_url: "https://i",
    });
  });

  it("phase/character 未指定（include されない）なら key 自体が出ない（旧 API と同挙動）", () => {
    const { phase, character, ...bare } = row;
    void phase; void character;
    const o = messageToResponse(bare);
    expect(o).not.toHaveProperty("phase");
    expect(o).not.toHaveProperty("character");
  });
});

describe("phaseToResponse", () => {
  const out = phaseToResponse({
    id: "p1", workId: "w1", phaseType: "start", name: "開始", description: null,
    startTrigger: "スタート", resumeSummary: null, sortOrder: 0, isActive: true,
    createdAt: NOW, updatedAt: NOW, _count: { messages: 3, transitionsFrom: 2 },
  });
  it("phase_type / start_trigger / _count を保持", () => {
    expect(out.phase_type).toBe("start");
    expect(out.start_trigger).toBe("スタート");
    expect(out.sort_order).toBe(0);
    expect(out._count).toEqual({ messages: 3, transitionsFrom: 2 });
  });
});

describe("transitionToResponse", () => {
  const base = {
    id: "t1", workId: "w1", fromPhaseId: "p1", toPhaseId: "p2", label: "次へ",
    condition: null, flagCondition: null, setFlags: "{}", sortOrder: 1, isActive: true,
    createdAt: NOW, updatedAt: NOW,
  };
  it("from/to phase id + to_phase nested を保持", () => {
    const out = transitionToResponse(base, { id: "p2", name: "次", phaseType: "normal" });
    expect(out.from_phase_id).toBe("p1");
    expect(out.to_phase_id).toBe("p2");
    expect(out.to_phase).toEqual({ id: "p2", name: "次", phase_type: "normal" });
  });
  it("toPhase 未指定なら to_phase key は出ない", () => {
    const out = transitionToResponse(base);
    expect(out).not.toHaveProperty("to_phase");
  });
});
