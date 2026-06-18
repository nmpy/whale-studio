// src/app/oas/[id]/works/[workId]/liff/_shared.ts
//
// LIFF 管理画面の各タブで共有する純粋ヘルパー・ラベルマップ（副作用なし）。
// 旧 liff/page.tsx に inline で持っていたものをタブ分割に伴い集約した。

export const PUBLISH_LABELS: Record<string, string> = {
  draft:     "下書き",
  published: "公開中",
  archived:  "アーカイブ",
};

export const PAGE_TYPE_LABELS: Record<string, string> = {
  default:   "デフォルト",
  hint:      "ヒント",
  hint_site: "ヒント",
  faq:       "FAQ",
  survey:    "アンケート",
  location:  "履歴",
  character: "キャラクター",
  werewolf:  "人狼",
};

export const METRIC_LABELS: Record<string, string> = {
  checkin_success: "チェックイン成功",
  survey_submit:   "回答送信",
  faq_open:        "Q&A開封",
  hint_open:       "ヒント開封",
};

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "0%";
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString();
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function buildPublicUrl(args: {
  workId: string; workPublicId?: string; pageId: string; pagePublicId?: string;
}): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  const base = env
    ? env.replace(/\/$/, "")
    : (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return "";
  // publicId が両方揃っているときは短縮 URL、無ければ UUID 形式の旧 URL
  if (args.workPublicId && args.pagePublicId) {
    return `${base}/liff/w/${args.workPublicId}/p/${args.pagePublicId}`;
  }
  return `${base}/liff/work/${args.workId}/pages/${args.pageId}`;
}
