// src/lib/feedback/format.ts
// フィードバック通知の表示整形ヘルパー（pure / 副作用なし・DB/Slack 非依存）。
// route handler / Slack 通知の両方から使い、ユニットテストしやすいよう分離している。

// ── カテゴリ表示の日本語化 ───────────────────────────────────────────────────
// 内部値 (bug / ux / feature / other / enterprise) は壊さず、表示用だけ日本語に変換する。
// 未知の値は落とさず元の値を表示する（空なら "未選択"）。
export function formatFeedbackCategory(category: string | null | undefined): string {
  switch (category) {
    case "bug":        return "バグ報告";
    case "ux":         return "使いにくさ";
    case "feature":    return "欲しい機能";
    case "other":      return "その他";
    case "enterprise": return "法人プラン相談";
    default:           return category?.trim() || "未選択";
  }
}

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
