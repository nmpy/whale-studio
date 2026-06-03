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

// Phase 2-E 用の型 (Admin 内部用 / shared types とは別)
type LiveActor = {
  id: string;
  oa_id: string;
  display_name: string;
  user_id: string | null;
  character_name: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
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
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [phases, setPhases] = useState<PhaseSummary[]>([]);
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [loadingActors, setLoadingActors] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!selectedSessionId && list.length > 0) {
        setSelectedSessionId(list[0].id);
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
  const fetchWorks = useCallback(async () => {
    try {
      // 既存の Whale Studio の Works API を使う (= /api/oas/[id]/works が存在する想定)
      const res = await fetch(`/api/oas/${oaId}/works`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const list = (json?.data?.works ?? json?.works ?? []) as Array<{ id: string; title: string }>;
      setWorks(list.map((w) => ({ id: w.id, title: w.title })));
    } catch {
      // works API が無くても admin 画面自体は動くので silent fail
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
      // ok() ラップ済 or 生 array の両方に対応
      const list = (json?.data?.phases ?? json?.phases ?? (Array.isArray(json) ? json : [])) as Array<{ id: string; name: string; sort_order?: number; sortOrder?: number; phase_type?: string; phaseType?: string }>;
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

      {/* ── 対象作品セレクタ (Phase 2-G) ── */}
      <section style={{ ...card, marginBottom: 16, background: "#f9fafb" }}>
        <label style={{ fontSize: 12, color: "#374151", display: "block", marginBottom: 4 }}>
          対象作品
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedWorkId ?? ""}
            onChange={(e) => setSelectedWorkId(e.target.value || null)}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            <option value="">— 作品を選択(新規セッション作成・CSV import 時の文脈) —</option>
            {works.map((w) => (
              <option key={w.id} value={w.id}>{w.title}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {effectiveWorkId
              ? `現在の文脈: ${(works.find((w) => w.id === effectiveWorkId)?.title) ?? "(未取得)"} / フェーズ ${phases.length} 件`
              : "作品未選択 — 既存セッションの編集はそのセッションの作品で動作"}
          </span>
        </div>
      </section>

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
            placeholder="新規セッション名 (例: 2026/06/15 夜公演)"
            style={inputStyle}
            disabled={creatingSession}
          />
          <button type="submit" style={buttonPrimary} disabled={creatingSession || !newSessionName.trim()}>
            {creatingSession ? "作成中…" : "作成"}
          </button>
        </form>

        {sessions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280" }}>セッションがまだありません。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {sessions.map((s) => {
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
        )}
      </section>

      {selectedSessionId && (
        <>
          {/* ── チーム管理 (Phase 2-G / セッション単位) ── */}
          <TeamsSection
            oaId={oaId}
            sessionId={selectedSessionId}
            teams={teams}
            onChanged={() => selectedSessionId && void fetchChildren(selectedSessionId)}
            onError={(msg) => setError(msg)}
          />

          {/* ── CSV import wizard (Phase 2-G / セッション単位) ── */}
          <ImportSection
            oaId={oaId}
            workId={effectiveWorkId}
            onApplied={() => {
              void fetchSessions();
              if (selectedSessionId) void fetchChildren(selectedSessionId);
            }}
            onError={(msg) => setError(msg)}
          />

          {/* ── 参加者 ── */}
          <section style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              {sectionTitle("参加者")}
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href={`/api/oas/${oaId}/live/sessions/${selectedSessionId}/export`}
                  style={{ ...buttonSecondary, textDecoration: "none", display: "inline-block", lineHeight: "20px" }}
                >
                  CSV エクスポート
                </a>
                <button
                  onClick={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                  style={buttonSecondary}
                  disabled={loadingChildren}
                >
                  {loadingChildren ? "読込中…" : "再読込"}
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

          {/* ── Actor 向け指示 (Phase 2-E / session-scoped) ── */}
          <InstructionsSection
            oaId={oaId}
            sessionId={selectedSessionId}
            instructions={instructions}
            participants={participants}
            actors={actors}
            onChanged={() => selectedSessionId && void fetchChildren(selectedSessionId)}
            onError={(msg) => setError(msg)}
          />
        </>
      )}

      {/* ── Actor 管理 (Phase 2-E / OA-scoped / セッション非依存) ── */}
      <ActorsSection
        oaId={oaId}
        actors={actors}
        loading={loadingActors}
        onChanged={() => void fetchActors()}
        onError={(msg) => setError(msg)}
      />
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
  const [userId, setUserId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          display_name:   name.trim(),
          user_id:        userId.trim() || null,
          character_name: characterName.trim() || null,
          memo:           memo.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Actor 追加に失敗しました (HTTP ${res.status})`);
      }
      setName(""); setUserId(""); setCharacterName(""); setMemo("");
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
        {sectionTitle("Actor (= 演者) 管理")}
        <button onClick={onChanged} style={buttonSecondary} disabled={loading}>
          {loading ? "読込中…" : "再読込"}
        </button>
      </div>

      <form
        onSubmit={handleAdd}
        style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr auto", marginBottom: 12 }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="表示名 (例: 山田 / 探偵A)" style={inputStyle} disabled={busy} />
        <input value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="役柄名 (任意 / 例: 店主)" style={inputStyle} disabled={busy} />
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="auth user_id (任意)" style={inputStyle} disabled={busy} />
        <button type="submit" style={buttonPrimary} disabled={busy || !name.trim()}>
          {busy ? "追加中…" : "追加"}
        </button>
      </form>
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ (任意)" style={{ ...inputStyle, marginBottom: 12 }} disabled={busy} />

      {actors.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>Actor がまだ登録されていません。</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "8px 6px" }}>表示名</th>
              <th style={{ padding: "8px 6px" }}>役柄</th>
              <th style={{ padding: "8px 6px" }}>auth_user_id</th>
              <th style={{ padding: "8px 6px" }}>メモ</th>
            </tr>
          </thead>
          <tbody>
            {actors.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px 6px", color: "#111827" }}>{a.display_name}</td>
                <td style={{ padding: "8px 6px", color: "#374151" }}>{a.character_name ?? "—"}</td>
                <td style={{ padding: "8px 6px", color: "#6b7280", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                  {a.user_id ? <span title={a.user_id}>{a.user_id.slice(0, 8)}…</span> : "—"}
                </td>
                <td style={{ padding: "8px 6px", color: "#374151", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.memo ?? undefined}>
                  {a.memo ?? "—"}
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
// ImportSection — CSV/TSV import wizard (Phase 2-G / 5-step)
// ─────────────────────────────────────────────────────────────────────────────
type PreviewResult = {
  mode: "preview";
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
  const [busy, setBusy] = useState(false);
  // Phase 2-G では minimum: 列マッピングの上書きは preview の結果を見て手動編集可
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});

  const submit = async (mode: "preview" | "apply") => {
    if (!file)   { onError("ファイルを選択してください"); return; }
    if (!workId) { onError("先に対象作品を選択してください"); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("work_id", workId);
      form.append("dedup", dedup);
      form.append("teaming", teaming);
      form.append("delimiter", delimiter);
      form.append("mode", mode);
      // mapping override (= header → internal field)
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
      setBusy(false);
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
              {busy ? "解析中…" : "プレビュー"}
            </button>
            <button onClick={() => void submit("apply")} style={buttonPrimary} disabled={busy || !file || !workId || !preview}>
              {busy ? "実行中…" : "取込実行"}
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
