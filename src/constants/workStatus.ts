// src/constants/workStatus.ts
//
// 作品・OA の公開ステータスに関する表示定数。
// 複数ページで共用することで、ステータス追加時の修正漏れを防ぐ。

/** ドット付きバッジ用（WorkCard・WorkHub など） */
export const STATUS_META: Record<string, {
  label: string;
  color: string;
  bg:    string;
  dot:   string;
}> = {
  draft:  { label: "下書き", color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" },
  active: { label: "公開中", color: "#166534", bg: "#dcfce7", dot: "#22c55e" },
  paused: { label: "停止中", color: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
};

/** ボーダー付きバッジ用（OAリストカード など） */
export const STATUS_BADGE_STYLE: Record<string, {
  bg:     string;
  color:  string;
  border: string;
}> = {
  draft:  { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
  active: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  paused: { bg: "#fef9c3", color: "#854d0e", border: "#fde047" },
};

/** ステータスの表示ラベル（日本語） */
export const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};
