// src/app/admin/api/page.tsx
//
// スタジオ管理 → 「API連携」。外部連携 API（読み取り専用）の人間可読リファレンス。
//
// - Server Component（静的コンテンツのみ・インタラクティブ処理なし）。
// - 認可は src/app/admin/layout.tsx の既存サーバー gate（platform admin または workspace owner）に委ねる。
//   このページ独自の認証・認可は追加しない。API キーの入力/発行/表示は行わない。
// - 表示内容は docs/EXTERNAL_API.md と実装（src/app/api/external/v1/*・src/lib/external-auth.ts）に基づき
//   明示的に構築する。実行時に Markdown を読み込む/レンダリングする仕組みは持たない。
//
// 表示用 base URL: 外部 API の canonical 本番ドメイン。src/lib/external-links.ts の既定
//   （EXTERNAL_CANONICAL_BASE_URL）と一致させた「表示専用」定数。共有の canonical 定数が
//   export されていないためローカルに定義する（Preview URL や実行時 origin には依存しない）。
const API_BASE_URL = "https://app.whale-studio.app";

const codeBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  background: "var(--gray-50, #f8fafc)",
  border: "1px solid var(--border-light, #e5e7eb)",
  borderRadius: 8,
  fontSize: 12.5,
  lineHeight: 1.6,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  overflowX: "auto",       // 長い URL / JSON はモバイルで横スクロール
  whiteSpace: "pre",
  color: "var(--text-primary, #111827)",
};

const sectionStyle: React.CSSProperties = { marginBottom: 20 };
const pStyle: React.CSSProperties = { fontSize: 13, lineHeight: 1.8, color: "var(--text-secondary, #374151)", margin: "0 0 8px" };
const kbd: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, background: "var(--gray-100, #f3f4f6)", border: "1px solid var(--border-light, #e5e7eb)", borderRadius: 4, padding: "1px 6px" };

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/external/v1/works",
    summary: "許可対象 OA の公開中（active）作品一覧を返す。",
    params: "なし",
    response: "works[]（id / publicId / oaId / title / publishStatus / sortOrder / phaseCount）",
  },
  {
    method: "GET",
    path: "/api/external/v1/works/:workId/phases",
    summary: "指定作品のフェーズ一覧を返す（global フェーズは除外）。",
    params: "パスパラメータ workId（作品 id）",
    response: "work（id / publicId / oaId / title） + phases[]（id / key / name / phaseType / order / isActive）",
  },
  {
    method: "GET",
    path: "/api/external/v1/works/:workId/phase-links",
    summary: "作品単位リンク（scenarioUrl / liveAdminUrl / liveActorUrl）とフェーズ単位の adminUrl を返す。",
    params: "パスパラメータ workId（作品 id）",
    response: "work + links（scenarioUrl / liveAdminUrl / liveActorUrl） + phases[]（id / key / name / order / adminUrl）",
  },
];

const STATUS_CODES = [
  { code: "200", label: "成功。JSON を返却。" },
  { code: "401", label: "APIキーが不足または無効（x-whale-api-key が未指定 / 一致しない）。" },
  { code: "404", label: "対象作品が存在しない・非公開・許可対象外（存在有無は区別しない）。" },
  { code: "500", label: "サーバーエラー。" },
  { code: "503", label: "外部連携APIが未設定（サーバー側でAPIキーが構成されていない）。" },
];

