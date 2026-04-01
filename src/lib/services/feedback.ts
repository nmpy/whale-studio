// src/lib/services/feedback.ts
// フィードバック送信 service 層。
// 将来 DB 保存に切り替える場合はこのファイルの submitFeedback だけ差し替えればよい。

// ── スプレッドシートの列順（GAS の appendRow に対応） ──────────────────────
// id | created_at | user_name | user_email | page_name | page_url |
// oa_id | oa_name | work_id | work_name | category | content |
// status | memo | user_agent

export interface FeedbackPayload {
  id:          string;        // API 側で生成する UUID
  created_at:  string;        // ISO 8601
  user_name:   string;
  user_email:  string;
  page_name:   string;
  page_url:    string;
  oa_id:       string | null;
  oa_name:     string | null;
  work_id:     string | null;
  work_name:   string | null;
  category:    string;        // "bug" | "ux" | "feature" | "other"
  content:     string;
  status:      string;        // 初期値 "未対応"
  memo:        string;        // 初期値 ""
  user_agent:  string;
}

export interface FeedbackResult {
  ok:     boolean;
  error?: string;
}

/**
 * フィードバックを GAS Web App 経由でスプレッドシートに送信する。
 *
 * GAS スクリプト例:
 * ```javascript
 * function doPost(e) {
 *   const d = JSON.parse(e.postData.contents);
 *   SpreadsheetApp.getActiveSpreadsheet()
 *     .getSheetByName("feedback")
 *     .appendRow([
 *       d.id, d.created_at, d.user_name, d.user_email,
 *       d.page_name, d.page_url,
 *       d.oa_id, d.oa_name, d.work_id, d.work_name,
 *       d.category, d.content,
 *       d.status, d.memo, d.user_agent,
 *     ]);
 *   return ContentService
 *     .createTextOutput(JSON.stringify({ ok: true }))
 *     .setMimeType(ContentService.MimeType.JSON);
 * }
 * ```
 *
 * 環境変数 GAS_FEEDBACK_WEBHOOK_URL が未設定の場合はコンソール出力のみ（開発用）。
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
  const gasUrl = process.env.GAS_FEEDBACK_WEBHOOK_URL;

  if (!gasUrl) {
    console.log("[feedback] GAS_FEEDBACK_WEBHOOK_URL 未設定 → コンソール出力のみ");
    console.log("[feedback]", JSON.stringify(payload, null, 2));
    return { ok: true };
  }

  try {
    const res = await fetch(gasUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[feedback] GAS 送信失敗:", res.status, text);
      return { ok: false, error: `GAS returned ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("[feedback] GAS 送信エラー:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
