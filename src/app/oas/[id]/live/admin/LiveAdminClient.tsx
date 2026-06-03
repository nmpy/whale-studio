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
  display_name: string | null;
  line_user_id: string | null;
  status: "waiting" | "active" | "stuck" | "completed" | "dropped";
  current_step: string | null;
  /** Phase 2-C: 管理メモ */
  memo: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
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
}: {
  participant: LiveParticipant;
  oaId: string;
  sessionId: string;
  actors: LiveActor[];
  assignments: LiveAssignment[];
  onSaved: () => void;
  onError: (msg: string) => void;
  onAssignmentChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName,   setDraftName]   = useState(participant.display_name ?? "");
  const [draftLine,   setDraftLine]   = useState(participant.line_user_id ?? "");
  const [draftStatus, setDraftStatus] = useState<ParticipantStatus>(participant.status);
  const [draftStep,   setDraftStep]   = useState(participant.current_step ?? "");
  const [draftMemo,   setDraftMemo]   = useState(participant.memo ?? "");
  const [saving, setSaving] = useState(false);

  // 元データが変わったとき (= 再読込後) は draft も同期する
  useEffect(() => {
    if (!editing) {
      setDraftName(participant.display_name ?? "");
      setDraftLine(participant.line_user_id ?? "");
      setDraftStatus(participant.status);
      setDraftStep(participant.current_step ?? "");
      setDraftMemo(participant.memo ?? "");
    }
  }, [participant, editing]);

  const handleStartEdit = () => {
    setDraftName(participant.display_name ?? "");
    setDraftLine(participant.line_user_id ?? "");
    setDraftStatus(participant.status);
    setDraftStep(participant.current_step ?? "");
    setDraftMemo(participant.memo ?? "");
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
            display_name: draftName.trim() || null,
            line_user_id: draftLine.trim() || null,
            status:       draftStatus,
            current_step: draftStep.trim() || null,
            memo:         draftMemo.trim() || null,
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
        <td style={{ padding: "8px 6px", color: "#374151" }}>{participant.current_step ?? "—"}</td>
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
        <td style={{ padding: "8px 6px", color: "#6b7280", fontSize: 12 }}>
          {formatDateTime(participant.last_seen_at)}
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
      <td colSpan={8} style={{ padding: "10px 6px" }}>
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

          {/* ── 担当 Actor 割当 (Phase 2-E) ── */}
          <div style={{ fontSize: 11, color: "#374151" }}>
            担当 Actor:
            {myAssignments.length === 0 ? (
              <span style={{ color: "#9ca3af", marginLeft: 6 }}>(未割当)</span>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "4px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {myAssignments.map((as) => {
                  const a = actors.find((ac) => ac.id === as.actor_id);
                  return (
                    <li key={as.id} style={{ background: "#ecfdf5", color: "#065f46", padding: "2px 8px", borderRadius: 999, fontSize: 11 }}>
                      {a?.display_name ?? "(unknown)"}
                      {a?.character_name && <span style={{ color: "#10b981", marginLeft: 4 }}>/ {a.character_name}</span>}
                    </li>
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
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [loadingActors, setLoadingActors] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const [pr, er, asr, ir] = await Promise.all([
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/participants`, { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/events`,       { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/assignments`,  { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/instructions`, { credentials: "include" }),
      ]);
      if (!pr.ok)  throw new Error(`参加者一覧の取得に失敗しました (HTTP ${pr.status})`);
      if (!er.ok)  throw new Error(`イベント一覧の取得に失敗しました (HTTP ${er.status})`);
      if (!asr.ok) throw new Error(`担当割当の取得に失敗しました (HTTP ${asr.status})`);
      if (!ir.ok)  throw new Error(`指示一覧の取得に失敗しました (HTTP ${ir.status})`);
      const pj  = await pr.json();
      const ej  = await er.json();
      const asj = await asr.json();
      const ij  = await ir.json();
      setParticipants(pj?.data?.participants ?? []);
      setEvents(ej?.data?.events ?? []);
      setAssignments(asj?.data?.assignments ?? []);
      setInstructions(ij?.data?.instructions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoadingChildren(false);
    }
  }, [oaId]);

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

  useEffect(() => {
    if (selectedSessionId) {
      void fetchChildren(selectedSessionId);
    } else {
      setParticipants([]);
      setEvents([]);
      setAssignments([]);
      setInstructions([]);
    }
  }, [selectedSessionId, fetchChildren]);

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
        body: JSON.stringify({ name: newSessionName.trim() }),
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
          {/* ── 参加者 ── */}
          <section style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              {sectionTitle("参加者")}
              <button
                onClick={() => selectedSessionId && void fetchChildren(selectedSessionId)}
                style={buttonSecondary}
                disabled={loadingChildren}
              >
                {loadingChildren ? "読込中…" : "再読込"}
              </button>
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
                    <th style={{ padding: "8px 6px" }}>現在ステップ</th>
                    <th style={{ padding: "8px 6px" }}>メモ</th>
                    <th style={{ padding: "8px 6px" }}>担当</th>
                    <th style={{ padding: "8px 6px" }}>LINE</th>
                    <th style={{ padding: "8px 6px" }}>最終接触</th>
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

      {instructions.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>指示はまだありません。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {instructions.map((i) => {
            const p = i.participant_id ? participants.find((pp) => pp.id === i.participant_id) : null;
            const a = i.actor_id ? actors.find((aa) => aa.id === i.actor_id) : null;
            return (
              <li
                key={i.id}
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
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {i.status !== "active"   && <button onClick={() => handleStatus(i.id, "active")}   style={buttonSecondary} disabled={statusBusyId === i.id}>未完了に戻す</button>}
                  {i.status !== "done"     && <button onClick={() => handleStatus(i.id, "done")}     style={buttonSecondary} disabled={statusBusyId === i.id}>完了にする</button>}
                  {i.status !== "archived" && <button onClick={() => handleStatus(i.id, "archived")} style={buttonSecondary} disabled={statusBusyId === i.id}>アーカイブ</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
