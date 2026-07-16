// src/__tests__/oa-dashboard.test.ts
// アカウントダッシュボードの純粋ロジック（分岐判定 / アクティビティ整形）のテスト。
// KPI 集計・アカウントスコープ絞り込みは server route（requireRole + where 絞り込み）と typecheck が担保する。
import { describe, it, expect } from "vitest";
import { isSingleAccountView } from "@/lib/oa-dashboard";
import {
  ACTIVITY_META, ACTIVITY_TONE_CLASS, type ActivityKind, type ActivityItem,
  playerTag, liffEventToActivity, beaconEventToActivity, mergeAndTake,
} from "@/lib/activity-feed";

describe("isSingleAccountView — 0 / 1 / 複数件 分岐", () => {
  it("1 件（total=1）→ ダッシュボード表示", () => {
    expect(isSingleAccountView(1, 1)).toBe(true);
  });
  it("0 件 → 非表示（空状態）", () => {
    expect(isSingleAccountView(0, 0)).toBe(false);
  });
  it("2 件以上 → 非表示（一覧）", () => {
    expect(isSingleAccountView(2, 2)).toBe(false);
    expect(isSingleAccountView(5, 5)).toBe(false);
  });
  it("total 未指定なら itemsLen を使う", () => {
    expect(isSingleAccountView(1, null)).toBe(true);
    expect(isSingleAccountView(1, undefined)).toBe(true);
  });
  it("ページ内 1 件でも全体が複数（total>1）ならダッシュボードにしない", () => {
    expect(isSingleAccountView(1, 3)).toBe(false);
  });
});

describe("ACTIVITY_META / TONE — 14 種すべて定義され、色クラスが存在する", () => {
  const KINDS: ActivityKind[] = [
    "join", "start", "send", "receive", "view", "location", "clear",
    "hint", "answer", "select", "call", "error", "redelivery", "session_end",
  ];
  it("14 種すべてに label と tone がある", () => {
    for (const k of KINDS) {
      expect(ACTIVITY_META[k]).toBeDefined();
      expect(ACTIVITY_META[k].label.length).toBeGreaterThan(0);
      expect(ACTIVITY_TONE_CLASS[ACTIVITY_META[k].tone]).toBeTruthy();
    }
  });
  it("クリアは緑・エラーは赤・送信は青のトーン", () => {
    expect(ACTIVITY_META.clear.tone).toBe("green");
    expect(ACTIVITY_META.error.tone).toBe("red");
    expect(ACTIVITY_META.send.tone).toBe("blue");
  });
});

describe("playerTag — 匿名・決定論的・OA 間非相関（36^6 空間）", () => {
  it("書式は #[A-Z0-9]{6}（プレイヤー #A1B2C3 形式）", () => {
    expect(playerTag("U1234567890abcdef", "oa1")).toMatch(/^プレイヤー #[A-Z0-9]{6}$/);
  });
  it("同一 OA・同一 userId は常に同じタグ（決定論）", () => {
    expect(playerTag("U1234567890abcdef", "oa1")).toBe(playerTag("U1234567890abcdef", "oa1"));
  });
  it("OA（salt）が違えば同一 userId でも別タグ（名寄せを作らない）", () => {
    const uid = "Uabcdef0123456789";
    expect(playerTag(uid, "oaA")).not.toBe(playerTag(uid, "oaB"));
  });
  it("userId が違えば通常は別タグ（同一 salt）", () => {
    expect(playerTag("Uaaaa", "oa1")).not.toBe(playerTag("Ubbbb", "oa1"));
  });
  it("タグに生の userId を含めない", () => {
    const uid = "U1234567890abcdef";
    expect(playerTag(uid, "oa1")).not.toContain(uid);
  });
  it("null / 空は 匿名プレイヤー（既存仕様）", () => {
    expect(playerTag(null, "oa1")).toBe("プレイヤー");
    expect(playerTag(undefined, "oa1")).toBe("プレイヤー");
    expect(playerTag("", "oa1")).toBe("プレイヤー");
  });
  // ※ 「大量IDで衝突ゼロ」は hash 変更で壊れるため恒久仕様にしない。識別空間と決定性のみを検証する。
  it("識別空間は 36^6（英数字6文字）", () => {
    const code = playerTag("Uany", "oa1").replace("プレイヤー #", "");
    expect(code).toHaveLength(6);
    expect(Number.parseInt(code, 36)).toBeLessThan(36 ** 6);
  });
});

describe("liffEventToActivity — 実イベントのマッピング + 二重表示回避", () => {
  it("page_view → 閲覧(view)", () => {
    expect(liffEventToActivity("page_view")).toEqual({ kind: "view", detail: "LIFFページを閲覧" });
  });
  it("チェックイン成功（qr/gps/checkin *_success）は LocationVisit と重複するため除外（null）", () => {
    expect(liffEventToActivity("qr_scan_success")).toBeNull();
    expect(liffEventToActivity("gps_checkin_success")).toBeNull();
    expect(liffEventToActivity("checkin_success")).toBeNull();
  });
  it("survey_submit は LiffSubmission と重複するため除外（null）", () => {
    expect(liffEventToActivity("survey_submit")).toBeNull();
  });
  it("チェックイン失敗（*_failed）は対応する成功ログが無いため表示（error）", () => {
    expect(liffEventToActivity("qr_scan_failed")?.kind).toBe("error");
    expect(liffEventToActivity("gps_checkin_failed")?.kind).toBe("error");
  });
  it("技術的イベント（init/session/message_send）はフィードに載せない（null）", () => {
    expect(liffEventToActivity("liff_init_success")).toBeNull();
    expect(liffEventToActivity("session_failed")).toBeNull();
    expect(liffEventToActivity("qr_message_send_started")).toBeNull();
  });
});

describe("beaconEventToActivity", () => {
  it("再送 → redelivery", () => {
    expect(beaconEventToActivity({ isRedelivery: true, actionStatus: "sent" }).kind).toBe("redelivery");
  });
  it("失敗 → error", () => {
    expect(beaconEventToActivity({ isRedelivery: false, actionStatus: "failed" }).kind).toBe("error");
  });
  it("通常受信 → location", () => {
    expect(beaconEventToActivity({ isRedelivery: false, actionStatus: "sent" }).kind).toBe("location");
  });
});

describe("mergeAndTake — 新しい順・件数上限・安定 tie-break", () => {
  const mk = (id: string, at: string, kind: ActivityKind = "view"): ActivityItem => ({ id, at, kind, playerTag: "x", detail: "d" });
  it("新しい順に並べ、上限で切る", () => {
    const items = [
      mk("a", "2026-07-01T00:00:00Z"),
      mk("b", "2026-07-03T00:00:00Z"),
      mk("c", "2026-07-02T00:00:00Z"),
    ];
    const out = mergeAndTake(items, 2);
    expect(out.map((i) => i.id)).toEqual(["b", "c"]);
  });
  it("同時刻は id で安定化", () => {
    const items = [mk("z", "2026-07-01T00:00:00Z"), mk("a", "2026-07-01T00:00:00Z")];
    expect(mergeAndTake(items, 10).map((i) => i.id)).toEqual(["a", "z"]);
  });
  it("空配列は空を返す（＝アクティビティ空状態）", () => {
    expect(mergeAndTake([], 10)).toEqual([]);
  });
});
