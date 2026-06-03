"use client";

// src/app/oas/[id]/live/actor/LiveActorClient.tsx
// Whale Studio Live for Actor — Phase 2-D 強化UI。
//
// 表示:
//   - セッション選択
//   - 参加者ごとのカード (= display_name / status / current_step / line_user_id / memo / last_contact_at)
//   - 各カードに 4 つの Actor 操作:
//       (a) 接触済みにする (= POST event type=actor_contacted)
//       (b) メモ追加       (= POST event type=note_added / 履歴に積む)
//       (c) アラート追加   (= POST event type=alert)
//       (d) 状態更新       (= PATCH /actor で status / current_step を更新)
//   - 参加者ごとのイベントログ (= 該当 participant_id でフィルタした履歴 / 最新 10 件)
//   - 「台本・セリフ候補」placeholder セクション (= 次 Phase で本格実装予定)
//
// リアルタイム更新は未実装。アクション実行後に自動 refetch / 上部「再読込」も維持。

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LiveSession,
  type LiveParticipant,
  type LiveEventLog,
  type LiveActor,
  type LiveAssignment,
  type LiveActorInstruction,
  SESSION_STATUS_LABEL,
  PARTICIPANT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  INSTRUCTION_PRIORITY_LABEL,
  INSTRUCTION_STATUS_LABEL,
  formatDateTime,
  buttonPrimary,
  buttonSecondary,
  inputStyle,
  card,
  errorBox,
} from "../_shared";

const PARTICIPANT_STATUSES = ["waiting", "active", "stuck", "completed", "dropped"] as const;
type ParticipantStatus = typeof PARTICIPANT_STATUSES[number];

