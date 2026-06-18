// src/lib/services/feedback.ts
// フィードバック送信 service 層 (= 旧 Google Apps Script 連携の後方互換 fallback)。
//
// 現在の本線は Slack 通知 (= FEEDBACK_SLACK_WEBHOOK_URL / src/lib/slack/feedback.ts)。
// このファイルは FEEDBACK_SLACK_WEBHOOK_URL が未設定の環境向けの fallback としてのみ呼ばれる。
// ルーティング判定は /api/feedback の route handler が行う (= ここでは判定しない)。

// ── スプレッドシートの列順（GAS の appendRow に対応） ──────────────────────
// id | created_at | user_name | user_email | page_name | page_url |
// oa_id | oa_name | work_id | work_name | category | content |
// status | memo | user_agent
//
// ※ title は payload に追加済みだが、現行のスプレッドシート列／GAS appendRow はまだ未対応。
//   GAS が title 列を無視しても送信は落ちない（余剰フィールドは JSON に乗るだけ）。
//   スプレッドシートに title を残したい場合は GAS 側で title 列の追加と appendRow への
//   d.title 追加が別途必要（下記 doPost サンプルは d.title を含めた更新例）。
//   なお通常フィードバックの category 列は今後 ""（空文字）になる。

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
  category:    string;        // 通常フィードバックは "" / 法人相談のみ "enterprise"（旧 bug/ux/... は廃止）
  /** 通常フィードバックのタイトル（旧カテゴリの置き換え）。GAS 側に列が無くても送信は落ちない。 */
  title:       string;
  content:     string;
  status:      string;        // 初期値 "未対応"
  memo:        string;        // 初期値 ""
  user_agent:  string;
}

export interface FeedbackResult {
  ok:       boolean;
  error?:   string;
  /** 開発モードのコンソール出力のみ（URLが未設定の dev 環境）*/
  dev_skip?: boolean;
}

