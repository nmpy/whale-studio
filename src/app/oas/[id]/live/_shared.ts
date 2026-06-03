// src/app/oas/[id]/live/_shared.ts
// Live Phase 2-B の player / actor 画面で共通利用する型・定数・スタイル。
// page.tsx と client component 双方から import 可能 (= "use client" 指定なし)。

export type LiveSession = {
  id: string;
  oa_id: string;
  name: string;
  status: "draft" | "active" | "ended";
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveParticipant = {
  id: string;
  oa_id: string;
  live_session_id: string;
  display_name: string | null;
  line_user_id: string | null;
  /** Phase 2-B.5: Supabase Auth user_id 紐付け */
  auth_user_id: string | null;
  /** Phase 2-B.5: Player の連絡先メール */
  email: string | null;
  status: "waiting" | "active" | "stuck" | "completed" | "dropped";
  current_step: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LiveEventLog = {
  id: string;
  oa_id: string;
  live_session_id: string | null;
  participant_id: string | null;
  type: string;
  title: string;
  detail: string | null;
  payload: unknown;
  created_at: string;
};

export const SESSION_STATUS_LABEL: Record<LiveSession["status"], string> = {
  draft:  "下書き",
  active: "進行中",
  ended:  "終了",
};

export const PARTICIPANT_STATUS_LABEL: Record<LiveParticipant["status"], string> = {
  waiting:   "待機中",
  active:    "進行中",
  stuck:     "詰まり",
  completed: "完了",
  dropped:   "離脱",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  qr_scanned:      "QR スキャン",
  checked_in:      "チェックイン",
  puzzle_solved:   "謎を解いた",
  message_sent:    "メッセージ送信",
  actor_contacted: "Actor 接触",
  note_added:      "メモ追加",
  alert:           "アラート",
};

// Player UI が選択肢に出す event type (= Player 寄り)。
export const PLAYER_EVENT_TYPES = [
  "qr_scanned",
  "checked_in",
  "puzzle_solved",
  "message_sent",
] as const;

// Actor UI が選択肢に出す event type (= Actor 寄り)。
export const ACTOR_EVENT_TYPES = [
  "actor_contacted",
  "note_added",
  "alert",
  "message_sent",
] as const;

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  } catch {
    return iso;
  }
}

// ── UI tokens (= 既存 Admin UI と整合) ───────────────────────────────────────

export const buttonPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 700,
  border: "none",
  cursor: "pointer",
};

export const buttonSecondary: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  background: "#ffffff",
  color: "#374151",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e5e7eb",
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#111827",
  background: "#ffffff",
};

export const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
};

export const errorBox: React.CSSProperties = {
  background: "#fef2f2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  margin: "8px 0",
};
