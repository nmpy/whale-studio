// src/lib/google-sheets-client.ts
// Google Sheets API v4 クライアント（fetch ベース、外部依存なし）
//
// 認証方式:
//   A. API キー認証（公開スプレッドシート用）
//      → 環境変数: GOOGLE_SHEETS_API_KEY
//   B. サービスアカウント認証（非公開スプレッドシート用）
//      → 環境変数: GOOGLE_SERVICE_ACCOUNT_JSON  ← サービスアカウント鍵 JSON 文字列
//
// 優先順位: B (サービスアカウント) > A (API キー)

import { createSign } from "crypto";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

// ────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────

export type SheetRow = Record<string, string | number | boolean | null>;

interface ServiceAccountKey {
  client_email: string;
  private_key:  string;
}

// ────────────────────────────────────────────────
// サービスアカウント JWT 生成 + トークン取得
// ────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getServiceAccountToken(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss:   key.client_email,
    scope: SHEETS_SCOPE,
    aud:   OAUTH2_TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  })));

  const signing  = `${header}.${payload}`;
  const sign     = createSign("RSA-SHA256");
  sign.update(signing);
  const sig = base64url(sign.sign(key.private_key));
  const jwt = `${signing}.${sig}`;

  const res = await fetch(OAUTH2_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth2 トークン取得失敗: ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ────────────────────────────────────────────────
// 認証ヘッダー取得
// ────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    try {
      const key = JSON.parse(saJson) as ServiceAccountKey;
      const token = await getServiceAccountToken(key);
      return `Bearer ${token}`;
    } catch (e) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON のパースまたはトークン取得に失敗: ${e}`);
    }
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey) {
    return `key:${apiKey}`; // API キーの場合は URL パラメータで渡す（後処理）
  }

  throw new Error(
    "Google Sheets 認証情報がありません。\n" +
    "GOOGLE_SERVICE_ACCOUNT_JSON または GOOGLE_SHEETS_API_KEY を設定してください。"
  );
}

// ────────────────────────────────────────────────
// メイン関数
// ────────────────────────────────────────────────

/**
 * スプレッドシートの指定シートをオブジェクト配列として取得する。
 * 1 行目をヘッダー行として扱い、空行はスキップする。
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  sheetName:     string,
): Promise<SheetRow[]> {
  const authHeader = await getAuthHeader();
  const range      = encodeURIComponent(`${sheetName}!A:Z`);

  let url = `${SHEETS_BASE}/${spreadsheetId}/values/${range}`;
  let headers: HeadersInit = {};

  if (authHeader.startsWith("key:")) {
    // API キー認証: URL パラメータに追加
    url += `?key=${authHeader.slice(4)}`;
  } else {
    // Bearer トークン認証
    headers = { Authorization: authHeader };
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API エラー: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { values?: (string | number | boolean | null)[][] };
  const rows = json.values ?? [];
  if (rows.length < 2) return [];

  const headers_ = rows[0].map((h) => String(h ?? "").trim());

  return rows.slice(1)
    .map((row) => {
      const obj: SheetRow = {};
      headers_.forEach((h, i) => {
        const raw = row[i] ?? null;
        if (raw === "TRUE"  || raw === "true")  { obj[h] = true;  return; }
        if (raw === "FALSE" || raw === "false") { obj[h] = false; return; }
        obj[h] = raw;
      });
      return obj;
    })
    // richmenu_id が空の行はスキップ
    .filter((row) => row[headers_[0]] !== null && row[headers_[0]] !== "");
}