/**
 * フィードバックを GAS Web App 経由でスプレッドシートに送信する (= 旧経路 / 後方互換)。
 *
 * ルーティング:
 *   /api/feedback は FEEDBACK_SLACK_WEBHOOK_URL を primary とし、未設定時のみ本関数を呼ぶ。
 *   そのため通常の本番運用では本関数は呼ばれない想定。
 *
 * 環境変数:
 *   GAS_FEEDBACK_WEBHOOK_URL  — Google Apps Script Web App の実行 URL（fallback 用 / 任意）
 *   FEEDBACK_DEV_SKIP=true    — 開発中に URL なしでモーダルをテストしたい場合のみ設定
 *
 * title をスプレッドシートに保存したい場合は、GAS 側で title 列を追加し、
 * appendRow に d.title を含めてください（下記サンプルは d.title 列を含む例）。
 * 通常フィードバックの category は空文字（""）、法人相談は "enterprise" になります。
 *
 * GAS スクリプト例（doPost）:
 * ```javascript
 * function doPost(e) {
 *   try {
 *     const d = JSON.parse(e.postData.contents);
 *     SpreadsheetApp.getActiveSpreadsheet()
 *       .getSheetByName("feedback")
 *       .appendRow([
 *         d.id, d.created_at, d.user_name, d.user_email,
 *         d.page_name, d.page_url,
 *         d.oa_id ?? "", d.oa_name ?? "", d.work_id ?? "", d.work_name ?? "",
 *         // category は通常フィードバックでは ""（廃止）/ 法人相談のみ "enterprise"。
 *         // title は旧カテゴリの置き換え（通常フィードバックの入力タイトル）。
 *         d.category, d.title ?? "", d.content,
 *         d.status, d.memo, d.user_agent,
 *       ]);
 *     return ContentService
 *       .createTextOutput(JSON.stringify({ ok: true }))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   } catch (err) {
 *     return ContentService
 *       .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   }
 * }
 * ```
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
  const gasUrl  = process.env.GAS_FEEDBACK_WEBHOOK_URL?.trim();
  const devSkip = process.env.FEEDBACK_DEV_SKIP === "true";

  // ── 起動時診断ログ（毎リクエストで env の読み取り状態を確認できる） ──────────
  console.info(
    `[feedback] 設定確認: GAS_URL=${gasUrl ? "設定済み" : "未設定(空)"} ` +
    `FEEDBACK_DEV_SKIP=${devSkip} NODE_ENV=${process.env.NODE_ENV}`
  );

  // ── URL 未設定の処理 ───────────────────────────────────────────────────────
  if (!gasUrl) {
    // FEEDBACK_DEV_SKIP=true のときのみ開発用コンソール出力に逃がす
    // ※ NODE_ENV に関わらず有効（本番Vercelでも FEEDBACK_DEV_SKIP=true を設定すれば動く）
    if (devSkip) {
      console.warn(
        "[feedback] ⚠️  FEEDBACK_DEV_SKIP=true — スプレッドシートには送信しません（バイパス）\n" +
        "[feedback] 本番反映するには GAS_FEEDBACK_WEBHOOK_URL を設定してください"
      );
      console.log("[feedback] payload:\n" + JSON.stringify(payload, null, 2));
      return { ok: true, dev_skip: true };
    }

    // GAS URL も FEEDBACK_DEV_SKIP も未設定 → fallback 失敗。
    // 通常はルートハンドラ側で FEEDBACK_SLACK_WEBHOOK_URL 未設定の時のみ本関数が呼ばれ、
    // さらに hasGas=true がガードされているため、このパスは到達しないはず (= defensive)。
    console.error(
      "[feedback] ❌ GAS fallback: 環境変数未設定" +
      " / FEEDBACK_DEV_SKIP=" + String(devSkip) +
      " / NODE_ENV=" + process.env.NODE_ENV
    );
    return { ok: false, error: "fallback destination unset" };
  }

  // ── GAS への送信 ───────────────────────────────────────────────────────────
  console.info(
    `[feedback] → 送信開始 id=${payload.id} category=${payload.category} page=${payload.page_name}`
  );

  try {
    const res = await fetch(gasUrl, {
      method:   "POST",
      headers:  { "Content-Type": "application/json" },
      body:     JSON.stringify(payload),
      redirect: "follow",   // GAS は 302 リダイレクトを返すことがあるため必須
    });

    const rawText = await res.text().catch(() => "");

    // HTTP レベルのエラー
    if (!res.ok) {
      console.error(
        `[feedback] ❌ GAS HTTP エラー: status=${res.status} body=${rawText.slice(0, 300)}`
      );
      return { ok: false, error: `GAS returned HTTP ${res.status}` };
    }

    // GAS ボディを JSON パース（失敗してもHTTPが200なら成功扱いにする）
    let gasBody: { ok?: boolean; error?: string } = {};
    try {
      gasBody = JSON.parse(rawText) as { ok?: boolean; error?: string };
    } catch {
      // GAS が空レスポンスや非JSON を返した場合（HTTP 200 なら書き込み成功とみなす）
      console.warn(
        `[feedback] ⚠️  GAS レスポンスが JSON でないが HTTP ${res.status} のため成功とみなします: ${rawText.slice(0, 100)}`
      );
      console.info(`[feedback] ✅ 送信完了（non-JSON） id=${payload.id}`);
      return { ok: true };
    }

    // GAS 側で明示的に { ok: false } を返した場合
    if (gasBody.ok === false) {
      console.error(
        `[feedback] ❌ GAS 処理エラー: ${gasBody.error ?? "(詳細なし)"}`
      );
      return { ok: false, error: gasBody.error ?? "スプレッドシートへの書き込みに失敗しました" };
    }

    console.info(`[feedback] ✅ 送信完了 id=${payload.id}`);
    return { ok: true };

  } catch (err) {
    // ネットワークエラー / タイムアウト など
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[feedback] ❌ GAS fetch 例外: ${msg}`, err);
    return { ok: false, error: `ネットワークエラー: ${msg}` };
  }
}
