"use client";

// src/app/oas/[id]/live/admin/LiveAdminClient.tsx
// Whale Studio Live for Admin — Phase 2-A 仮UI (= client component)。
//
// 表示:
//   - Live セッション一覧 + 作成フォーム
//   - 選択中セッションの 参加者一覧 + 追加フォーム
//   - 選択中セッションの イベントログ一覧 + テスト用追加フォーム
//
// リアルタイム更新は不要 (= Phase 2-A)。手動「再読込」ボタンで refetch する。
// 既存トーン:
//   - bg-brand-soft / text-brand-ink (= 緑系) / bg-bg-tint / text-ink-3
//   - 角丸 12-14px / border #e5e7eb 系
//   - エラーは赤系 / 成功は緑系トースト的表示

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type LiveSession = {
  id: string;
  oa_id: string;
  work_id: string | null;
  work_title: string | null;
  name: string;
  status: "draft" | "active" | "ended";
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

type LiveParticipant = {
  id: string;
  oa_id: string;
  live_session_id: string;
  team_id: string | null;
  display_name: string | null;
  line_user_id: string | null;
  status: "waiting" | "active" | "stuck" | "completed" | "dropped";
  current_step: string | null;
  current_phase_id: string | null;
  current_phase_name: string | null;
  reservation_number: string | null;
  /** Phase 2-C: 管理メモ */
  memo: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type LiveTeam = {
  id: string;
  oa_id: string;
  live_session_id: string;
  name: string;
  reservation_number: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

type WorkSummary = {
  id: string;
  title: string;
};

type PhaseSummary = {
  id: string;
  name: string;
  sort_order: number;
  phase_type: string;
};

const PARTICIPANT_STATUSES = ["waiting", "active", "stuck", "completed", "dropped"] as const;
type ParticipantStatus = typeof PARTICIPANT_STATUSES[number];

type LiveEventLog = {
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

const SESSION_STATUS_LABEL: Record<LiveSession["status"], string> = {
  draft:  "下書き",
  active: "進行中",
  ended:  "終了",
};

const PARTICIPANT_STATUS_LABEL: Record<LiveParticipant["status"], string> = {
  waiting:   "待機中",
  active:    "進行中",
  stuck:     "詰まり",
  completed: "完了",
  dropped:   "離脱",
};

const EVENT_TYPES = [
  "qr_scanned",
  "checked_in",
  "puzzle_solved",
  "message_sent",
  "actor_contacted",
  "note_added",
  "alert",
] as const;
type EventType = typeof EVENT_TYPES[number];

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  qr_scanned:      "QR スキャン",
  checked_in:      "チェックイン",
  puzzle_solved:   "謎を解いた",
  message_sent:    "メッセージ送信",
  actor_contacted: "Actor 接触",
  note_added:      "メモ追加",
  alert:           "アラート",
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  } catch {
    return iso;
  }
}

function sectionTitle(text: string) {
  return (
    <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>
      {text}
    </h2>
  );
}

const buttonPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 700,
  border: "none",
  cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  background: "#ffffff",
  color: "#374151",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e5e7eb",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#111827",
  background: "#ffffff",
};

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
};

const errorBox: React.CSSProperties = {
  background: "#fef2f2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  margin: "8px 0",
};

// Phase 2-G.1: 共通 spinner (= 処理中インジケータ)
function Spinner({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${color}`,
        borderRightColor: "transparent",
        borderRadius: "50%",
        animation: "live-spin 0.6s linear infinite",
      }}
    />
  );
}

// inline style では @keyframes が書けないので、グローバル <style> を 1 回だけ挿入
function SpinnerStyles() {
  return (
    <style>{`
      @keyframes live-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
    `}</style>
  );
}

// Phase 2-E 用の型 (Admin 内部用 / shared types とは別)
// Phase 2-J: invite_state / invite_expires_at を含む
type LiveActor = {
  id: string;
  oa_id: string;
  display_name: string;
  user_id: string | null;
  character_name: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  invite_state?: "none" | "active" | "used" | "expired" | "revoked";
  invite_expires_at?: string | null;
  invite_used_at?: string | null;
  invite_revoked_at?: string | null;
  invite_created_at?: string | null;
};

type LiveAssignment = {
  id: string;
  oa_id: string;
  live_session_id: string;
  participant_id: string;
  actor_id: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type LiveActorInstruction = {
  id: string;
  oa_id: string;
  live_session_id: string;
  participant_id: string | null;
  actor_id: string | null;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
  status: "active" | "done" | "archived";
  created_at: string;
  updated_at: string;
};

const INSTR_PRIORITY_LABEL: Record<LiveActorInstruction["priority"], string> = {
  low: "低", normal: "中", high: "高",
};
const INSTR_STATUS_LABEL: Record<LiveActorInstruction["status"], string> = {
  active: "未完了", done: "完了", archived: "アーカイブ",
};

// ─────────────────────────────────────────────────────────────────────────────
// ParticipantRow — 参加者 1 行の表示 / 行内編集
// ─────────────────────────────────────────────────────────────────────────────
function ParticipantRow({
  participant,
  oaId,
  sessionId,
  actors,
  assignments,
  onSaved,
  onError,
  onAssignmentChanged,
  teamList,
  phaseList,
}: {
  participant: LiveParticipant;
  oaId: string;
  sessionId: string;
  actors: LiveActor[];
  assignments: LiveAssignment[];
  onSaved: () => void;
  onError: (msg: string) => void;
  onAssignmentChanged: () => void;
  teamList: LiveTeam[];
  phaseList: PhaseSummary[];
}) {
  const [editing, setEditing] = useState(false);
  const [draftName,   setDraftName]   = useState(participant.display_name ?? "");
  const [draftLine,   setDraftLine]   = useState(participant.line_user_id ?? "");
  const [draftStatus, setDraftStatus] = useState<ParticipantStatus>(participant.status);
  const [draftStep,   setDraftStep]   = useState(participant.current_step ?? "");
  const [draftMemo,   setDraftMemo]   = useState(participant.memo ?? "");
  // Phase 2-G:
  const [draftTeamId, setDraftTeamId] = useState(participant.team_id ?? "");
  const [draftPhaseId, setDraftPhaseId] = useState(participant.current_phase_id ?? "");
  const [draftReservation, setDraftReservation] = useState(participant.reservation_number ?? "");
  const [saving, setSaving] = useState(false);

  // 元データが変わったとき (= 再読込後) は draft も同期する
  useEffect(() => {
    if (!editing) {
      setDraftName(participant.display_name ?? "");
      setDraftLine(participant.line_user_id ?? "");
      setDraftStatus(participant.status);
      setDraftStep(participant.current_step ?? "");
      setDraftMemo(participant.memo ?? "");
      setDraftTeamId(participant.team_id ?? "");
      setDraftPhaseId(participant.current_phase_id ?? "");
      setDraftReservation(participant.reservation_number ?? "");
    }
  }, [participant, editing]);

  const handleStartEdit = () => {
    setDraftName(participant.display_name ?? "");
    setDraftLine(participant.line_user_id ?? "");
    setDraftStatus(participant.status);
    setDraftStep(participant.current_step ?? "");
    setDraftMemo(participant.memo ?? "");
    setDraftTeamId(participant.team_id ?? "");
    setDraftPhaseId(participant.current_phase_id ?? "");
    setDraftReservation(participant.reservation_number ?? "");
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/participants/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            display_name:       draftName.trim() || null,
            line_user_id:       draftLine.trim() || null,
            status:             draftStatus,
            current_step:       draftStep.trim() || null,
            memo:               draftMemo.trim() || null,
            team_id:            draftTeamId || null,
            current_phase_id:   draftPhaseId || null,
            reservation_number: draftReservation.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);
      }
      setEditing(false);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // 担当 actor 解決 (= 当該 participant の assignment を全件取得 / actor 名 join)
  const myAssignments = assignments.filter((as) => as.participant_id === participant.id);
  const assignedActorNames = myAssignments
    .map((as) => actors.find((ac) => ac.id === as.actor_id)?.display_name ?? "(unknown)")
    .join(", ");

  // チーム名解決
  const teamName = participant.team_id
    ? (teamList.find((t) => t.id === participant.team_id)?.name ?? "(unknown)")
    : null;
  // フェーズ/ステップ表示: Phase 名優先 / 無ければ legacy currentStep
  const phaseLabel = participant.current_phase_name ?? participant.current_step ?? null;

  if (!editing) {
    return (
      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
        <td style={{ padding: "8px 6px", color: "#111827" }}>
          {participant.display_name ?? <span style={{ color: "#9ca3af" }}>(匿名)</span>}
        </td>
        <td style={{ padding: "8px 6px" }}>
          <span style={{ fontSize: 11, color: "#374151" }}>
            {PARTICIPANT_STATUS_LABEL[participant.status]}
          </span>
        </td>
        <td style={{ padding: "8px 6px", color: "#374151" }}>
          {phaseLabel ?? "—"}
          {participant.current_phase_id && (
            <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>(phase)</span>
          )}
        </td>
        <td style={{ padding: "8px 6px", color: "#374151", fontSize: 12 }}>
          {teamName ?? <span style={{ color: "#9ca3af" }}>—</span>}
        </td>
        <td style={{ padding: "8px 6px", color: "#374151", fontSize: 11 }}>
          {participant.reservation_number ?? <span style={{ color: "#9ca3af" }}>—</span>}
        </td>
        <td
          style={{ padding: "8px 6px", color: "#374151", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={participant.memo ?? undefined}
        >
          {participant.memo ?? <span style={{ color: "#9ca3af" }}>—</span>}
        </td>
        <td style={{ padding: "8px 6px", color: "#374151", fontSize: 12 }}>
          {assignedActorNames || <span style={{ color: "#9ca3af" }}>—</span>}
        </td>
        <td style={{ padding: "8px 6px", color: "#6b7280", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
          {participant.line_user_id ?? <span style={{ color: "#9ca3af" }}>—</span>}
        </td>
        <td style={{ padding: "8px 6px" }}>
          <button type="button" onClick={handleStartEdit} style={buttonSecondary}>
            編集
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#f9fafb" }}>
      <td colSpan={9} style={{ padding: "10px 6px" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            <label style={{ fontSize: 11, color: "#374151" }}>
              表示名
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="(匿名)"
                style={inputStyle}
                disabled={saving}
              />
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              状態
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as ParticipantStatus)}
                style={inputStyle}
                disabled={saving}
              >
                {PARTICIPANT_STATUSES.map((s) => (
                  <option key={s} value={s}>{PARTICIPANT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              現在ステップ
              <input
                value={draftStep}
                onChange={(e) => setDraftStep(e.target.value)}
                placeholder="(なし)"
                style={inputStyle}
                disabled={saving}
              />
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              LINE user ID
              <input
                value={draftLine}
                onChange={(e) => setDraftLine(e.target.value)}
                placeholder="(なし)"
                style={inputStyle}
                disabled={saving}
              />
            </label>
          </div>
          {/* Phase 2-G: チーム / フェーズ / 予約番号 */}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label style={{ fontSize: 11, color: "#374151" }}>
              チーム
              <select
                value={draftTeamId}
                onChange={(e) => setDraftTeamId(e.target.value)}
                style={inputStyle}
                disabled={saving}
              >
                <option value="">— なし —</option>
                {teamList.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              現在ステップ (作品フェーズ)
              <select
                value={draftPhaseId}
                onChange={(e) => setDraftPhaseId(e.target.value)}
                style={inputStyle}
                disabled={saving}
              >
                <option value="">— なし(下の自由入力 を参照) —</option>
                {phaseList
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.phase_type !== "normal" ? ` (${p.phase_type})` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              予約番号 / 注文番号
              <input
                value={draftReservation}
                onChange={(e) => setDraftReservation(e.target.value)}
                placeholder="(任意 / CSV import の dedup キー)"
                style={inputStyle}
                disabled={saving}
              />
            </label>
          </div>

          <label style={{ fontSize: 11, color: "#374151" }}>
            メモ
            <textarea
              value={draftMemo}
              onChange={(e) => setDraftMemo(e.target.value)}
              placeholder="連絡先・特記事項・接触メモ等(任意 / 最大 2000 文字)"
              style={{ ...inputStyle, minHeight: 60 }}
              disabled={saving}
            />
          </label>

          {/* ── 担当 Actor 割当 (Phase 2-E / 2-F で解除追加) ── */}
          <div style={{ fontSize: 11, color: "#374151" }}>
            担当 Actor:
            {myAssignments.length === 0 ? (
              <span style={{ color: "#9ca3af", marginLeft: 6 }}>(未割当)</span>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "4px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {myAssignments.map((as) => {
                  const a = actors.find((ac) => ac.id === as.actor_id);
                  return (
                    <AssignmentChip
                      key={as.id}
                      assignmentId={as.id}
                      actorName={a?.display_name ?? "(unknown)"}
                      characterName={a?.character_name ?? null}
                      oaId={oaId}
                      sessionId={sessionId}
                      onRemoved={onAssignmentChanged}
                      onError={onError}
                    />
                  );
                })}
              </ul>
            )}
            <AssignActor
              oaId={oaId}
              sessionId={sessionId}
              participantId={participant.id}
              actors={actors}
              alreadyAssignedActorIds={myAssignments.map((as) => as.actor_id)}
              onAdded={onAssignmentChanged}
              onError={onError}
            />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={handleCancel} style={buttonSecondary} disabled={saving}>
              キャンセル
            </button>
            <button type="button" onClick={handleSave} style={buttonPrimary} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AssignmentChip — 担当割当 1 件のチップ表示 + 解除ボタン (Phase 2-F)
// ─────────────────────────────────────────────────────────────────────────────
function AssignmentChip({
  assignmentId,
  actorName,
  characterName,
  oaId,
  sessionId,
  onRemoved,
  onError,
}: {
  assignmentId: string;
  actorName: string;
  characterName: string | null;
  oaId: string;
  sessionId: string;
  onRemoved: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    if (!confirm(`「${actorName}」の担当を解除しますか?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/assignments/${assignmentId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `担当解除に失敗しました (HTTP ${res.status})`);
      }
      onRemoved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "担当解除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li style={{ background: "#ecfdf5", color: "#065f46", padding: "2px 4px 2px 8px", borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
      {actorName}
      {characterName && <span style={{ color: "#10b981" }}>/ {characterName}</span>}
      <button
        type="button"
        onClick={handleRemove}
        disabled={busy}
        title="この Actor の担当を解除"
        style={{
          border: "none",
          background: "transparent",
          color: "#065f46",
          cursor: busy ? "not-allowed" : "pointer",
          padding: "0 4px",
          fontSize: 13,
          lineHeight: 1,
        }}
        aria-label={`${actorName} の担当を解除`}
      >
        {busy ? "…" : "×"}
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AssignActor — participant に actor を新規割当する小フォーム (= 編集 row 内)
// ─────────────────────────────────────────────────────────────────────────────
function AssignActor({
  oaId,
  sessionId,
  participantId,
  actors,
  alreadyAssignedActorIds,
  onAdded,
  onError,
}: {
  oaId: string;
  sessionId: string;
  participantId: string;
  actors: LiveActor[];
  alreadyAssignedActorIds: string[];
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [actorId, setActorId] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = actors.filter((a) => !alreadyAssignedActorIds.includes(a.id));

  const handleAdd = async () => {
    if (!actorId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/assignments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ participant_id: participantId, actor_id: actorId }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `担当割当に失敗しました (HTTP ${res.status})`);
      }
      setActorId("");
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "担当割当に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0" }}>
        追加できる Actor がありません(全員割当済 or Actor 未登録)
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <select
        value={actorId}
        onChange={(e) => setActorId(e.target.value)}
        style={{ ...inputStyle, maxWidth: 220 }}
        disabled={busy}
      >
        <option value="">— Actor を選択 —</option>
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>
            {a.display_name}{a.character_name ? ` / ${a.character_name}` : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={handleAdd} style={buttonSecondary} disabled={busy || !actorId}>
        {busy ? "追加中…" : "担当を追加"}
      </button>
    </div>
  );
}

