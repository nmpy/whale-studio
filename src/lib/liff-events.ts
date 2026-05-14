// src/lib/liff-events.ts
//
// LIFF プレイヤー画面からのイベント計測ユーティリティ + イベント定数。
// サーバー側 (API ルート) からも参照できる単純な共有モジュール。

/** 計測対象のイベント種別。 */
export const LIFF_EVENT_TYPES = [
  "page_view",
  "block_view",
  "button_click",
  "hint_open",
  "faq_open",
  "survey_submit",
  "checkin_success",
  "checkin_failed",
] as const;

export type LiffEventType = (typeof LIFF_EVENT_TYPES)[number];

export function isValidLiffEventType(value: unknown): value is LiffEventType {
  return typeof value === "string" && (LIFF_EVENT_TYPES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────
// クライアント側 API
// ─────────────────────────────────────────────────────────────
//
// 使い方:
//   import { recordLiffEvent } from "@/lib/liff-events";
//   recordLiffEvent({
//     workId,           // UUID or publicId
//     pageId,           // optional, UUID or publicId
//     blockId,          // optional, UUID
//     lineUserId,       // optional
//     eventType: "button_click",
//     metadata: { label: "詳細を見る", url: "https://..." },
//   });
//
// sendBeacon を優先 (画面遷移直前でも届く)。失敗時は fetch keepalive で再試行。
// 結果は呼出側に返さず fire-and-forget。

interface RecordEventInput {
  workId:     string;
  pageId?:    string;
  blockId?:   string;
  lineUserId?: string | null;
  eventType:  LiffEventType;
  metadata?:  Record<string, unknown>;
}

/** sessionStorage で短期間の重複防止 (同一 dedupeKey は 30 秒以内に 1 回まで) */
const DEDUPE_WINDOW_MS = 30_000;

function shouldDedupe(dedupeKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const fullKey = `liff_event_dedupe:${dedupeKey}`;
    const last = window.sessionStorage.getItem(fullKey);
    const now = Date.now();
    if (last) {
      const lastTs = parseInt(last, 10);
      if (Number.isFinite(lastTs) && now - lastTs < DEDUPE_WINDOW_MS) {
        return true;
      }
    }
    window.sessionStorage.setItem(fullKey, String(now));
    return false;
  } catch {
    // sessionStorage が無効な環境 (Safari private 等) はチェック無しで通す
    return false;
  }
}

export function recordLiffEvent(input: RecordEventInput & { dedupeKey?: string }): void {
  if (typeof window === "undefined") return;
  if (input.dedupeKey && shouldDedupe(input.dedupeKey)) return;

  const payload = {
    work_id:        input.workId,
    page_id:        input.pageId,
    block_id:       input.blockId,
    line_user_id:   input.lineUserId ?? null,
    event_type:     input.eventType,
    metadata_json:  input.metadata ?? null,
  };

  const body = JSON.stringify(payload);
  const url = "/api/liff/events";

  // 優先: navigator.sendBeacon (画面遷移直前でも届く)
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
  } catch {
    // sendBeacon 失敗時は fetch にフォールバック
  }

  // フォールバック: fetch + keepalive (Page Visibility 遷移時にも届く)
  try {
    fetch(url, {
      method:    "POST",
      headers:   { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // failure は黙殺 (計測のためにユーザー体験を阻害しない)
    });
  } catch {
    // 黙殺
  }
}
