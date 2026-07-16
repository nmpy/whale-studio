// scenario/_flow/constants.ts
// フェーズフロー（読み取り専用ビュー）の配色・寸法トークン。ハンドオフ資料 A 案に準拠。
// 既存 _node-graph とは独立（この読み取り専用ビューは書き込みを一切行わない）。

/** ノードカードの寸法（dagre レイアウトの節点サイズにも使う）。 */
export const FLOW_NODE_W = 264;
export const FLOW_NODE_H = 112;

/** エッジ条件のトーン → 配色。色だけに依存させないため必ずテキストラベルも併記する。 */
export type EdgeTone = "ok" | "ng" | "warn" | "muted";

export const EDGE_TONE_COLOR: Record<EdgeTone, { stroke: string; bg: string; text: string; border: string }> = {
  ok:    { stroke: "#06A047", bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" }, // 正解・クリア（緑）
  ng:    { stroke: "#E0405A", bg: "#fef2f2", text: "#dc2626", border: "#fecaca" }, // 不正解・未達（赤）
  warn:  { stroke: "#E0913B", bg: "#fffbeb", text: "#b45309", border: "#fde68a" }, // ヒント・時間切れ・部分（橙）
  muted: { stroke: "#AEBBC8", bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" }, // 通常・自動遷移（グレー）
};

/** フェーズ種別 → カード左アクセント・種別バッジの配色。 */
export const PHASE_ACCENT: Record<string, { accent: string; badgeBg: string; badgeText: string; label: string }> = {
  start:  { accent: "#22c55e", badgeBg: "#f0fdf4", badgeText: "#15803d", label: "開始" },
  normal: { accent: "#6366F1", badgeBg: "#EEEFFE", badgeText: "#4F52C4", label: "通常" },
  ending: { accent: "#9CA3AF", badgeBg: "#F5F5F5", badgeText: "#777777", label: "終了" },
  global: { accent: "#b45309", badgeBg: "#fffbeb", badgeText: "#b45309", label: "全体共通" },
};

/** ビューポート背景（ドットグリッド）等。 */
export const FLOW_CANVAS_BG = "#F4F6F8";
export const FLOW_DOT_COLOR = "#D9DEE3";
export const FLOW_MIN_ZOOM = 0.15;
export const FLOW_MAX_ZOOM = 4.0;