export function LiveAdminClient({ oaId }: { oaId: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
  // Phase 2-E: Actors / Assignments / Instructions
  const [actors, setActors] = useState<LiveActor[]>([]);
  const [assignments, setAssignments] = useState<LiveAssignment[]>([]);
  const [instructions, setInstructions] = useState<LiveActorInstruction[]>([]);
  // Phase 2-G: Works / Phases / Teams + selectedWorkId
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState<string | null>(null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [phases, setPhases] = useState<PhaseSummary[]>([]);
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [loadingActors, setLoadingActors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 2-I.2 / 2-I.3: タブ切替 (= Actor・指示 → 演者管理 + 指示 に分割)
  type AdminTab = "overview" | "session" | "team-csv" | "performers" | "instructions" | "scripts";
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  // Phase 2-I.3: セッション絞り込み (= 月 / 午前午後)
  const [sessionFilterMonth, setSessionFilterMonth] = useState<string>("");
  const [sessionFilterAmPm, setSessionFilterAmPm] = useState<"" | "am" | "pm">("");

  // 選択中の Work / セッション
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  // セッションが workId を持っていればそれを優先、無ければ selectedWorkId
  const effectiveWorkId = selectedSession?.work_id ?? selectedWorkId;

  // ── 一覧取得 ──
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions`, { credentials: "include" });
      if (!res.ok) throw new Error(`セッション一覧の取得に失敗しました (HTTP ${res.status})`);
      const json = await res.json();
      const list: LiveSession[] = json?.data?.sessions ?? [];
      setSessions(list);
      // Phase 2-I.3: 初回ロード時は現在時刻に最も近い session を自動選択
      if (!selectedSessionId && list.length > 0) {
        const nearest = pickNearestSessionLocal(list);
        setSelectedSessionId(nearest?.id ?? list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoadingSessions(false);
    }
  }, [oaId, selectedSessionId]);

  const fetchChildren = useCallback(async (sessionId: string) => {
    setLoadingChildren(true);
    setError(null);
    try {
      const [pr, er, asr, ir, tr] = await Promise.all([
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/participants`, { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/events`,       { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/assignments`,  { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/instructions`, { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/teams`,        { credentials: "include" }),
      ]);
      if (!pr.ok)  throw new Error(`参加者一覧の取得に失敗しました (HTTP ${pr.status})`);
      if (!er.ok)  throw new Error(`イベント一覧の取得に失敗しました (HTTP ${er.status})`);
      if (!asr.ok) throw new Error(`担当割当の取得に失敗しました (HTTP ${asr.status})`);
      if (!ir.ok)  throw new Error(`指示一覧の取得に失敗しました (HTTP ${ir.status})`);
      if (!tr.ok)  throw new Error(`チーム一覧の取得に失敗しました (HTTP ${tr.status})`);
      const pj  = await pr.json();
      const ej  = await er.json();
      const asj = await asr.json();
      const ij  = await ir.json();
      const tj  = await tr.json();
      setParticipants(pj?.data?.participants ?? []);
      setEvents(ej?.data?.events ?? []);
      setAssignments(asj?.data?.assignments ?? []);
      setInstructions(ij?.data?.instructions ?? []);
      setTeams(tj?.data?.teams ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoadingChildren(false);
    }
  }, [oaId]);

  // Phase 2-G: Work 一覧 + 選択中 Work のフェーズ一覧
  // Phase 2-G.2: API path 修正 (= /api/oas/[id]/works ではなく /api/works?oa_id=xxx)
  // Phase 2-G.3: response shape 修正 — /api/works は ok(works.map(...)) を返すため、
  //              data 直下が配列。誤って data.works を読んでいて空配列になっていた。
  //              さらに publish_status 既定を "active" に置いていたため、null/undefined
  //              でも除外されず正しく拾うよう "draft" にしておく (= drafts も含める)。
  const fetchWorks = useCallback(async () => {
    setWorksLoading(true);
    setWorksError(null);
    try {
      const res = await fetch(`/api/works?oa_id=${encodeURIComponent(oaId)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // /api/works の shape: { success: true, data: WorkListItem[] }
      // 後方互換として data.works / works も読めるようにフォールバック
      const list = Array.isArray(json?.data)
        ? (json.data as Array<{ id: string; title: string; publish_status?: string }>)
        : Array.isArray(json?.data?.works)
          ? (json.data.works as Array<{ id: string; title: string; publish_status?: string }>)
          : Array.isArray(json?.works)
            ? (json.works as Array<{ id: string; title: string; publish_status?: string }>)
            : [];
      // archived / paused 以外を選択肢に出す (= draft / active / 未設定 を含む)
      const filtered = list.filter((w) => {
        const s = w.publish_status; // null / undefined はそのまま通す
        return s !== "archived" && s !== "paused";
      });
      setWorks(filtered.map((w) => ({ id: w.id, title: w.title })));
    } catch (err) {
      setWorksError(err instanceof Error ? err.message : "fetch error");
      setWorks([]);
    } finally {
      setWorksLoading(false);
    }
  }, [oaId]);

  const fetchPhases = useCallback(async (workId: string) => {
    try {
      // 既存の /api/phases?work_id=xxx を利用 (= プロジェクト既存規約)
      const res = await fetch(`/api/phases?work_id=${encodeURIComponent(workId)}`, { credentials: "include" });
      if (!res.ok) {
        setPhases([]);
        return;
      }
      const json = await res.json();
      // Phase 2-I.2: /api/phases の shape は { success: true, data: PhaseObject[] }
      // (= data 直下が配列)。works fetch と同じ shape 取り違えで Phase 一覧が空になる
      // バグがあったため、data 直下配列のケースを最優先で読む。
      const list = (
        Array.isArray(json?.data)            ? json.data
        : Array.isArray(json?.data?.phases)  ? json.data.phases
        : Array.isArray(json?.phases)         ? json.phases
        : Array.isArray(json)                 ? json
        : []
      ) as Array<{ id: string; name: string; sort_order?: number; sortOrder?: number; phase_type?: string; phaseType?: string }>;
      setPhases(
        list.map((p) => ({
          id:         p.id,
          name:       p.name,
          sort_order: (p.sort_order ?? p.sortOrder ?? 0),
          phase_type: (p.phase_type ?? p.phaseType ?? "normal"),
        })),
      );
    } catch {
      setPhases([]);
    }
  }, []);

  // Actor 一覧 (= OA 単位 / セッションに依存しない)
  const fetchActors = useCallback(async () => {
    setLoadingActors(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors`, { credentials: "include" });
      if (!res.ok) throw new Error(`Actor 一覧の取得に失敗しました (HTTP ${res.status})`);
      const json = await res.json();
      setActors(json?.data?.actors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoadingActors(false);
    }
  }, [oaId]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);
  useEffect(() => { void fetchActors(); }, [fetchActors]);
  useEffect(() => { void fetchWorks(); }, [fetchWorks]);

  useEffect(() => {
    if (selectedSessionId) {
      void fetchChildren(selectedSessionId);
    } else {
      setParticipants([]);
      setEvents([]);
      setAssignments([]);
      setInstructions([]);
      setTeams([]);
    }
  }, [selectedSessionId, fetchChildren]);

  // effectiveWorkId 変化で Phase 一覧を取得
  useEffect(() => {
    if (effectiveWorkId) {
      void fetchPhases(effectiveWorkId);
    } else {
      setPhases([]);
    }
  }, [effectiveWorkId, fetchPhases]);

  // ── セッション作成 ──
  const [newSessionName, setNewSessionName] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    setCreatingSession(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newSessionName.trim(),
          ...(selectedWorkId ? { work_id: selectedWorkId } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `セッション作成に失敗しました (HTTP ${res.status})`);
      }
      setNewSessionName("");
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setCreatingSession(false);
    }
  };

  // ── 参加者追加 ──
  const [newParticipantName, setNewParticipantName] = useState("");
  const [creatingParticipant, setCreatingParticipant] = useState(false);
  const handleCreateParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;
    setCreatingParticipant(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${selectedSessionId}/participants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            display_name: newParticipantName.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `参加者追加に失敗しました (HTTP ${res.status})`);
      }
      setNewParticipantName("");
      await fetchChildren(selectedSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setCreatingParticipant(false);
    }
  };

  // ── イベント追加 ──
  const [newEventType, setNewEventType] = useState<EventType>("note_added");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDetail, setNewEventDetail] = useState("");
  const [newEventParticipantId, setNewEventParticipantId] = useState<string>("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId || !newEventTitle.trim()) return;
    setCreatingEvent(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${selectedSessionId}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            type: newEventType,
            title: newEventTitle.trim(),
            detail: newEventDetail.trim() || null,
            participant_id: newEventParticipantId || null,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `イベント追加に失敗しました (HTTP ${res.status})`);
      }
      setNewEventTitle("");
      setNewEventDetail("");
      setNewEventParticipantId("");
      await fetchChildren(selectedSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setCreatingEvent(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "8px 0 40px" }}>
      <SpinnerStyles />
      <Link
        href={`/oas/${oaId}/live`}
        style={{ fontSize: 12, color: "#6b7280", textDecoration: "none" }}
      >
        ← Whale Studio Live
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 12, marginBottom: 8, color: "#111827" }}>
        Whale Studio Live for Admin
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
        Phase 2-A: セッション・参加者・イベントログの最小データ基盤。リアルタイム更新は未実装のため、各セクションの「再読込」ボタンで更新します。
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {/* ── 対象作品セレクタ (Phase 2-G / 2-G.1 で必須化 / 2-G.2 で loading/error/empty 対応) ── */}
      <section style={{ ...card, marginBottom: 16, background: "#f9fafb" }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>
          対象作品 <span style={{ color: "#dc2626" }}>*</span>
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={selectedWorkId ?? ""}
            onChange={(e) => setSelectedWorkId(e.target.value || null)}
            style={{ ...inputStyle, maxWidth: 320 }}
            disabled={worksLoading}
          >
            <option value="">
              {worksLoading
                ? "作品を読み込み中..."
                : worksError
                  ? "作品の取得に失敗しました"
                  : works.length === 0
                    ? "このOAには作品がありません"
                    : "作品を選択してください"}
            </option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>{w.title}</option>
            ))}
          </select>
          {worksLoading && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280" }}>
              <Spinner /> 作品を読み込み中...
            </span>
          )}
          {!worksLoading && worksError && (
            <button onClick={() => void fetchWorks()} style={buttonSecondary}>再試行</button>
          )}
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {selectedWorkId
              ? `フェーズ ${phases.length} 件 / 新規セッション・CSV import で使用`
              : works.length === 0 && !worksLoading && !worksError
                ? "Whale Studio の作品ページで作品を作成してください"
                : "作品を選択すると、新規セッション作成と CSV import が可能になります"}
          </span>
        </div>
      </section>

      {/* ── タブナビ (Phase 2-I.2) ── */}
      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 12, overflowX: "auto" }}>
        {([
          { id: "overview",  label: "概要" },
          { id: "session",   label: "セッション・参加者" },
          { id: "team-csv",  label: "チーム・CSV" },
          { id: "performers", label: "演者管理" },
          { id: "instructions", label: "指示" },
          { id: "scripts",   label: "台本" },
        ] as { id: AdminTab; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom: activeTab === t.id ? "2px solid #10b981" : "2px solid transparent",
              background: "transparent",
              fontSize: 13,
              fontWeight: activeTab === t.id ? 700 : 500,
              color: activeTab === t.id ? "#065f46" : "#6b7280",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── 概要 タブ ── */}
      {activeTab === "overview" && (
        <OverviewTab
          selectedWork={works.find((w) => w.id === effectiveWorkId) ?? null}
          sessionsCount={sessions.length}
          participantsCount={participants.length}
          alertsCount={events.filter((e) => e.type === "alert").length}
          activeInstructionsCount={instructions.filter((i) => i.status === "active").length}
          recentEvents={events.slice(0, 5)}
        />
      )}

      {/* ── セッション(セッション・参加者 タブ で表示) ── */}
      {activeTab === "session" && (
      <>
      {/* ── セッション ── */}
      <section style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          {sectionTitle("Live セッション")}
          <button onClick={() => void fetchSessions()} style={buttonSecondary} disabled={loadingSessions}>
            {loadingSessions ? "読込中…" : "再読込"}
          </button>
        </div>

        <form onSubmit={handleCreateSession} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            placeholder={selectedWorkId ? "新規セッション名 (例: 2026/06/15 12:00回)" : "先に対象作品を選択してください"}
            style={inputStyle}
            disabled={creatingSession || !selectedWorkId}
          />
          <button
            type="submit"
            style={buttonPrimary}
            disabled={creatingSession || !newSessionName.trim() || !selectedWorkId}
            title={!selectedWorkId ? "新規セッションには対象作品の選択が必要です" : undefined}
          >
            {creatingSession ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Spinner /> 作成中…
              </span>
            ) : "作成"}
          </button>
        </form>
        {!selectedWorkId && (
          <p style={{ fontSize: 11, color: "#92400e", margin: "0 0 8px" }}>
            ※ 新規セッション作成には対象作品の選択が必要です(既存セッションの編集には影響しません)。
          </p>
        )}

        {sessions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280" }}>セッションがまだありません。</p>
        ) : (
          <>
          {/* Phase 2-I.3: 月 / 午前午後 フィルタ */}
          <SessionFilterBar
            sessions={sessions}
            filterMonth={sessionFilterMonth}
            filterAmPm={sessionFilterAmPm}
            onChangeMonth={setSessionFilterMonth}
            onChangeAmPm={setSessionFilterAmPm}
          />
          {/* Phase 2-I.3: 現在選択中の session を上部に prominent 表示 */}
          {selectedSession && (
            <div
              style={{
                background: "#ecfdf5",
                border: "2px solid #10b981",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46" }}>選択中</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#065f46" }}>{selectedSession.name}</span>
              {selectedSession.work_title && (
                <span style={{ fontSize: 12, color: "#065f46" }}>/ {selectedSession.work_title}</span>
              )}
              {selectedSession.starts_at && (
                <span style={{ fontSize: 12, color: "#065f46" }}>/ {formatDateTime(selectedSession.starts_at)}</span>
              )}
            </div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {sessions
              .filter((s) => filterSessionMatches(s, sessionFilterMonth, sessionFilterAmPm))
              .map((s) => {
              const selected = s.id === selectedSessionId;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedSessionId(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: selected ? "#ecfdf5" : "#ffffff",
                      border: selected ? "1px solid #10b981" : "1px solid #e5e7eb",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: s.status === "active" ? "#d1fae5"
                                  : s.status === "ended"  ? "#f3f4f6"
                                                          : "#fef3c7",
                        color:      s.status === "active" ? "#065f46"
                                  : s.status === "ended"  ? "#6b7280"
                                                          : "#92400e",
                      }}
                    >
                      {SESSION_STATUS_LABEL[s.status]}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#111827", flex: 1 }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      作成 {formatDateTime(s.created_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>

      {selectedSessionId && (
        <>
          {/* ── 参加者 ── */}
          <section style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              {sectionTitle("参加者")}
              <div style={{ display: "flex", gap: 8 }}>
                <ExportButton oaId={oaId} sessionId={selectedSessionId} onError={(msg) => setError(msg)} />
                <button
                  onClick={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                  style={buttonSecondary}
                  disabled={loadingChildren}
                >
                  {loadingChildren ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Spinner /> 読込中…
                    </span>
                  ) : "再読込"}
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateParticipant} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={newParticipantName}
                onChange={(e) => setNewParticipantName(e.target.value)}
                placeholder="表示名 (例: ペア A / 匿名でも可)"
                style={inputStyle}
                disabled={creatingParticipant}
              />
              <button type="submit" style={buttonPrimary} disabled={creatingParticipant}>
                {creatingParticipant ? "追加中…" : "追加"}
              </button>
            </form>

            {participants.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6b7280" }}>参加者がまだ追加されていません。</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 6px" }}>表示名</th>
                    <th style={{ padding: "8px 6px" }}>状態</th>
                    <th style={{ padding: "8px 6px" }}>フェーズ/ステップ</th>
                    <th style={{ padding: "8px 6px" }}>チーム</th>
                    <th style={{ padding: "8px 6px" }}>予約番号</th>
                    <th style={{ padding: "8px 6px" }}>メモ</th>
                    <th style={{ padding: "8px 6px" }}>担当</th>
                    <th style={{ padding: "8px 6px" }}>LINE</th>
                    <th style={{ padding: "8px 6px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <ParticipantRow
                      key={p.id}
                      participant={p}
                      oaId={oaId}
                      sessionId={selectedSessionId!}
                      actors={actors}
                      assignments={assignments}
                      teamList={teams}
                      phaseList={phases}
                      onSaved={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                      onError={(msg) => setError(msg)}
                      onAssignmentChanged={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── イベントログ ── */}
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              {sectionTitle("イベントログ")}
              <button
                onClick={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                style={buttonSecondary}
                disabled={loadingChildren}
              >
                {loadingChildren ? "読込中…" : "再読込"}
              </button>
            </div>

            <form
              onSubmit={handleCreateEvent}
              style={{ display: "grid", gap: 8, gridTemplateColumns: "180px 1fr 180px auto", marginBottom: 16, alignItems: "start" }}
            >
              <select
                value={newEventType}
                onChange={(e) => setNewEventType(e.target.value as EventType)}
                style={inputStyle}
                disabled={creatingEvent}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>
                ))}
              </select>
              <input
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder="タイトル (例: 第3ピース回収)"
                style={inputStyle}
                disabled={creatingEvent}
              />
              <select
                value={newEventParticipantId}
                onChange={(e) => setNewEventParticipantId(e.target.value)}
                style={inputStyle}
                disabled={creatingEvent}
              >
                <option value="">— 参加者未指定 —</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name ?? "(匿名)"}
                  </option>
                ))}
              </select>
              <button type="submit" style={buttonPrimary} disabled={creatingEvent || !newEventTitle.trim()}>
                {creatingEvent ? "追加中…" : "追加"}
              </button>
              <textarea
                value={newEventDetail}
                onChange={(e) => setNewEventDetail(e.target.value)}
                placeholder="詳細 (任意)"
                style={{ ...inputStyle, minHeight: 56, gridColumn: "1 / -1" }}
                disabled={creatingEvent}
              />
            </form>

            {events.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6b7280" }}>まだイベントログがありません。</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {events.map((e) => (
                  <li
                    key={e.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: e.type === "alert" ? "#fee2e2" : "#ecfdf5",
                        color:      e.type === "alert" ? "#991b1b" : "#065f46",
                      }}>
                        {EVENT_TYPE_LABEL[(e.type as EventType)] ?? e.type}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", flex: 1 }}>
                        {e.title}
                      </span>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        {formatDateTime(e.created_at)}
                      </span>
                    </div>
                    {e.detail && (
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>
                        {e.detail}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

        </>
      )}
      </>
      )}

      {/* ── チーム・CSV タブ ── */}
      {activeTab === "team-csv" && (
        <>
          {selectedSessionId ? (
            <>
              <TeamsSection
                oaId={oaId}
                sessionId={selectedSessionId}
                teams={teams}
                onChanged={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                onError={(msg) => setError(msg)}
              />
              <ImportSection
                oaId={oaId}
                workId={effectiveWorkId}
                onApplied={() => {
                  void fetchSessions();
                  if (selectedSessionId) void fetchChildren(selectedSessionId);
                }}
                onError={(msg) => setError(msg)}
              />
              <section style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {sectionTitle("CSV エクスポート")}
                  <ExportButton oaId={oaId} sessionId={selectedSessionId} onError={(msg) => setError(msg)} />
                </div>
                <p style={{ fontSize: 11, color: "#6b7280", margin: "4px 0 0" }}>
                  選択中セッションの participants を UTF-8 BOM 付き CSV でダウンロードします。
                </p>
              </section>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#6b7280", padding: 16, background: "#f9fafb", borderRadius: 8 }}>
              「セッション・参加者」タブで対象のセッションを選択すると、チーム管理・CSV 操作が利用できます。
            </p>
          )}
        </>
      )}

      {/* ── 演者管理 タブ (Phase 2-I.3) ── */}
      {activeTab === "performers" && (
        <ActorsSection
          oaId={oaId}
          actors={actors}
          loading={loadingActors}
          onChanged={() => void fetchActors()}
          onError={(msg) => setError(msg)}
        />
      )}

      {/* ── 指示 タブ (Phase 2-I.3) ── */}
      {activeTab === "instructions" && (
        selectedSessionId ? (
          <InstructionsSection
            oaId={oaId}
            sessionId={selectedSessionId}
            instructions={instructions}
            participants={participants}
            actors={actors}
            onChanged={() => selectedSessionId && void fetchChildren(selectedSessionId)}
            onError={(msg) => setError(msg)}
          />
        ) : (
          <p style={{ fontSize: 13, color: "#6b7280", padding: 16, background: "#f9fafb", borderRadius: 8 }}>
            ※「セッション・参加者」タブでセッションを選択すると、そのセッションに紐づく Actor 指示を管理できます。
          </p>
        )
      )}

      {/* ── 台本 タブ (Phase 2-I.3) ── */}
      {activeTab === "scripts" && (
        <ScriptsAndCuesSection
          oaId={oaId}
          workId={effectiveWorkId}
          works={works}
          phases={phases}
          actors={actors}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActorsSection — OA-scoped の Actor 一覧 + 追加フォーム
// ─────────────────────────────────────────────────────────────────────────────
function ActorsSection({
  oaId,
  actors,
  loading,
  onChanged,
  onError,
}: {
  oaId: string;
  actors: LiveActor[];
  loading: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      // Phase 2-J: 新規 Actor は user_id 未紐付け (= 招待 URL 受諾で紐付ける)
      const res = await fetch(`/api/oas/${oaId}/live/actors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          display_name:   name.trim(),
          user_id:        null,
          character_name: characterName.trim() || null,
          memo:           memo.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Actor 追加に失敗しました (HTTP ${res.status})`);
      }
      setName(""); setCharacterName(""); setMemo("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Actor 追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        {sectionTitle("演者管理")}
        <button onClick={onChanged} style={buttonSecondary} disabled={loading}>
          {loading ? "読込中…" : "再読込"}
        </button>
      </div>

      <form
        onSubmit={handleAdd}
        style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto", marginBottom: 12 }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="表示名 (例: 山田 / 探偵A)" style={inputStyle} disabled={busy} />
        <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="役柄名 (任意 / 例: 店主)" style={inputStyle} disabled={busy} />
        <button type="submit" style={buttonPrimary} disabled={busy || !name.trim()}>
          {busy ? "追加中…" : "追加"}
        </button>
      </form>
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ (任意)" style={{ ...inputStyle, marginBottom: 12 }} disabled={busy} />

      {actors.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>演者がまだ登録されていません。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {actors.map((a) => (
            <ActorRow
              key={a.id}
              actor={a}
              oaId={oaId}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActorRow — Phase 2-J: 演者 1 件の行 (= 表示 / 編集 / 招待 URL 操作)
// ─────────────────────────────────────────────────────────────────────────────
function ActorRow({
  actor,
  oaId,
  onChanged,
  onError,
}: {
  actor: LiveActor;
  oaId: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(actor.display_name);
  const [characterName, setCharacterName] = useState(actor.character_name ?? "");
  const [memo, setMemo] = useState(actor.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  const inviteState = actor.invite_state ?? "none";
  const inviteLabel: Record<typeof inviteState, { text: string; color: string; bg: string }> = {
    none:    { text: "未発行",     color: "#6b7280", bg: "#f3f4f6" },
    active:  { text: "有効",       color: "#065f46", bg: "#d1fae5" },
    used:    { text: "使用済み",   color: "#1e40af", bg: "#dbeafe" },
    expired: { text: "期限切れ",   color: "#92400e", bg: "#fef3c7" },
    revoked: { text: "無効",       color: "#991b1b", bg: "#fee2e2" },
  };

  const issueInvite = async (regenerate: boolean) => {
    if (regenerate && !confirm("招待 URL を再発行すると、既存の有効な URL は無効になります。続行しますか？")) {
      return;
    }
    setBusy(true);
    setIssuedUrl(null);
    setCopyOk(false);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors/${actor.id}/invite`, {
        method:      "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `招待 URL の発行に失敗しました (HTTP ${res.status})`);
      }
      const json = await res.json();
      const url = json?.data?.invite_url ?? "";
      setIssuedUrl(url);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "招待 URL の発行に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async () => {
    if (!confirm("この演者の招待 URL を無効化します。続行しますか？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors/${actor.id}/invite`, {
        method:      "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `招待 URL の無効化に失敗しました (HTTP ${res.status})`);
      }
      setIssuedUrl(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "招待 URL の無効化に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      onError("クリップボードへのコピーに失敗しました");
    }
  };

  const saveEdit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors/${actor.id}`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          display_name:   name.trim(),
          character_name: characterName.trim() || null,
          memo:           memo.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `演者の更新に失敗しました (HTTP ${res.status})`);
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "演者の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const unlinkUser = async () => {
    if (!confirm("この演者の auth user 紐付けを解除します。続行しますか？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors/${actor.id}`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ user_id: null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `紐付け解除に失敗しました (HTTP ${res.status})`);
      }
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "紐付け解除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "12px 14px",
        display: "grid",
        gap: 8,
      }}
    >
      {editing ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="表示名" style={inputStyle} disabled={busy} />
            <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="役柄名" style={inputStyle} disabled={busy} />
          </div>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ" style={inputStyle} disabled={busy} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveEdit} style={buttonPrimary} disabled={busy || !name.trim()}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button onClick={() => { setEditing(false); setName(actor.display_name); setCharacterName(actor.character_name ?? ""); setMemo(actor.memo ?? ""); }} style={buttonSecondary} disabled={busy}>
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, color: "#111827" }}>{actor.display_name}</strong>
          {actor.character_name && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>/ {actor.character_name}</span>
          )}
          <span
            style={{
              padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
              color: inviteLabel[inviteState].color, background: inviteLabel[inviteState].bg,
            }}
            title={
              actor.invite_expires_at
                ? `期限: ${new Date(actor.invite_expires_at).toLocaleString("ja-JP")}`
                : undefined
            }
          >
            招待: {inviteLabel[inviteState].text}
          </span>
          {actor.user_id ? (
            <span style={{ fontSize: 10, color: "#065f46", background: "#d1fae5", padding: "2px 6px", borderRadius: 4 }}>
              user 紐付け済み
            </span>
          ) : (
            <span style={{ fontSize: 10, color: "#6b7280", background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>
              未紐付け
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => setEditing(true)} style={buttonSecondary} disabled={busy}>編集</button>
        </div>
      )}

      {actor.memo && !editing && (
        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{actor.memo}</p>
      )}

      {issuedUrl && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #10b981",
            borderRadius: 8,
            padding: "8px 10px",
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46" }}>
            招待 URL を発行しました (この表示を閉じると再度は表示されません)
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input value={issuedUrl} readOnly style={{ ...inputStyle, fontSize: 11, fontFamily: "ui-monospace, monospace" }} onFocus={(e) => e.currentTarget.select()} />
            <button onClick={copyInvite} style={buttonSecondary}>
              {copyOk ? "コピー済み" : "コピー"}
            </button>
            <button onClick={() => setIssuedUrl(null)} style={buttonSecondary}>閉じる</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {inviteState === "none" && (
          <button onClick={() => issueInvite(false)} style={buttonPrimary} disabled={busy}>招待 URL 発行</button>
        )}
        {(inviteState === "active" || inviteState === "used" || inviteState === "expired" || inviteState === "revoked") && (
          <button onClick={() => issueInvite(true)} style={buttonSecondary} disabled={busy}>招待 URL 再発行</button>
        )}
        {inviteState === "active" && (
          <button onClick={revokeInvite} style={buttonSecondary} disabled={busy}>無効化</button>
        )}
        {actor.user_id && (
          <button onClick={unlinkUser} style={buttonSecondary} disabled={busy}>user 紐付け解除</button>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InstructionsSection — session-scoped の Actor 向け指示一覧 + 作成
// ─────────────────────────────────────────────────────────────────────────────
function InstructionsSection({
  oaId,
  sessionId,
  instructions,
  participants,
  actors,
  onChanged,
  onError,
}: {
  oaId: string;
  sessionId: string;
  instructions: LiveActorInstruction[];
  participants: LiveParticipant[];
  actors: LiveActor[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [pid, setPid] = useState("");
  const [aid, setAid] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title:          title.trim(),
          body:           body.trim(),
          priority,
          participant_id: pid || null,
          actor_id:       aid || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `指示作成に失敗しました (HTTP ${res.status})`);
      }
      setTitle(""); setBody(""); setPriority("normal"); setPid(""); setAid("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "指示作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (id: string, status: LiveActorInstruction["status"]) => {
    setStatusBusyId(id);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/instructions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `ステータス更新に失敗しました (HTTP ${res.status})`);
      }
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "ステータス更新に失敗しました");
    } finally {
      setStatusBusyId(null);
    }
  };

  // Phase 2-F: archived filter / 一覧表示の整理
  const [showArchived, setShowArchived] = useState(false);
  const visibleInstructions = showArchived
    ? instructions
    : instructions.filter((i) => i.status !== "archived");

  return (
    <section style={{ ...card, marginBottom: 16 }}>
      {sectionTitle("Actor 向け指示")}

      <form onSubmit={handleCreate} style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 120px 1fr 1fr" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル (例: 第3ヒントを口頭で渡す)" style={inputStyle} disabled={busy} />
          <select value={priority} onChange={(e) => setPriority(e.target.value as "low" | "normal" | "high")} style={inputStyle} disabled={busy}>
            <option value="low">優先度: 低</option>
            <option value="normal">優先度: 中</option>
            <option value="high">優先度: 高</option>
          </select>
          <select value={pid} onChange={(e) => setPid(e.target.value)} style={inputStyle} disabled={busy}>
            <option value="">— 参加者: 全体 —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name ?? "(匿名)"}</option>
            ))}
          </select>
          <select value={aid} onChange={(e) => setAid(e.target.value)} style={inputStyle} disabled={busy}>
            <option value="">— Actor: 全員 —</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name}{a.character_name ? ` / ${a.character_name}` : ""}</option>
            ))}
          </select>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="指示本文 (詳細・補足など / 最大 2000 文字)" style={{ ...inputStyle, minHeight: 60 }} disabled={busy} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" style={buttonPrimary} disabled={busy || !title.trim() || !body.trim()}>
            {busy ? "作成中…" : "指示を作成"}
          </button>
        </div>
      </form>

      {/* archived 表示切替 */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          アーカイブも表示
        </label>
      </div>

      {visibleInstructions.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          {instructions.length === 0 ? "指示はまだありません。" : "表示対象の指示がありません(アーカイブ済みのみ存在)。"}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {visibleInstructions.map((i) => (
            <InstructionRow
              key={i.id}
              instruction={i}
              participants={participants}
              actors={actors}
              oaId={oaId}
              sessionId={sessionId}
              busy={statusBusyId === i.id}
              onStatus={handleStatus}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InstructionRow — 指示 1 件の表示 + inline 編集 (Phase 2-F)
// ─────────────────────────────────────────────────────────────────────────────
function InstructionRow({
  instruction: i,
  participants,
  actors,
  oaId,
  sessionId,
  busy,
  onStatus,
  onChanged,
  onError,
}: {
  instruction: LiveActorInstruction;
  participants: LiveParticipant[];
  actors: LiveActor[];
  oaId: string;
  sessionId: string;
  busy: boolean;
  onStatus: (id: string, status: LiveActorInstruction["status"]) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const p = i.participant_id ? participants.find((pp) => pp.id === i.participant_id) : null;
  const a = i.actor_id ? actors.find((aa) => aa.id === i.actor_id) : null;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(i.title);
  const [draftBody, setDraftBody] = useState(i.body);
  const [draftPriority, setDraftPriority] = useState<LiveActorInstruction["priority"]>(i.priority);
  const [draftPid, setDraftPid] = useState(i.participant_id ?? "");
  const [draftAid, setDraftAid] = useState(i.actor_id ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftTitle(i.title);
      setDraftBody(i.body);
      setDraftPriority(i.priority);
      setDraftPid(i.participant_id ?? "");
      setDraftAid(i.actor_id ?? "");
    }
  }, [i, editing]);

  const handleSave = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/instructions/${i.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title:          draftTitle.trim(),
          body:           draftBody.trim(),
          priority:       draftPriority,
          participant_id: draftPid || null,
          actor_id:       draftAid || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `指示更新に失敗しました (HTTP ${res.status})`);
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "指示更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li
        style={{
          border: "1px solid #10b981",
          borderRadius: 10,
          padding: 10,
          background: "#f0fdf4",
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 120px 1fr 1fr" }}>
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="タイトル" style={inputStyle} disabled={saving} />
            <select value={draftPriority} onChange={(e) => setDraftPriority(e.target.value as LiveActorInstruction["priority"])} style={inputStyle} disabled={saving}>
              <option value="low">優先度: 低</option>
              <option value="normal">優先度: 中</option>
              <option value="high">優先度: 高</option>
            </select>
            <select value={draftPid} onChange={(e) => setDraftPid(e.target.value)} style={inputStyle} disabled={saving}>
              <option value="">— 参加者: 全体 —</option>
              {participants.map((pp) => (
                <option key={pp.id} value={pp.id}>{pp.display_name ?? "(匿名)"}</option>
              ))}
            </select>
            <select value={draftAid} onChange={(e) => setDraftAid(e.target.value)} style={inputStyle} disabled={saving}>
              <option value="">— Actor: 全員 —</option>
              {actors.map((aa) => (
                <option key={aa.id} value={aa.id}>{aa.display_name}{aa.character_name ? ` / ${aa.character_name}` : ""}</option>
              ))}
            </select>
          </div>
          <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} placeholder="本文" style={{ ...inputStyle, minHeight: 60 }} disabled={saving} />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setEditing(false)} style={buttonSecondary} disabled={saving}>キャンセル</button>
            <button onClick={handleSave} style={buttonPrimary} disabled={saving || !draftTitle.trim() || !draftBody.trim()}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 10,
        background: i.status === "active" ? "#ffffff" : "#f9fafb",
        opacity:    i.status === "archived" ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
          background: i.priority === "high" ? "#fee2e2" : i.priority === "low" ? "#f3f4f6" : "#fef3c7",
          color:      i.priority === "high" ? "#991b1b" : i.priority === "low" ? "#6b7280" : "#92400e",
        }}>
          優先 {INSTR_PRIORITY_LABEL[i.priority]}
        </span>
        <span style={{
          padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
          background: i.status === "active" ? "#fef3c7" : i.status === "done" ? "#d1fae5" : "#e5e7eb",
          color:      i.status === "active" ? "#92400e" : i.status === "done" ? "#065f46" : "#6b7280",
        }}>
          {INSTR_STATUS_LABEL[i.status]}
        </span>
        <strong style={{ fontSize: 13, color: "#111827", flex: 1 }}>{i.title}</strong>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{formatDateTime(i.created_at)}</span>
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
        対象: {p?.display_name ?? "(セッション全体)"} / Actor: {a?.display_name ?? "(全員)"}
      </div>
      <p style={{ margin: "4px 0", fontSize: 13, color: "#374151", whiteSpace: "pre-wrap" }}>{i.body}</p>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={() => setEditing(true)} style={buttonSecondary} disabled={busy}>編集</button>
        {i.status !== "active"   && <button onClick={() => onStatus(i.id, "active")}   style={buttonSecondary} disabled={busy}>未完了に戻す</button>}
        {i.status !== "done"     && <button onClick={() => onStatus(i.id, "done")}     style={buttonSecondary} disabled={busy}>完了にする</button>}
        {i.status !== "archived" && <button onClick={() => onStatus(i.id, "archived")} style={buttonSecondary} disabled={busy}>アーカイブ</button>}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamsSection — チーム管理 (Phase 2-G / セッション単位)
// ─────────────────────────────────────────────────────────────────────────────
function TeamsSection({
  oaId,
  sessionId,
  teams,
  onChanged,
  onError,
}: {
  oaId: string;
  sessionId: string;
  teams: LiveTeam[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [reservation, setReservation] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name:               name.trim(),
          reservation_number: reservation.trim() || null,
          memo:               memo.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `チーム追加に失敗しました (HTTP ${res.status})`);
      }
      setName(""); setReservation(""); setMemo("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "チーム追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (teamId: string, teamName: string) => {
    if (!confirm(`チーム「${teamName}」を削除しますか?(所属 participant は teamId=null になります)`)) return;
    setDeleteBusyId(teamId);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/teams/${teamId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `削除に失敗しました (HTTP ${res.status})`);
      }
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <section style={{ ...card, marginBottom: 16 }}>
      {sectionTitle("チーム")}
      <form onSubmit={handleAdd} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 2fr auto", marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="チーム名 (例: チーム A / ペア 1)" style={inputStyle} disabled={busy} />
        <input value={reservation} onChange={(e) => setReservation(e.target.value)} placeholder="予約番号 (任意)" style={inputStyle} disabled={busy} />
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ (任意)" style={inputStyle} disabled={busy} />
        <button type="submit" style={buttonPrimary} disabled={busy || !name.trim()}>
          {busy ? "追加中…" : "追加"}
        </button>
      </form>

      {teams.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>チームがまだありません。</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "8px 6px" }}>チーム名</th>
              <th style={{ padding: "8px 6px" }}>予約番号</th>
              <th style={{ padding: "8px 6px" }}>メモ</th>
              <th style={{ padding: "8px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px 6px", color: "#111827" }}>{t.name}</td>
                <td style={{ padding: "8px 6px", color: "#374151" }}>{t.reservation_number ?? "—"}</td>
                <td style={{ padding: "8px 6px", color: "#374151", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.memo ?? undefined}>
                  {t.memo ?? "—"}
                </td>
                <td style={{ padding: "8px 6px" }}>
                  <button onClick={() => handleDelete(t.id, t.name)} style={buttonSecondary} disabled={deleteBusyId === t.id}>
                    {deleteBusyId === t.id ? "削除中…" : "削除"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImportSection — CSV/TSV/XLSX import wizard (Phase 2-G / 2-H で preset + xlsx 対応)
// ─────────────────────────────────────────────────────────────────────────────
type InternalImportField =
  | "display_name" | "email" | "line_user_id" | "reservation_number"
  | "__date" | "__time" | "team_name" | "current_step" | "memo" | "status";
type LiveImportMapping = Partial<Record<InternalImportField, string>>;

type BuiltinPreset = {
  id: string; name: string; description: string;
  mapping: LiveImportMapping;
  teamMode: "by_reservation" | "by_4" | "by_team_name_column" | "none";
  duplicateMode: "skip" | "overwrite" | "duplicate";
};

type SavedPreset = {
  id: string;
  oa_id: string;
  name: string;
  description: string | null;
  mapping: LiveImportMapping;
  team_mode: "by_reservation" | "by_4" | "by_team_name_column" | "none";
  duplicate_mode: "skip" | "overwrite" | "duplicate";
  delimiter: "auto" | "comma" | "tab" | null;
  encoding: "auto" | "utf-8" | "shift_jis" | null;
  created_at: string;
  updated_at: string;
};

type PreviewResult = {
  mode: "preview";
  file_format?: "csv" | "tsv" | "xlsx";
  encoding: string;
  delimiter: string;
  detected_columns: { header: string; mapped_field: string | null }[];
  preview_rows: Array<{
    raw: Record<string, string>;
    display_name: string | null;
    reservation_number: string | null;
    date: string | null;
    time: string | null;
    scheduled_at: string | null;
    team_name: string | null;
    current_step: string | null;
    memo: string | null;
    warnings: string[];
  }>;
  total_rows: number;
  file_warnings: string[];
  work: { id: string; title: string; phase_count: number };
};

type ApplyResult = {
  mode: "apply";
  created: number;
  skipped: number;
  overwritten: number;
  duplicated: number;
  errors: { row_index: number; message: string }[];
  file_warnings: string[];
};

function ImportSection({
  oaId,
  workId,
  onApplied,
  onError,
}: {
  oaId: string;
  workId: string | null;
  onApplied: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dedup, setDedup] = useState<"skip" | "overwrite" | "duplicate">("skip");
  const [teaming, setTeaming] = useState<"by_reservation" | "by_4" | "by_team_name_column" | "none">("by_reservation");
  const [delimiter, setDelimiter] = useState<"auto" | "comma" | "tab">("auto");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  // Phase 2-G.1: モード別 busy 状態 (= ボタン spinner / 個別 disabled)
  const [busyMode, setBusyMode] = useState<"preview" | "apply" | null>(null);
  // Phase 2-G では minimum: 列マッピングの上書きは preview の結果を見て手動編集可
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  // Phase 2-H: preset 関連 state
  const [builtinPresets, setBuiltinPresets] = useState<BuiltinPreset[]>([]);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(""); // "builtin:xxx" | "saved:xxx" | ""
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [presetSavingBusy, setPresetSavingBusy] = useState(false);

  // ── preset 一覧取得 ──
  useEffect(() => {
    if (!open || presetsLoaded) return;
    (async () => {
      try {
        const res = await fetch(`/api/oas/${oaId}/live/import-presets`, { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.data ?? json;
        setBuiltinPresets((data?.builtin as BuiltinPreset[]) ?? []);
        setSavedPresets((data?.saved as SavedPreset[]) ?? []);
        setPresetsLoaded(true);
      } catch {
        // silent (= preset 無くても CSV import は動く)
      }
    })();
  }, [open, presetsLoaded, oaId]);

  // ── preset 適用 ──
  const applyPreset = (key: string) => {
    setSelectedPresetKey(key);
    setPresetNotice(null);
    if (!key) return;
    const [kind, id] = key.split(":");
    if (kind === "builtin") {
      const p = builtinPresets.find((x) => x.id === id);
      if (!p) return;
      // mapping: { field: header } → mappingOverrides: { header: field }
      const overrides: Record<string, string> = {};
      for (const [field, header] of Object.entries(p.mapping)) {
        if (header) overrides[header] = field;
      }
      setMappingOverrides(overrides);
      setTeaming(p.teamMode);
      setDedup(p.duplicateMode);
      setPresetNotice(`プリセット「${p.name}」を適用しました`);
    } else if (kind === "saved") {
      const p = savedPresets.find((x) => x.id === id);
      if (!p) return;
      const overrides: Record<string, string> = {};
      for (const [field, header] of Object.entries(p.mapping)) {
        if (header) overrides[header] = field;
      }
      setMappingOverrides(overrides);
      setTeaming(p.team_mode);
      setDedup(p.duplicate_mode);
      if (p.delimiter) setDelimiter(p.delimiter);
      setPresetNotice(`プリセット「${p.name}」を適用しました`);
    }
  };

  // ── 現在のマッピングを保存 ──
  const handleSavePreset = async () => {
    const name = prompt("プリセット名を入力してください(例: 自社チケットサイト用)");
    if (!name || !name.trim()) return;
    setPresetSavingBusy(true);
    try {
      // mappingOverrides は { header: field } 形式なので、{ field: header } に反転
      const mapping: Record<string, string> = {};
      for (const [header, field] of Object.entries(mappingOverrides)) {
        if (field) mapping[field] = header;
      }
      const res = await fetch(`/api/oas/${oaId}/live/import-presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name:           name.trim(),
          mapping,
          team_mode:      teaming,
          duplicate_mode: dedup,
          delimiter,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);
      }
      const json = await res.json();
      const saved = (json?.data ?? json) as SavedPreset;
      setSavedPresets((prev) => [...prev, saved]);
      setSelectedPresetKey(`saved:${saved.id}`);
      setPresetNotice(`プリセット「${saved.name}」を保存しました`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "プリセット保存に失敗しました");
    } finally {
      setPresetSavingBusy(false);
    }
  };

  // ── プリセットを削除 ──
  const handleDeletePreset = async () => {
    if (!selectedPresetKey.startsWith("saved:")) return;
    const id = selectedPresetKey.slice("saved:".length);
    const p = savedPresets.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`プリセット「${p.name}」を削除しますか?`)) return;
    setPresetSavingBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/import-presets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `削除に失敗しました (HTTP ${res.status})`);
      }
      setSavedPresets((prev) => prev.filter((x) => x.id !== id));
      setSelectedPresetKey("");
      setPresetNotice(`プリセット「${p.name}」を削除しました`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "プリセット削除に失敗しました");
    } finally {
      setPresetSavingBusy(false);
    }
  };

  // サンプル CSV / Excel(HTML table 形式 .xls) の共通データ
  const SAMPLE_HEADERS = ["予約番号", "参加日", "開始時間", "チーム名", "参加者名", "メールアドレス", "LINE ID", "現在ステップ", "メモ"];
  const SAMPLE_ROWS: string[][] = [
    ["R001", "2026/06/10", "12:00", "Aチーム", "田中太郎", "tanaka@example.com", "Uxxxxxxxx", "導入", "テストメモ"],
    ["R001", "2026/06/10", "12:00", "Aチーム", "佐藤花子", "sato@example.com",   "Uyyyyyyyy", "導入", ""],
    ["R002", "2026/06/10", "12:30", "Bチーム", "鈴木一郎", "suzuki@example.com", "Uzzzzzzzz", "探索", ""],
  ];

  // サンプル CSV ダウンロード (= UTF-8 BOM 付)
  const handleDownloadSample = () => {
    const lines = [SAMPLE_HEADERS, ...SAMPLE_ROWS].map((row) => row.join(",")).join("\n");
    const body = "﻿" + lines + "\n";
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, "live-import-sample.csv");
  };

  // サンプル Excel ダウンロード (= HTML table を .xls として保存 / xlsx 依存なし)
  //   Excel / Numbers が HTML table 入りの .xls を読み込めるため、
  //   xlsx パッケージ(~500KB+)を追加せずに同等の体験を提供する。
  //   外形は .xls だが内部は UTF-8 HTML なので、Excel 側で「形式は xls ですが…」の
  //   警告が出る可能性がある。日本語の表示は問題なし。
  const handleDownloadSampleExcel = () => {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const headerCells = SAMPLE_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
    const bodyRows = SAMPLE_ROWS
      .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"/></head><body><table border="1"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
    const body = "﻿" + html;
    const blob = new Blob([body], { type: "application/vnd.ms-excel;charset=utf-8" });
    triggerDownload(blob, "live-import-sample.xls");
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const busy = busyMode !== null;
  const submit = async (mode: "preview" | "apply") => {
    if (!file)   { onError("ファイルを選択してください"); return; }
    if (!workId) { onError("先に対象作品を選択してください"); return; }
    setBusyMode(mode);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("work_id", workId);
      form.append("dedup", dedup);
      form.append("teaming", teaming);
      form.append("delimiter", delimiter);
      form.append("mode", mode);
      if (Object.keys(mappingOverrides).length > 0) {
        form.append("column_mapping", JSON.stringify(mappingOverrides));
      }
      const res = await fetch(`/api/oas/${oaId}/live/import?mode=${mode}`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `import に失敗しました (HTTP ${res.status})`);
      }
      const json = await res.json();
      const data = json?.data ?? json;
      if (mode === "preview") {
        setPreview(data as PreviewResult);
        setResult(null);
      } else {
        setResult(data as ApplyResult);
        onApplied();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "import に失敗しました");
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <section style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {sectionTitle("CSV / TSV インポート")}
        <button onClick={() => setOpen((v) => !v)} style={buttonSecondary}>
          {open ? "閉じる" : "開く"}
        </button>
      </div>

      {open && (
        <div style={{ display: "grid", gap: 12 }}>
          {!workId && (
            <div style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
              対象作品が未選択です。上部の「対象作品」セレクタから作品を選んでから取込してください。
            </div>
          )}

          {/* ── 説明文 (Phase 2-G.1) ── */}
          <div style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", fontSize: 12, lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}>
              チケットサイトからダウンロードした CSV / TSV を取り込めます。列名が異なる場合も、次のステップで列マッピングできます。
            </p>
            <p style={{ margin: "4px 0 0" }}>
              参加日と開始時間から Live セッション(回)を自動判定します。該当する回がない場合は、選択中の作品に紐づく回を自動作成します。
            </p>
          </div>

          {/* ── アップロードルール表示 + サンプル CSV ── */}
          <details style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "#111827" }}>
              アップロードできるファイル形式・列ルール(クリックで展開)
            </summary>
            <div style={{ marginTop: 8, color: "#374151", lineHeight: 1.8 }}>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>対応形式: <strong>CSV / TSV</strong></li>
                <li>文字コード: <strong>UTF-8 / UTF-8 BOM / Shift_JIS</strong>(自動判定)</li>
                <li>1 行目はヘッダー行(列名)</li>
                <li>参加者 1 人につき 1 行</li>
                <li>参加日 + 開始時間から「回」を判定し、なければ自動作成</li>
                <li>同じ予約番号は同じチームとして扱える(チーム化方針で選択)</li>
                <li>4 人ずつ自動チーム化も可能(チーム化方針で選択)</li>
              </ul>
              <div style={{ marginTop: 8 }}>
                <strong>推奨列順:</strong>
                <ol style={{ paddingLeft: 18, margin: "2px 0 0", color: "#6b7280" }}>
                  <li>予約番号</li>
                  <li>参加日(YYYY/MM/DD or YYYY-MM-DD)</li>
                  <li>開始時間(HH:MM)</li>
                  <li>チーム名(任意)</li>
                  <li>参加者名</li>
                  <li>メールアドレス(任意)</li>
                  <li>LINE ID(任意)</li>
                  <li>現在ステップ(任意 / 作品のフェーズ名と一致すれば自動紐付け)</li>
                  <li>メモ(任意)</li>
                </ol>
                <p style={{ marginTop: 6, color: "#6b7280" }}>
                  ※ 列マッピング機能があるため、<strong>列順が完全一致しなくても取り込めます</strong>。日本語ヘッダーは自動検出されます。
                </p>
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  style={buttonSecondary}
                >
                  サンプル CSV をダウンロード
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  style={buttonSecondary}
                >
                  サンプル Excel 形式をダウンロード
                </button>
              </div>
              <p style={{ fontSize: 10, color: "#9ca3af", margin: "4px 0 0" }}>
                ※ Excel 形式は .xls(HTML テーブル形式 / Excel ・ Numbers で開けます)。本 PR では Excel インポートは未対応で、サンプルダウンロードのみです。
              </p>
            </div>
          </details>

          {/* Phase 2-H: プリセット選択 + 保存・削除 */}
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", display: "grid", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46" }}>列マッピングプリセット</div>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr auto auto", alignItems: "center" }}>
              <select
                value={selectedPresetKey}
                onChange={(e) => applyPreset(e.target.value)}
                style={inputStyle}
                disabled={presetSavingBusy}
              >
                <option value="">— プリセットを選択(任意) —</option>
                {builtinPresets.length > 0 && (
                  <optgroup label="ビルトイン(チケットサイト雛形)">
                    {builtinPresets.map((p) => (
                      <option key={`builtin:${p.id}`} value={`builtin:${p.id}`}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
                {savedPresets.length > 0 && (
                  <optgroup label="保存済み(このOA)">
                    {savedPresets.map((p) => (
                      <option key={`saved:${p.id}`} value={`saved:${p.id}`}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button type="button" onClick={handleSavePreset} style={buttonSecondary} disabled={presetSavingBusy} title="現在の列マッピングをこの OA のプリセットとして保存">
                {presetSavingBusy ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spinner /> 保存中…</span>
                ) : "現在のマッピングを保存"}
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                style={{ ...buttonSecondary, color: "#991b1b", borderColor: "#fecaca" }}
                disabled={presetSavingBusy || !selectedPresetKey.startsWith("saved:")}
                title={selectedPresetKey.startsWith("saved:") ? "選択中の保存プリセットを削除" : "削除は保存済みプリセット選択時のみ"}
              >
                プリセットを削除
              </button>
            </div>
            {selectedPresetKey && (() => {
              const [kind, id] = selectedPresetKey.split(":");
              const desc = kind === "builtin"
                ? builtinPresets.find((p) => p.id === id)?.description
                : savedPresets.find((p) => p.id === id)?.description;
              return desc ? (
                <p style={{ fontSize: 11, color: "#065f46", margin: 0 }}>{desc}</p>
              ) : null;
            })()}
            {presetNotice && (
              <p style={{ fontSize: 11, color: "#065f46", margin: 0 }}>✓ {presetNotice}</p>
            )}
            <p style={{ fontSize: 10, color: "#6b7280", margin: 0 }}>
              ※ プリセット適用後もプレビューの列マッピング詳細から手動修正できます。
            </p>
          </div>

          {/* Step 1: ファイル + オプション */}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            <label style={{ fontSize: 11, color: "#374151" }}>
              ファイル (CSV / TSV)
              <input
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ ...inputStyle, padding: 4 }}
              />
              {file && (
                <span style={{
                  display: "inline-block",
                  marginTop: 4,
                  padding: "1px 6px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  background: file.name.toLowerCase().endsWith(".tsv") ? "#fef3c7" : "#d1fae5",
                  color:      file.name.toLowerCase().endsWith(".tsv") ? "#92400e" : "#065f46",
                }}>
                  {file.name.toLowerCase().endsWith(".tsv") ? "TSV" : "CSV"}
                </span>
              )}
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              区切り
              <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as "auto" | "comma" | "tab")} style={inputStyle}>
                <option value="auto">自動判定</option>
                <option value="comma">カンマ (CSV)</option>
                <option value="tab">タブ (TSV)</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              重複時の挙動
              <select value={dedup} onChange={(e) => setDedup(e.target.value as "skip" | "overwrite" | "duplicate")} style={inputStyle}>
                <option value="skip">skip (= 既存があればそのまま)</option>
                <option value="overwrite">overwrite (= 既存を上書き)</option>
                <option value="duplicate">duplicate (= 重複を許容して新規)</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#374151" }}>
              チーム化方針
              <select value={teaming} onChange={(e) => setTeaming(e.target.value as "by_reservation" | "by_4" | "by_team_name_column" | "none")} style={inputStyle}>
                <option value="by_reservation">予約番号ごと (推奨)</option>
                <option value="by_4">4 人ずつ自動採番</option>
                <option value="by_team_name_column">チーム名列を使う</option>
                <option value="none">チーム化しない</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => void submit("preview")} style={buttonSecondary} disabled={busy || !file || !workId}>
              {busyMode === "preview" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Spinner /> プレビュー生成中…
                </span>
              ) : "プレビュー"}
            </button>
            <button onClick={() => void submit("apply")} style={buttonPrimary} disabled={busy || !file || !workId || !preview}>
              {busyMode === "apply" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Spinner color="#ffffff" /> 取り込み中…
                </span>
              ) : "取込実行"}
            </button>
          </div>

          {/* Step 2-3: preview 結果 */}
          {preview && (
            <div style={{ background: "#f9fafb", padding: 10, borderRadius: 8, fontSize: 12 }}>
              <div style={{ marginBottom: 6 }}>
                解析結果: 全 {preview.total_rows} 行 / encoding {preview.encoding} / 区切り {preview.delimiter} / 作品 {preview.work.title} (フェーズ {preview.work.phase_count} 件)
              </div>
              {preview.file_warnings.length > 0 && (
                <ul style={{ color: "#92400e", marginBottom: 6 }}>
                  {preview.file_warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <div style={{ overflow: "auto", maxHeight: 220, border: "1px solid #e5e7eb", borderRadius: 6, marginBottom: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6", color: "#6b7280" }}>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>row</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>display_name</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>reservation</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>date / time</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>team_name</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>current_step</th>
                      <th style={{ padding: "4px 6px", textAlign: "left" }}>warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "4px 6px" }}>{i + 1}</td>
                        <td style={{ padding: "4px 6px" }}>{r.display_name ?? "—"}</td>
                        <td style={{ padding: "4px 6px" }}>{r.reservation_number ?? "—"}</td>
                        <td style={{ padding: "4px 6px" }}>{r.date ?? "—"} {r.time ?? ""}</td>
                        <td style={{ padding: "4px 6px" }}>{r.team_name ?? "—"}</td>
                        <td style={{ padding: "4px 6px" }}>{r.current_step ?? "—"}</td>
                        <td style={{ padding: "4px 6px", color: r.warnings.length > 0 ? "#92400e" : "#9ca3af" }}>
                          {r.warnings.length > 0 ? r.warnings.join(" / ") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details style={{ fontSize: 11, color: "#6b7280" }}>
                <summary>列マッピング詳細(必要なら上書き)</summary>
                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                  {preview.detected_columns.map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ width: 200, fontFamily: "ui-monospace, monospace" }}>{c.header}</span>
                      <span style={{ color: "#9ca3af" }}>→</span>
                      <select
                        value={mappingOverrides[c.header] ?? c.mapped_field ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMappingOverrides((prev) => ({ ...prev, [c.header]: v }));
                        }}
                        style={{ ...inputStyle, maxWidth: 220 }}
                      >
                        <option value="">— マップしない —</option>
                        <option value="display_name">display_name</option>
                        <option value="email">email</option>
                        <option value="line_user_id">line_user_id</option>
                        <option value="reservation_number">reservation_number</option>
                        <option value="__date">参加日 (date)</option>
                        <option value="__time">開始時間 (time)</option>
                        <option value="team_name">team_name</option>
                        <option value="current_step">current_step (= phase 名)</option>
                        <option value="memo">memo</option>
                        <option value="status">status</option>
                      </select>
                    </div>
                  ))}
                  <p style={{ color: "#6b7280" }}>※ 変更後、再度「プレビュー」を押すと反映されます。</p>
                </div>
              </details>
            </div>
          )}

          {/* 結果サマリ */}
          {result && (
            <div style={{ background: "#ecfdf5", color: "#065f46", padding: 10, borderRadius: 8, fontSize: 12 }}>
              取込完了: 作成 {result.created} / skip {result.skipped} / 上書き {result.overwritten} / 重複新規 {result.duplicated}
              {result.errors.length > 0 && (
                <ul style={{ color: "#991b1b", marginTop: 6 }}>
                  {result.errors.map((e, i) => <li key={i}>row {e.row_index + 1}: {e.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExportButton — Phase 2-G.1: spinner 付き CSV export
// ─────────────────────────────────────────────────────────────────────────────
function ExportButton({
  oaId,
  sessionId,
  onError,
}: {
  oaId: string;
  sessionId: string;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/export`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `CSV 生成に失敗しました (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      // Content-Disposition の filename を尊重
      const dispo = res.headers.get("content-disposition") ?? "";
      const m = dispo.match(/filename="([^"]+)"/);
      const filename = m?.[1] ?? `live-export-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      onError(err instanceof Error ? err.message : "CSV 生成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={handleExport} style={buttonSecondary} disabled={busy}>
      {busy ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Spinner /> CSV 生成中…
        </span>
      ) : "CSV エクスポート"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2-I.3: ScriptsAndCuesSection — 「台本」管理 (= LiveCue 単独 / LiveScript は廃止)
// ─────────────────────────────────────────────────────────────────────────────

type LiveCueRow = {
  id: string;
  oa_id: string;
  work_id: string | null;
  phase_id: string | null;
  actor_id: string | null;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const CUE_PRIORITY_LABEL: Record<LiveCueRow["priority"], string> = {
  low: "低", normal: "中", high: "高",
};

function ScriptsAndCuesSection({
  oaId,
  workId,
  works,
  phases,
  actors,
  onError,
}: {
  oaId: string;
  workId: string | null;
  works: WorkSummary[];
  phases: PhaseSummary[];
  actors: LiveActor[];
  onError: (msg: string) => void;
}) {
  // Phase 2-I.3: 「台本」を LiveCue 単独に一本化。LiveScript は UI 上廃止。
  const [cues, setCues] = useState<LiveCueRow[]>([]);
  const [loading, setLoading] = useState(false);

  const workTitle = workId ? (works.find((w) => w.id === workId)?.title ?? "(未取得)") : null;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = workId ? `?work_id=${encodeURIComponent(workId)}` : "";
      const cr = await fetch(`/api/oas/${oaId}/live/cues${qs}`, { credentials: "include" });
      if (!cr.ok) throw new Error(`台本取得に失敗 (HTTP ${cr.status})`);
      const cj = await cr.json();
      setCues(cj?.data?.cues ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [oaId, workId, onError]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // ── 台本作成 ──
  // Phase 2-I.3: LiveScript の UI/API 経路は廃止。下記 LiveCue を「台本項目」として一本化。

  // ── 台本項目作成 ──
  const [newCueTitle, setNewCueTitle] = useState("");
  const [newCueBody, setNewCueBody] = useState("");
  const [newCuePriority, setNewCuePriority] = useState<"low" | "normal" | "high">("normal");
  const [newCuePhaseId, setNewCuePhaseId] = useState("");
  const [newCueActorId, setNewCueActorId] = useState("");
  const [newCueSortOrder, setNewCueSortOrder] = useState<number>(0);
  const [creatingCue, setCreatingCue] = useState(false);

  const handleCreateCue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCueTitle.trim() || !newCueBody.trim()) return;
    setCreatingCue(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/cues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          work_id:    workId || null,
          phase_id:   newCuePhaseId || null,
          actor_id:   newCueActorId || null,
          title:      newCueTitle.trim(),
          body:       newCueBody.trim(),
          priority:   newCuePriority,
          sort_order: newCueSortOrder,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `台本項目作成に失敗 (HTTP ${res.status})`);
      }
      setNewCueTitle(""); setNewCueBody(""); setNewCuePhaseId(""); setNewCueActorId(""); setNewCueSortOrder(0); setNewCuePriority("normal");
      await fetchAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : "台本項目作成に失敗しました");
    } finally {
      setCreatingCue(false);
    }
  };

  const handleDeleteCue = async (c: LiveCueRow) => {
    if (!confirm(`台本項目「${c.title}」を削除しますか?`)) return;
    try {
      const res = await fetch(`/api/oas/${oaId}/live/cues/${c.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `削除に失敗 (HTTP ${res.status})`);
      }
      await fetchAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const handleToggleCueActive = async (c: LiveCueRow) => {
    try {
      const res = await fetch(`/api/oas/${oaId}/live/cues/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `更新に失敗 (HTTP ${res.status})`);
      }
      await fetchAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : "更新に失敗しました");
    }
  };

  return (
    <section style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {sectionTitle("台本")}
        <button onClick={() => void fetchAll()} style={buttonSecondary} disabled={loading}>
          {loading ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spinner /> 読込中…</span>
          ) : "再読込"}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 12px" }}>
        対象作品: <strong>{workTitle ?? "(未選択 / OA 共通)"}</strong>
        {workTitle ? "(作品スコープ + OA 共通)" : "(work_id=null の OA 共通のみ表示)"}
        <br />
        ※ phase 未指定 = 全体共通 / actor 未指定 = 全演者向け / phase + actor 両指定で「特定フェーズの特定演者向け」
      </p>

      {/* Phase 2-I.3: 台本項目 (= 旧 LiveCue / 台本項目) */}
      <h3 style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "12px 0 6px" }}>台本項目(タイトル / 本文 / フェーズ / 演者)</h3>
      <form onSubmit={handleCreateCue} style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 100px 1fr 1fr 80px" }}>
          <input value={newCueTitle} onChange={(e) => setNewCueTitle(e.target.value)} placeholder="台本項目タイトル (例: 第3ヒント口頭)" style={inputStyle} disabled={creatingCue} />
          <select value={newCuePriority} onChange={(e) => setNewCuePriority(e.target.value as "low" | "normal" | "high")} style={inputStyle} disabled={creatingCue}>
            <option value="low">優先 低</option>
            <option value="normal">優先 中</option>
            <option value="high">優先 高</option>
          </select>
          <select value={newCuePhaseId} onChange={(e) => setNewCuePhaseId(e.target.value)} style={inputStyle} disabled={creatingCue}>
            <option value="">— Phase: 全体 —</option>
            {phases.slice().sort((a, b) => a.sort_order - b.sort_order).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select value={newCueActorId} onChange={(e) => setNewCueActorId(e.target.value)} style={inputStyle} disabled={creatingCue}>
            <option value="">— Actor: 全員 —</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name}{a.character_name ? ` / ${a.character_name}` : ""}</option>
            ))}
          </select>
          <input
            type="number"
            value={newCueSortOrder}
            onChange={(e) => setNewCueSortOrder(Number(e.target.value) || 0)}
            placeholder="並び順"
            style={inputStyle}
            disabled={creatingCue}
          />
        </div>
        <textarea value={newCueBody} onChange={(e) => setNewCueBody(e.target.value)} placeholder="セリフ本文 / 演出メモ" style={{ ...inputStyle, minHeight: 60 }} disabled={creatingCue} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" style={buttonPrimary} disabled={creatingCue || !newCueTitle.trim() || !newCueBody.trim()}>
            {creatingCue ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spinner color="#ffffff" /> 作成中…</span>
            ) : "台本項目を追加"}
          </button>
        </div>
      </form>
      {cues.length === 0 ? (
        <p style={{ fontSize: 12, color: "#6b7280" }}>台本項目がまだありません。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {cues.map((c) => {
            return (
              <CueRow
                key={c.id}
                cue={c}
                oaId={oaId}
                phases={phases}
                actors={actors}
                onChanged={fetchAll}
                onError={onError}
                onToggleActive={() => void handleToggleCueActive(c)}
                onDelete={() => void handleDeleteCue(c)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CueRow — Phase 2-I.1: 台本項目 1 件の表示 + inline 編集
// ─────────────────────────────────────────────────────────────────────────────
function CueRow({
  cue,
  oaId,
  phases,
  actors,
  onChanged,
  onError,
  onToggleActive,
  onDelete,
}: {
  cue: LiveCueRow;
  oaId: string;
  phases: PhaseSummary[];
  actors: LiveActor[];
  onChanged: () => void;
  onError: (msg: string) => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(cue.title);
  const [draftBody, setDraftBody] = useState(cue.body);
  const [draftPriority, setDraftPriority] = useState<LiveCueRow["priority"]>(cue.priority);
  const [draftPhaseId, setDraftPhaseId] = useState(cue.phase_id ?? "");
  const [draftActorId, setDraftActorId] = useState(cue.actor_id ?? "");
  const [draftSortOrder, setDraftSortOrder] = useState<number>(cue.sort_order);
  const [draftActive, setDraftActive] = useState(cue.is_active);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftTitle(cue.title);
      setDraftBody(cue.body);
      setDraftPriority(cue.priority);
      setDraftPhaseId(cue.phase_id ?? "");
      setDraftActorId(cue.actor_id ?? "");
      setDraftSortOrder(cue.sort_order);
      setDraftActive(cue.is_active);
    }
  }, [cue, editing]);

  const handleSave = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/cues/${cue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title:      draftTitle.trim(),
          body:       draftBody.trim(),
          priority:   draftPriority,
          phase_id:   draftPhaseId || null,
          actor_id:   draftActorId || null,
          sort_order: draftSortOrder,
          is_active:  draftActive,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `台本項目更新に失敗 (HTTP ${res.status})`);
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "台本項目更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li style={{ padding: 10, border: "1px solid #10b981", borderRadius: 8, background: "#f0fdf4" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 100px 1fr 1fr 80px" }}>
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="台本項目タイトル" style={inputStyle} disabled={saving} />
            <select value={draftPriority} onChange={(e) => setDraftPriority(e.target.value as LiveCueRow["priority"])} style={inputStyle} disabled={saving}>
              <option value="low">優先 低</option>
              <option value="normal">優先 中</option>
              <option value="high">優先 高</option>
            </select>
            <select value={draftPhaseId} onChange={(e) => setDraftPhaseId(e.target.value)} style={inputStyle} disabled={saving}>
              <option value="">— Phase: 全体 —</option>
              {phases.slice().sort((a, b) => a.sort_order - b.sort_order).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={draftActorId} onChange={(e) => setDraftActorId(e.target.value)} style={inputStyle} disabled={saving}>
              <option value="">— Actor: 全員 —</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>{a.display_name}{a.character_name ? ` / ${a.character_name}` : ""}</option>
              ))}
            </select>
            <input type="number" value={draftSortOrder} onChange={(e) => setDraftSortOrder(Number(e.target.value) || 0)} placeholder="並び順" style={inputStyle} disabled={saving} />
          </div>
          <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} placeholder="本文" style={{ ...inputStyle, minHeight: 60 }} disabled={saving} />
          <label style={{ fontSize: 11, color: "#374151", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={draftActive} onChange={(e) => setDraftActive(e.target.checked)} disabled={saving} />
            公開状態(チェック = 公開)
          </label>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setEditing(false)} style={buttonSecondary} disabled={saving}>キャンセル</button>
            <button onClick={handleSave} style={buttonPrimary} disabled={saving || !draftTitle.trim() || !draftBody.trim()}>
              {saving ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spinner color="#ffffff" /> 保存中…</span>
              ) : "保存"}
            </button>
          </div>
        </div>
      </li>
    );
  }

  const ph = cue.phase_id ? phases.find((p) => p.id === cue.phase_id) : null;
  const ac = cue.actor_id ? actors.find((a) => a.id === cue.actor_id) : null;

  return (
    <li style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 8, background: cue.is_active ? "#ffffff" : "#f9fafb", opacity: cue.is_active ? 1 : 0.6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
          background: cue.priority === "high" ? "#fee2e2" : cue.priority === "low" ? "#f3f4f6" : "#fef3c7",
          color:      cue.priority === "high" ? "#991b1b" : cue.priority === "low" ? "#6b7280" : "#92400e",
        }}>
          優先 {CUE_PRIORITY_LABEL[cue.priority]}
        </span>
        <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: cue.is_active ? "#d1fae5" : "#e5e7eb", color: cue.is_active ? "#065f46" : "#6b7280" }}>
          {cue.is_active ? "公開" : "非公開"}
        </span>
        <strong style={{ fontSize: 13, color: "#111827", flex: 1 }}>{cue.title}</strong>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>sort {cue.sort_order}</span>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
        Phase: {ph?.name ?? "(全体)"} / Actor: {ac?.display_name ?? "(全員)"}
      </div>
      <p style={{ margin: "2px 0", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>{cue.body}</p>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button onClick={() => setEditing(true)} style={buttonSecondary}>編集</button>
        <button onClick={onToggleActive} style={buttonSecondary}>
          {cue.is_active ? "非公開にする" : "公開にする"}
        </button>
        <button onClick={onDelete} style={{ ...buttonSecondary, color: "#991b1b", borderColor: "#fecaca" }}>削除</button>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OverviewTab — Phase 2-I.2: 「概要」タブ
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({
  selectedWork,
  sessionsCount,
  participantsCount,
  alertsCount,
  activeInstructionsCount,
  recentEvents,
}: {
  selectedWork: { id: string; title: string } | null;
  sessionsCount: number;
  participantsCount: number;
  alertsCount: number;
  activeInstructionsCount: number;
  recentEvents: LiveEventLog[];
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section style={card}>
        {sectionTitle("選択中の作品")}
        <p style={{ fontSize: 14, color: "#111827", margin: 0 }}>
          {selectedWork ? selectedWork.title : <span style={{ color: "#9ca3af" }}>(未選択)</span>}
        </p>
      </section>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatCard label="セッション数" value={sessionsCount} />
        <StatCard label="参加者数(選択中セッション)" value={participantsCount} />
        <StatCard label="アラート" value={alertsCount} accent={alertsCount > 0 ? "warn" : undefined} />
        <StatCard label="未完了の指示" value={activeInstructionsCount} accent={activeInstructionsCount > 0 ? "info" : undefined} />
      </div>

      <section style={card}>
        {sectionTitle("直近のイベント (最新 5 件)")}
        {recentEvents.length === 0 ? (
          <p style={{ fontSize: 12, color: "#6b7280" }}>まだイベントログがありません。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
            {recentEvents.map((e) => (
              <li
                key={e.id}
                style={{
                  fontSize: 12,
                  color: "#374151",
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: e.type === "alert" ? "#fef2f2" : "#f9fafb",
                }}
              >
                <span style={{
                  display: "inline-block",
                  padding: "1px 6px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  background: e.type === "alert" ? "#fee2e2" : "#ecfdf5",
                  color:      e.type === "alert" ? "#991b1b" : "#065f46",
                  marginRight: 6,
                }}>
                  {EVENT_TYPE_LABEL[e.type as EventType] ?? e.type}
                </span>
                <strong>{e.title}</strong>
                <span style={{ color: "#9ca3af", marginLeft: 6, fontSize: 11 }}>
                  {formatDateTime(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "warn" | "info" }) {
  const bg = accent === "warn" ? "#fef2f2" : accent === "info" ? "#eff6ff" : "#ffffff";
  const fg = accent === "warn" ? "#991b1b" : accent === "info" ? "#1e40af" : "#111827";
  return (
    <div style={{ ...card, background: bg }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: fg }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SessionFilterBar — Phase 2-I.3: セッション絞り込み (月 / 午前午後)
// ─────────────────────────────────────────────────────────────────────────────
function sessionYearMonthLocal(s: LiveSession): string | null {
  if (!s.starts_at) return null;
  const d = new Date(s.starts_at);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).formatToParts(d);
  const yyyy = parts.find((p) => p.type === "year")?.value;
  const mm = parts.find((p) => p.type === "month")?.value;
  return yyyy && mm ? `${yyyy}-${mm}` : null;
}
function sessionAmPmLocal(s: LiveSession): "am" | "pm" | null {
  if (!s.starts_at) return null;
  const d = new Date(s.starts_at);
  if (isNaN(d.getTime())) return null;
  const hh = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).formatToParts(d).find((p) => p.type === "hour")?.value);
  return Number.isNaN(hh) ? null : hh < 12 ? "am" : "pm";
}
function filterSessionMatches(s: LiveSession, month: string, ampm: "" | "am" | "pm"): boolean {
  if (month) {
    if (sessionYearMonthLocal(s) !== month) return false;
  }
  if (ampm) {
    if (sessionAmPmLocal(s) !== ampm) return false;
  }
  return true;
}

function SessionFilterBar({
  sessions,
  filterMonth,
  filterAmPm,
  onChangeMonth,
  onChangeAmPm,
}: {
  sessions: LiveSession[];
  filterMonth: string;
  filterAmPm: "" | "am" | "pm";
  onChangeMonth: (v: string) => void;
  onChangeAmPm: (v: "" | "am" | "pm") => void;
}) {
  const months = Array.from(new Set(
    sessions.map((s) => sessionYearMonthLocal(s)).filter((m): m is string => m !== null),
  )).sort();
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11, color: "#6b7280" }}>
      <label>
        月:&nbsp;
        <select value={filterMonth} onChange={(e) => onChangeMonth(e.target.value)} style={{ ...inputStyle, maxWidth: 140, padding: "4px 8px" }}>
          <option value="">すべて</option>
          {months.map((m) => {
            const [y, mm] = m.split("-");
            return <option key={m} value={m}>{`${y}年${Number(mm)}月`}</option>;
          })}
        </select>
      </label>
      <label>
        時間帯:&nbsp;
        <select value={filterAmPm} onChange={(e) => onChangeAmPm(e.target.value as "" | "am" | "pm")} style={{ ...inputStyle, maxWidth: 100, padding: "4px 8px" }}>
          <option value="">すべて</option>
          <option value="am">午前</option>
          <option value="pm">午後</option>
        </select>
      </label>
    </div>
  );
}

// Phase 2-I.3: 現在時刻に最も近い session を 1 件返す (= startsAt が未来で最小 / 無ければ過去で最新)
function pickNearestSessionLocal(sessions: LiveSession[]): LiveSession | null {
  if (sessions.length === 0) return null;
  const now = Date.now();
  const withTime = sessions
    .filter((s) => s.starts_at)
    .map((s) => ({ s, t: new Date(s.starts_at!).getTime() }))
    .filter((x) => !isNaN(x.t));
  if (withTime.length === 0) return sessions[0];
  const future = withTime.filter((x) => x.t >= now).sort((a, b) => a.t - b.t);
  if (future.length > 0) return future[0].s;
  const past = withTime.sort((a, b) => b.t - a.t);
  return past[0].s;
}
