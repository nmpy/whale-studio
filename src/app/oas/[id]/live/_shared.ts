// src/app/oas/[id]/live/_shared.ts
// Live Phase 2-B の player / actor 画面で共通利用する型・定数・スタイル。
// page.tsx と client component 双方から import 可能 (= "use client" 指定なし)。

export type LiveSession = {
  id: string;
  oa_id: string;
  /** Phase 2-G: 紐付く Work id (= 既存セッションは null) */
  work_id?: string | null;
  /** Phase 2-G: 表示用 (= server-side で join) */
  work_title?: string | null;
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
  /** Phase 2-G: 同じ回のチーム参照 */
  team_id?: string | null;
  display_name: string | null;
  line_user_id: string | null;
  status: "waiting" | "active" | "stuck" | "completed" | "dropped";
  /** legacy free-text / fallback */
  current_step: string | null;
  /** Phase 2-G: Work の Phase 参照 (= 優先) */
  current_phase_id?: string | null;
  /** Phase 2-G: server-side で join した Phase.name */
  current_phase_name?: string | null;
  /** Phase 2-G: チケットサイトの予約番号 */
  reservation_number?: string | null;
  /** Phase 2-C: Admin が自由に追記する管理メモ */
  memo: string | null;
  last_seen_at: string | null;
  /** Phase 2-D: events から導出 (Actor API のみ) */
  last_contact_at?: string | null;
  created_at: string;
  updated_at: string;
};

// Phase 2-G: チーム
export type LiveTeam = {
  id: string;
  oa_id: string;
  live_session_id: string;
  name: string;
  reservation_number: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

// Phase 2-E: Actor (= 演者) のレコード
// Phase 2-J: GET /actors では invite_* も含まれる (= POST 直後など payload 都合により optional)
export type LiveActor = {
  id: string;
  oa_id: string;
  display_name: string;
  user_id: string | null;
  character_name: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  /** Phase 2-J: 最新 invite から導出した state ("none"|"active"|"used"|"expired"|"revoked") */
  invite_state?: "none" | "active" | "used" | "expired" | "revoked";
  invite_expires_at?: string | null;
  invite_used_at?: string | null;
  invite_revoked_at?: string | null;
  invite_created_at?: string | null;
};

// Phase 2-E: participant ↔ actor の担当割当
export type LiveAssignment = {
  id: string;
  oa_id: string;
  live_session_id: string;
  participant_id: string;
  actor_id: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// Phase 2-E: Admin → Actor 向けの指示
export type LiveInstructionPriority = "low" | "normal" | "high";
export type LiveInstructionStatus = "active" | "done" | "archived";
export type LiveActorInstruction = {
  id: string;
  oa_id: string;
  live_session_id: string;
  participant_id: string | null;
  actor_id: string | null;
  title: string;
  body: string;
  priority: LiveInstructionPriority;
  status: LiveInstructionStatus;
  created_at: string;
  updated_at: string;
};

// Phase 2-I: 台本・セリフ候補
export type LiveScript = {
  id: string;
  oa_id: string;
  work_id: string | null;
  title: string;
  body: string;
  memo: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LiveCuePriority = "low" | "normal" | "high";

export type LiveCue = {
  id: string;
  oa_id: string;
  work_id: string | null;
  phase_id: string | null;
  actor_id: string | null;
  title: string;
  body: string;
  priority: LiveCuePriority;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const CUE_PRIORITY_LABEL: Record<LiveCuePriority, string> = {
  low:    "低",
  normal: "中",
  high:   "高",
};

export const INSTRUCTION_PRIORITY_LABEL: Record<LiveInstructionPriority, string> = {
  low:    "低",
  normal: "中",
  high:   "高",
};

export const INSTRUCTION_STATUS_LABEL: Record<LiveInstructionStatus, string> = {
  active:   "未完了",
  done:     "完了",
  archived: "アーカイブ",
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

// Phase 2-I.3: セッション選択ヘルパー
// JST で startsAt を年月 (YYYY-MM) / 午前午後 / HH:MM 回名 に分解する。
export function sessionYearMonth(s: LiveSession): string | null {
  if (!s.starts_at) return null;
  const d = new Date(s.starts_at);
  if (isNaN(d.getTime())) return null;
  // JST に揃える: toLocaleString で "Asia/Tokyo" 経由
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yyyy = parts.find((p) => p.type === "year")?.value;
  const mm   = parts.find((p) => p.type === "month")?.value;
  if (!yyyy || !mm) return null;
  return `${yyyy}-${mm}`;
}

export function sessionAmPm(s: LiveSession): "am" | "pm" | null {
  if (!s.starts_at) return null;
  const d = new Date(s.starts_at);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false });
  const hh = Number(fmt.formatToParts(d).find((p) => p.type === "hour")?.value);
  if (Number.isNaN(hh)) return null;
  return hh < 12 ? "am" : "pm";
}

export function sessionHourMinuteLabel(s: LiveSession): string | null {
  if (!s.starts_at) return null;
  const d = new Date(s.starts_at);
  if (isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value;
  const mi = parts.find((p) => p.type === "minute")?.value;
  if (!hh || !mi) return null;
  return `${hh}:${mi}回`;
}

/// 現在時刻に最も近いセッションを 1 件返す (= startsAt が未来で最小 / 未来が無ければ過去で最新)
export function pickNearestSession(sessions: LiveSession[]): LiveSession | null {
  if (sessions.length === 0) return null;
  const now = Date.now();
  const withTime = sessions
    .filter((s) => s.starts_at)
    .map((s) => ({ s, t: new Date(s.starts_at!).getTime() }))
    .filter((x) => !isNaN(x.t));
  if (withTime.length === 0) return sessions[0];
  // 未来優先 / 同条件は startsAt 昇順 (= 直近)
  const future = withTime.filter((x) => x.t >= now).sort((a, b) => a.t - b.t);
  if (future.length > 0) return future[0].s;
  // 未来が無ければ過去の最新
  const past = withTime.sort((a, b) => b.t - a.t);
  return past[0].s;
}