export default function AdminApiReferencePage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h2>API連携</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            外部システムから作品・フェーズ情報を参照するためのAPI仕様
          </p>
        </div>
        <a
          href="/admin"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "7px 16px", fontSize: 12, fontWeight: 600,
            color: "var(--text-secondary)", background: "var(--surface)",
            border: "1px solid var(--border-light)", borderRadius: 8, textDecoration: "none",
          }}
        >
          ← スタジオ管理へ
        </a>
      </div>

      <div className="card" style={{ maxWidth: 860 }}>
        {/* 1. 概要 */}
        <section style={sectionStyle}>
          <div className="section-title">1. 概要</div>
          <p style={pStyle}>
            Whale Studioの作品やフェーズの情報を、外部システムから参照するためのAPIです。
            レスポンスは JSON 形式で返却されます。ウズプロ等の連携システムでの参照利用を想定しています。
          </p>
          <p style={{ ...pStyle, fontWeight: 700, color: "var(--text-primary, #111827)" }}>
            現在提供している外部APIは読み取り専用です。Whale Studio内のデータを作成・更新・削除することはできません。
          </p>
          <p style={pStyle}>
            返却対象は、許可された対象アカウントの<strong>公開中（active）の作品</strong>に限定されます。
            LINE の送信・進行状態の変更・Webhook 等には一切関与しません。
          </p>
        </section>

        {/* 2. ベースURL */}
        <section style={sectionStyle}>
          <div className="section-title">2. ベースURL</div>
          <pre style={codeBlockStyle}>{API_BASE_URL}</pre>
          <p style={{ ...pStyle, marginTop: 8 }}>各エンドポイントは、このベースURLに続けて指定します。</p>
        </section>

        {/* 3. 認証 */}
        <section style={sectionStyle}>
          <div className="section-title">3. 認証</div>
          <p style={pStyle}>
            すべてのリクエストに <span style={kbd}>x-whale-api-key</span> ヘッダーが必要です。
            未指定または不正なキーの場合は <span style={kbd}>401</span> を返します。
          </p>
          <pre style={codeBlockStyle}>{`x-whale-api-key: YOUR_API_KEY`}</pre>
          <p style={{ ...pStyle, marginTop: 8 }}>
            APIキーは秘匿情報です。画面・ログ・ソースコード・チャット等へ露出しないよう管理してください。
            APIキーの発行・変更については、Whale Studioの運営管理者へお問い合わせください。
          </p>
        </section>

        {/* 4. エンドポイント一覧 */}
        <section style={sectionStyle}>
          <div className="section-title">4. エンドポイント一覧</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>メソッド</th>
                  <th>パス</th>
                  <th>概要 / パラメータ / 主なレスポンス</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.path}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 700, color: "#4f46e5" }}>{e.method}</td>
                    <td style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{e.path}</td>
                    <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                      <div>{e.summary}</div>
                      <div style={{ color: "var(--text-muted)", marginTop: 3 }}>パラメータ: {e.params}</div>
                      <div style={{ color: "var(--text-muted)", marginTop: 2 }}>レスポンス: {e.response}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. リクエスト例 */}
        <section style={sectionStyle}>
          <div className="section-title">5. リクエスト例</div>
          <pre style={codeBlockStyle}>{`curl \\
  -H "x-whale-api-key: YOUR_API_KEY" \\
  "${API_BASE_URL}/api/external/v1/works"`}</pre>
        </section>

        {/* 6. レスポンス例 */}
        <section style={sectionStyle}>
          <div className="section-title">6. レスポンス例（GET /api/external/v1/works）</div>
          <pre style={codeBlockStyle}>{`{
  "success": true,
  "data": {
    "works": [
      {
        "id": "00000000-0000-0000-0000-000000000000",
        "publicId": "examplework",
        "oaId": "11111111-1111-1111-1111-111111111111",
        "title": "サンプル作品",
        "publishStatus": "active",
        "sortOrder": 0,
        "phaseCount": 3
      }
    ]
  }
}`}</pre>
          <p style={{ ...pStyle, marginTop: 8, color: "var(--text-muted)" }}>
            ※ 上記は形式を示すダミーデータです。実際の値は許可対象の作品に応じて返却されます。
          </p>
        </section>

        {/* 7. エラー */}
        <section style={{ ...sectionStyle, marginBottom: 0 }}>
          <div className="section-title">7. エラー / HTTPステータス</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>ステータス</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                {STATUS_CODES.map((s) => (
                  <tr key={s.code}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{s.code}</td>
                    <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>{s.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...pStyle, marginTop: 10, color: "var(--text-muted)" }}>
            エラー時のレスポンスは <span style={kbd}>{`{ "success": false, "error": { "code", "message" } }`}</span> 形式です。
          </p>
        </section>
      </div>
    </>
  );
}