// ─────────────────────────────────────────────────────────────────────────────
// InstructionCardActor — Actor が指示を表示・完了切替する小コンポーネント
// ─────────────────────────────────────────────────────────────────────────────
function InstructionCardActor({
  instruction,
  oaId,
  sessionId,
  onMutated,
  onError,
}: {
  instruction: LiveActorInstruction;
  oaId: string;
  sessionId: string;
  onMutated: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleToggle = async () => {
    const next: "active" | "done" = instruction.status === "done" ? "active" : "done";
    setBusy(true);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/instructions/${instruction.id}/actor`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: next }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `指示更新に失敗しました (HTTP ${res.status})`);
      }
      onMutated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "指示更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      style={{
        padding: 8,
        borderRadius: 6,
        background: instruction.status === "done" ? "#f3f4f6" : "#ffffff",
        border: "1px solid #e5e7eb",
        opacity: instruction.status === "archived" ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{
          padding: "1px 6px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          background: instruction.priority === "high"  ? "#fee2e2" : instruction.priority === "low" ? "#f3f4f6" : "#fef3c7",
          color:      instruction.priority === "high"  ? "#991b1b" : instruction.priority === "low" ? "#6b7280" : "#92400e",
        }}>
          {INSTRUCTION_PRIORITY_LABEL[instruction.priority]}
        </span>
        <strong style={{ fontSize: 13, color: "#111827", flex: 1, textDecoration: instruction.status === "done" ? "line-through" : "none" }}>
          {instruction.title}
        </strong>
        {instruction.status !== "archived" && (
          <button
            type="button"
            onClick={handleToggle}
            style={{
              ...buttonSecondary,
              background: instruction.status === "done" ? "#ffffff" : "#10b981",
              color:      instruction.status === "done" ? "#374151" : "#ffffff",
              border:     instruction.status === "done" ? "1px solid #e5e7eb" : "none",
            }}
            disabled={busy}
          >
            {busy ? "…" : instruction.status === "done" ? "未完了に戻す" : "完了にする"}
          </button>
        )}
      </div>
      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>
        {instruction.body}
      </p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ParticipantCard — 参加者 1 名分の詳細 + 操作カード
// ─────────────────────────────────────────────────────────────────────────────
function ParticipantCard({
  participant,
  events,
  participantInstructions,
  isAssignedToMe,
  oaId,
  sessionId,
  onMutated,
  onError,
}: {
  participant: LiveParticipant;
  events: LiveEventLog[];
  participantInstructions: LiveActorInstruction[];
  isAssignedToMe: boolean;
  oaId: string;
  sessionId: string;
  onMutated: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<null | "contact" | "note" | "alert" | "status">(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertText, setAlertText] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<ParticipantStatus>(participant.status);
  const [draftStep, setDraftStep] = useState(participant.current_step ?? "");

  // 親が refetch して participant 値が変わったら local draft も同期
  useEffect(() => {
    if (!statusOpen) {
      setDraftStatus(participant.status);
      setDraftStep(participant.current_step ?? "");
    }
  }, [participant.status, participant.current_step, statusOpen]);

  const postEvent = async (type: "actor_contacted" | "note_added" | "alert", title: string, detail?: string) => {
    const res = await fetch(`/api/oas/${oaId}/live/actor/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        session_id:     sessionId,
        type,
        title,
        detail:         detail || null,
        participant_id: participant.id,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error?.message ?? `送信に失敗しました (HTTP ${res.status})`);
    }
  };

  const handleContact = async () => {
    setBusy("contact");
    try {
      await postEvent("actor_contacted", `${participant.display_name ?? "(匿名)"} に接触`);
      onMutated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "接触記録に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const handleNoteSubmit = async () => {
    if (!noteText.trim()) return;
    setBusy("note");
    try {
      await postEvent("note_added", `${participant.display_name ?? "(匿名)"} にメモ`, noteText.trim());
      setNoteText("");
      setNoteOpen(false);
      onMutated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "メモ追加に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const handleAlertSubmit = async () => {
    if (!alertText.trim()) return;
    setBusy("alert");
    try {
      await postEvent("alert", alertText.trim());
      setAlertText("");
      setAlertOpen(false);
      onMutated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "アラート追加に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const handleStatusSubmit = async () => {
    setBusy("status");
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/participants/${participant.id}/actor`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            status:       draftStatus,
            current_step: draftStep.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `状態更新に失敗しました (HTTP ${res.status})`);
      }
      setStatusOpen(false);
      onMutated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "状態更新に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const myEvents = useMemo(
    () => events.filter((e) => e.participant_id === participant.id).slice(0, 10),
    [events, participant.id],
  );

  const statusBg =
    participant.status === "active"    ? "#d1fae5" :
    participant.status === "stuck"     ? "#fee2e2" :
    participant.status === "completed" ? "#e0e7ff" :
    participant.status === "dropped"   ? "#f3f4f6" :
                                         "#fef3c7";
  const statusColor =
    participant.status === "active"    ? "#065f46" :
    participant.status === "stuck"     ? "#991b1b" :
    participant.status === "completed" ? "#3730a3" :
    participant.status === "dropped"   ? "#6b7280" :
                                         "#92400e";

  return (
    <div
      style={{
        ...card,
        borderColor: isAssignedToMe ? "#10b981" : "#e5e7eb",
        borderWidth: isAssignedToMe ? 2 : 1,
      }}
    >
      {/* ── 見出し行 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {isAssignedToMe && (
          <span style={{
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            background: "#10b981",
            color: "#ffffff",
          }}>
            あなたの担当
          </span>
        )}
        <span
          style={{
            padding: "2px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: statusBg,
            color: statusColor,
          }}
        >
          {PARTICIPANT_STATUS_LABEL[participant.status]}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#111827", flex: 1 }}>
          {participant.display_name ?? <span style={{ color: "#9ca3af" }}>(匿名)</span>}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          最終接触 {formatDateTime(participant.last_contact_at ?? null)}
        </span>
      </div>

      {/* ── 詳細フィールド ── */}
      <dl style={{ fontSize: 12, color: "#374151", lineHeight: 1.7, margin: "0 0 12px", display: "grid", gridTemplateColumns: "120px 1fr", gap: "2px 8px" }}>
        <dt style={{ color: "#6b7280" }}>現在ステップ</dt>
        <dd style={{ margin: 0 }}>{participant.current_step ?? "—"}</dd>
        <dt style={{ color: "#6b7280" }}>LINE</dt>
        <dd style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
          {participant.line_user_id ?? "—"}
        </dd>
        <dt style={{ color: "#6b7280" }}>メモ</dt>
        <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {participant.memo ?? <span style={{ color: "#9ca3af" }}>(なし)</span>}
        </dd>
        <dt style={{ color: "#6b7280" }}>最終接触</dt>
        <dd style={{ margin: 0, color: "#6b7280" }}>{formatDateTime(participant.last_contact_at ?? null)}</dd>
      </dl>

      {/* ── アクションボタン ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={handleContact} style={buttonPrimary} disabled={busy !== null}>
          {busy === "contact" ? "送信中…" : "接触済みにする"}
        </button>
        <button onClick={() => { setNoteOpen((v) => !v); setAlertOpen(false); setStatusOpen(false); }} style={buttonSecondary} disabled={busy !== null}>
          メモ追加
        </button>
        <button onClick={() => { setAlertOpen((v) => !v); setNoteOpen(false); setStatusOpen(false); }} style={{ ...buttonSecondary, color: "#991b1b", borderColor: "#fecaca" }} disabled={busy !== null}>
          アラート追加
        </button>
        <button onClick={() => { setStatusOpen((v) => !v); setNoteOpen(false); setAlertOpen(false); }} style={buttonSecondary} disabled={busy !== null}>
          状態更新
        </button>
      </div>

      {/* ── メモ入力 ── */}
      {noteOpen && (
        <div style={{ background: "#f9fafb", padding: 10, borderRadius: 8, marginBottom: 8 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="メモを入力(例: ヒント1を口頭で渡した / 詰まり気味)"
            style={{ ...inputStyle, minHeight: 60 }}
            disabled={busy !== null}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => { setNoteOpen(false); setNoteText(""); }} style={buttonSecondary} disabled={busy !== null}>
              キャンセル
            </button>
            <button onClick={handleNoteSubmit} style={buttonPrimary} disabled={busy !== null || !noteText.trim()}>
              {busy === "note" ? "追加中…" : "メモを追加"}
            </button>
          </div>
        </div>
      )}

      {/* ── アラート入力 ── */}
      {alertOpen && (
        <div style={{ background: "#fef2f2", padding: 10, borderRadius: 8, marginBottom: 8 }}>
          <input
            value={alertText}
            onChange={(e) => setAlertText(e.target.value)}
            placeholder="アラート内容(例: ペースが極端に遅れている)"
            style={inputStyle}
            disabled={busy !== null}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => { setAlertOpen(false); setAlertText(""); }} style={buttonSecondary} disabled={busy !== null}>
              キャンセル
            </button>
            <button onClick={handleAlertSubmit} style={{ ...buttonPrimary, background: "#dc2626" }} disabled={busy !== null || !alertText.trim()}>
              {busy === "alert" ? "送信中…" : "アラートを追加"}
            </button>
          </div>
        </div>
      )}

      {/* ── 状態更新 ── */}
      {statusOpen && (
        <div style={{ background: "#f9fafb", padding: 10, borderRadius: 8, marginBottom: 8 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "160px 1fr" }}>
            <label style={{ fontSize: 11, color: "#374151" }}>
              状態
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as ParticipantStatus)}
                style={inputStyle}
                disabled={busy !== null}
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
                placeholder="(任意)"
                style={inputStyle}
                disabled={busy !== null}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => setStatusOpen(false)} style={buttonSecondary} disabled={busy !== null}>
              キャンセル
            </button>
            <button onClick={handleStatusSubmit} style={buttonPrimary} disabled={busy !== null}>
              {busy === "status" ? "保存中…" : "状態を更新"}
            </button>
          </div>
        </div>
      )}

      {/* ── 当該 participant への指示 (Phase 2-E) ── */}
      {participantInstructions.length > 0 && (
        <div style={{ marginBottom: 12, padding: 8, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, marginBottom: 6 }}>
            この参加者への指示({participantInstructions.length} 件)
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {participantInstructions.map((ins) => (
              <InstructionCardActor
                key={ins.id}
                instruction={ins}
                oaId={oaId}
                sessionId={sessionId}
                onMutated={onMutated}
                onError={onError}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ── 当該 participant のイベント履歴 ── */}
      <div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
          イベント履歴(最新 {myEvents.length} 件)
        </div>
        {myEvents.length === 0 ? (
          <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>(まだ記録なし)</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
            {myEvents.map((e) => (
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
                  {EVENT_TYPE_LABEL[e.type] ?? e.type}
                </span>
                <strong>{e.title}</strong>
                {e.detail && <span style={{ color: "#6b7280" }}> — {e.detail}</span>}
                <span style={{ color: "#9ca3af", marginLeft: 6, fontSize: 11 }}>
                  {formatDateTime(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveActorClient — Actor Console 全体
// ─────────────────────────────────────────────────────────────────────────────
export function LiveActorClient({ oaId }: { oaId: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
  // Phase 2-E:
  const [actors, setActors] = useState<LiveActor[]>([]);
  const [assignments, setAssignments] = useState<LiveAssignment[]>([]);
  const [instructions, setInstructions] = useState<LiveActorInstruction[]>([]);
  const [myActorIds, setMyActorIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : "";
      const res = await fetch(`/api/oas/${oaId}/live/actor${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`取得に失敗しました (HTTP ${res.status})`);
      const json = await res.json();
      const data = json?.data ?? json;
      setSessions(data.sessions ?? []);
      setParticipants(data.participants ?? []);
      setEvents(data.events ?? []);
      setActors(data.actors ?? []);
      setAssignments(data.assignments ?? []);
      setInstructions(data.instructions ?? []);
      setMyActorIds(data.my_actor_ids ?? []);
      if (!selectedSessionId && data.sessions?.length > 0) {
        setSelectedSessionId(data.sessions[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [oaId, selectedSessionId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // ── 担当 participant 判定 + 並び替え ──
  const linkedToMe = myActorIds.length > 0;
  const assignedParticipantIds = useMemo(() => {
    if (!linkedToMe) return new Set<string>();
    return new Set(
      assignments
        .filter((as) => myActorIds.includes(as.actor_id))
        .map((as) => as.participant_id),
    );
  }, [assignments, myActorIds, linkedToMe]);

  // 担当 participant を上に、その後それ以外
  const orderedParticipants = useMemo(() => {
    if (!linkedToMe || assignedParticipantIds.size === 0) return participants;
    const mine = participants.filter((p) => assignedParticipantIds.has(p.id));
    const others = participants.filter((p) => !assignedParticipantIds.has(p.id));
    return [...mine, ...others];
  }, [participants, assignedParticipantIds, linkedToMe]);

  // Phase 2-F: priority desc (high→normal→low) + createdAt desc でソート
  const PRIORITY_RANK: Record<LiveActorInstruction["priority"], number> = { high: 0, normal: 1, low: 2 };
  const sortByPriorityThenCreated = (xs: LiveActorInstruction[]) =>
    [...xs].sort((x, y) => {
      const r = PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
      if (r !== 0) return r;
      return y.created_at.localeCompare(x.created_at);
    });

  // 自分宛て instructions: actorId が自分の myActorIds に含まれる OR actorId が null
  // active のみ / 優先度高い順
  const myInstructions = useMemo(() => {
    const base = linkedToMe
      ? instructions.filter(
          (i) => (i.actor_id === null || myActorIds.includes(i.actor_id)) && i.status === "active",
        )
      : // 未紐付け Actor は actorId=null の instructions のみ "自分宛て扱い"
        instructions.filter((i) => i.actor_id === null && i.status === "active");
    return sortByPriorityThenCreated(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructions, myActorIds, linkedToMe]);

  // participant ごとの instructions マップ (= active のみ / 優先度ソート済み)
  const instructionsByPid = useMemo(() => {
    const map = new Map<string, LiveActorInstruction[]>();
    for (const i of instructions) {
      if (i.status !== "active" || !i.participant_id) continue;
      // 自分宛て or 全 actor 向け
      if (i.actor_id !== null && !myActorIds.includes(i.actor_id) && linkedToMe) continue;
      const list = map.get(i.participant_id) ?? [];
      list.push(i);
      map.set(i.participant_id, list);
    }
    // 各 participant のリストを優先度順にソート
    for (const [pid, list] of map) {
      map.set(pid, sortByPriorityThenCreated(list));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructions, myActorIds, linkedToMe]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "8px 0 40px" }}>
      <Link
        href={`/oas/${oaId}/live`}
        style={{ fontSize: 12, color: "#6b7280", textDecoration: "none" }}
      >
        ← Whale Studio Live
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 12, marginBottom: 8, color: "#111827" }}>
        Whale Studio Live for Actor
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
        Phase 2-D: 担当プレイヤーの状態確認・接触記録・メモ・アラートを記録できます。リアルタイム更新は未実装のため、操作後は自動 refetch、状況の手動更新は「再読込」ボタンで行ってください。
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {/* ── セッション選択 ── */}
      <section style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>
            Live セッション
          </h2>
          <button onClick={() => void fetchAll()} style={buttonSecondary} disabled={loading}>
            {loading ? "読込中…" : "再読込"}
          </button>
        </div>

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
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 自分宛ての指示 (Phase 2-E / active のみ) ── */}
      {selectedSessionId && myInstructions.length > 0 && (
        <section style={{ ...card, marginBottom: 16, borderColor: "#fcd34d", background: "#fffbeb" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "#92400e" }}>
            あなた宛ての指示({myInstructions.length} 件)
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {myInstructions.map((ins) => {
              const p = ins.participant_id ? participants.find((pp) => pp.id === ins.participant_id) : null;
              return (
                <li key={ins.id} style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    対象: {p?.display_name ?? "(セッション全体)"} / 状態: {INSTRUCTION_STATUS_LABEL[ins.status]}
                  </div>
                  <InstructionCardActor
                    instruction={ins}
                    oaId={oaId}
                    sessionId={selectedSessionId}
                    onMutated={() => void fetchAll()}
                    onError={(msg) => setError(msg)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 参加者カード群 ── */}
      {selectedSessionId && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>
              参加者 ({participants.length}{linkedToMe && assignedParticipantIds.size > 0 ? ` / あなたの担当 ${assignedParticipantIds.size}` : ""})
            </h2>
          </div>
          {!linkedToMe && (
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              ※ あなたのアカウントは Actor レコードに紐付いていません。OA 内の全 participant を表示しています。
            </p>
          )}
          {participants.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>参加者がまだ登録されていません。</p>
          ) : (
            <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
              {orderedParticipants.map((p) => (
                <ParticipantCard
                  key={p.id}
                  participant={p}
                  events={events}
                  participantInstructions={instructionsByPid.get(p.id) ?? []}
                  isAssignedToMe={assignedParticipantIds.has(p.id)}
                  oaId={oaId}
                  sessionId={selectedSessionId}
                  onMutated={() => void fetchAll()}
                  onError={(msg) => setError(msg)}
                />
              ))}
            </div>
          )}

          {/* ── 台本 placeholder ── */}
          <section
            style={{
              ...card,
              background: "#f0f9ff",
              borderColor: "#bae6fd",
              color: "#0369a1",
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px" }}>
              台本・セリフ候補
            </h2>
            <p style={{ fontSize: 12, margin: 0, lineHeight: 1.8 }}>
              🐋 演者向けの台本・推奨セリフ表示は次フェーズで追加予定です。<br />
              現状はメモ・アラート・接触記録を活用してください。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
