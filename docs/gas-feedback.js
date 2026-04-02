/**
 * Google Apps Script — フィードバック受信スクリプト
 *
 * 対象スプレッドシート:
 *   https://docs.google.com/spreadsheets/d/1jTsOdkgqckmpOFP4KbkzOswzaBGdUbb-OHSOy9bBHss/
 *
 * 【デプロイ手順】
 * 1. 上記スプレッドシートを開く
 * 2. シート名を "feedback" にリネーム（デフォルト「シート1」から変更）
 * 3. 拡張機能 → Apps Script を開く
 * 4. このファイルの内容を全て貼り付けて保存（Ctrl+S）
 * 5. デプロイ → 新しいデプロイ
 *    - 種類: ウェブアプリ
 *    - 実行ユーザー: 自分（スプレッドシートオーナー）
 *    - アクセスできるユーザー: 全員
 * 6. 「デプロイ」ボタンを押し、表示された URL をコピー
 * 7. .env.local の GAS_FEEDBACK_WEBHOOK_URL に貼り付け
 * 8. Next.js を再起動（npm run dev）
 *
 * 【列構成】（A〜O列）
 * A: id
 * B: created_at
 * C: user_name
 * D: user_email
 * E: page_name
 * F: page_url
 * G: oa_id
 * H: oa_name
 * I: work_id
 * J: work_name
 * K: category
 * L: content
 * M: status
 * N: memo
 * O: user_agent
 */

// シート名（スプレッドシートのタブ名と一致させること）
var SHEET_NAME = "feedback";

/**
 * POST リクエストを受信してスプレッドシートに追記する
 */
function doPost(e) {
  try {
    // ── リクエスト解析 ──────────────────────────────────────────────────
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "リクエストボディが空です" });
    }

    var d = JSON.parse(e.postData.contents);

    // 必須フィールドチェック
    if (!d.id || !d.content) {
      return jsonResponse({ ok: false, error: "必須フィールド (id, content) が不足しています" });
    }

    // ── シート取得 ──────────────────────────────────────────────────────
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      // シートが見つからない場合は最初のシートにフォールバック（名前を "feedback" にリネーム推奨）
      sheet = ss.getSheets()[0];
      Logger.log("⚠️ シート名 '" + SHEET_NAME + "' が見つかりません。最初のシートを使用します: " + sheet.getName());
    }

    // ── ヘッダー行の自動作成（シートが空の場合） ────────────────────────
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "id", "created_at", "user_name", "user_email",
        "page_name", "page_url",
        "oa_id", "oa_name", "work_id", "work_name",
        "category", "content",
        "status", "memo", "user_agent",
      ]);
    }

    // ── データ追記 ───────────────────────────────────────────────────────
    sheet.appendRow([
      d.id          || "",
      d.created_at  || new Date().toISOString(),
      d.user_name   || "",
      d.user_email  || "",
      d.page_name   || "",
      d.page_url    || "",
      d.oa_id       || "",
      d.oa_name     || "",
      d.work_id     || "",
      d.work_name   || "",
      d.category    || "other",
      d.content     || "",
      d.status      || "未対応",
      d.memo        || "",
      d.user_agent  || "",
    ]);

    Logger.log("✅ フィードバック書き込み完了 id=" + d.id);
    return jsonResponse({ ok: true });

  } catch (err) {
    Logger.log("❌ エラー: " + err.toString());
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * JSON レスポンスを返すヘルパー
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * テスト用関数（GAS エディタの ▶ 実行ボタンで動作確認できる）
 */
function testDoPost() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({
        id:          "test-" + Date.now(),
        created_at:  new Date().toISOString(),
        user_name:   "テストユーザー",
        user_email:  "test@example.com",
        page_name:   "アカウント一覧",
        page_url:    "http://localhost:3000/oas",
        oa_id:       null,
        oa_name:     null,
        work_id:     null,
        work_name:   null,
        category:    "other",
        content:     "GASデプロイテスト",
        status:      "未対応",
        memo:        "",
        user_agent:  "TestRunner/1.0",
      }),
    },
  };
  var result = doPost(fakeEvent);
  Logger.log("結果: " + result.getContent());
}
