// src/lib/feedback/format.ts
// フィードバック通知の表示整形ヘルパー（pure / 副作用なし・DB/Slack 非依存）。
// route handler から使い、ユニットテストしやすいよう分離している。
//
// ※ 旧 formatFeedbackCategory（カテゴリ日本語化）はカテゴリ廃止に伴い削除した。

// ── page_url から oaId / workId を抽出する ───────────────────────────────────
// origin 付き URL (https://app.whale-studio.app/oas/.../works/...) と
// パスのみ (/oas/.../works/.../liff) の両方に対応する。
// 抽出できない場合は null を返す（query / hash は無視）。
export function extractOaWorkIds(
  input: string | null | undefined,
): { oaId: string | null; workId: string | null } {
  if (!input) return { oaId: null, workId: null };

  // origin 付きなら pathname を取り出す。失敗時（パスのみ）は input をそのまま使う。
  let path = input;
  try {
    path = new URL(input).pathname;
  } catch {
    // input は既にパス（or 不正）。そのまま正規表現で処理する。
  }

  const oaMatch   = path.match(/\/oas\/([^/?#]+)/);
  const workMatch = path.match(/\/works\/([^/?#]+)/);
  return {
    oaId:   oaMatch?.[1]   ?? null,
    workId: workMatch?.[1] ?? null,
  };
}
