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
  type LiveTeam,
  type LiveCue,
  CUE_PRIORITY_LABEL,
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
  pickNearestSession,
  sessionYearMonth,
  sessionAmPm,
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
  participantCues,
  isAssignedToMe,
  teamName,
  oaId,
  sessionId,
  onMutated,
  onError,
}: {
  participant: LiveParticipant;
  events: LiveEventLog[];
  participantInstructions: LiveActorInstruction[];
  participantCues: LiveCue[];
  isAssignedToMe: boolean;
  teamName: string | null;
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
        {teamName && (
          <>
            <dt style={{ color: "#6b7280" }}>チーム</dt>
            <dd style={{ margin: 0 }}>{teamName}</dd>
          </>
        )}
        <dt style={{ color: "#6b7280" }}>現在ステップ</dt>
        <dd style={{ margin: 0 }}>
          {participant.current_phase_name ?? participant.current_step ?? "—"}
          {participant.current_phase_id && (
            <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>(phase)</span>
          )}
        </dd>
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

      {/* ── 当該 participant の現在フェーズに合うセリフ候補 (Phase 2-I) ── */}
      {participantCues.length > 0 && (
        <div style={{ marginBottom: 12, padding: 8, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 700, marginBottom: 6 }}>
            現在フェーズのセリフ候補({participantCues.length} 件)
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
            {participantCues.map((c) => (
              <li
                key={c.id}
                style={{
                  background: "#ffffff",
                  border: "1px solid #bae6fd",
                  borderLeft: c.priority === "high" ? "3px solid #dc2626" : "3px solid transparent",
                  borderRadius: 6,
                  padding: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{
                    padding: "0 6px", borderRadius: 999, fontSize: 9, fontWeight: 700,
                    background: c.priority === "high" ? "#fee2e2" : c.priority === "low" ? "#f3f4f6" : "#fef3c7",
                    color:      c.priority === "high" ? "#991b1b" : c.priority === "low" ? "#6b7280" : "#92400e",
                  }}>
                    {CUE_PRIORITY_LABEL[c.priority]}
                  </span>
                  <strong style={{ fontSize: 12, color: "#111827" }}>{c.title}</strong>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>{c.body}</p>
              </li>
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
export function LiveActorClient({
  oaId,
  canPreview = false,
  lockedWorkId = null,
}: {
  oaId: string;
  canPreview?: boolean;
  /** Phase 2-K: 作品リスト導線から ?workId=xxx で入った場合に対象 Work を固定 */
  lockedWorkId?: string | null;
}) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
  // Phase 2-E:
  const [actors, setActors] = useState<LiveActor[]>([]);
  const [assignments, setAssignments] = useState<LiveAssignment[]>([]);
  const [instructions, setInstructions] = useState<LiveActorInstruction[]>([]);
  const [myActorIds, setMyActorIds] = useState<string[]>([]);
  // Phase 2-G:
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  // Phase 2-I.3: LiveScript は廃止 (= LiveCue に一本化)。state は cues のみ。
  const [cues, setCues] = useState<LiveCue[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 2-I.3: セッション絞り込み (月 / 午前午後)
  const [sessionFilterMonth, setSessionFilterMonth] = useState<string>("");
  const [sessionFilterAmPm, setSessionFilterAmPm] = useState<"" | "am" | "pm">("");
  // Phase 2-I.3: チーム / 参加者 collapse 状態
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});
  const [collapsedParticipants, setCollapsedParticipants] = useState<Record<string, boolean>>({});
  // Phase 2-J: Owner Actor Preview Mode (= 特定 Actor 視点で表示確認)
  const [previewActorId, setPreviewActorId] = useState<string>("");
  const [activePreview, setActivePreview] = useState<{ actor_id: string; actor_display_name: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (selectedSessionId) qs.set("sessionId", selectedSessionId);
      if (canPreview && previewActorId) qs.set("previewActorId", previewActorId);
      const url = `/api/oas/${oaId}/live/actor${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`取得に失敗しました (HTTP ${res.status})`);
      const json = await res.json();
      const data = json?.data ?? json;
      // Phase 2-K: lockedWorkId 指定時は該当 work の session のみに絞る
      const allSessions: LiveSession[] = data.sessions ?? [];
      const scopedSessions = lockedWorkId
        ? allSessions.filter((s) => s.work_id === lockedWorkId)
        : allSessions;
      setSessions(scopedSessions);
      setParticipants(data.participants ?? []);
      setEvents(data.events ?? []);
      setActors(data.actors ?? []);
      setAssignments(data.assignments ?? []);
      setInstructions(data.instructions ?? []);
      setMyActorIds(data.my_actor_ids ?? []);
      setTeams(data.teams ?? []);
      setCues(data.cues ?? []);
      setActivePreview(data.preview ?? null);
      // Phase 2-I.3: 初回ロード時は現在時刻に最も近い session を自動選択
      if (!selectedSessionId && scopedSessions.length > 0) {
        const nearest = pickNearestSession(scopedSessions);
        setSelectedSessionId(nearest?.id ?? scopedSessions[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [oaId, selectedSessionId, canPreview, previewActorId, lockedWorkId]);

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

  // Phase 2-I.3: 参加者をチームでグループ化 (= 担当優先順を保持)
  const participantsByTeam = useMemo(() => {
    const grouped = new Map<string, LiveParticipant[]>();
    for (const p of orderedParticipants) {
      const key = p.team_id ?? "__none__";
      const list = grouped.get(key) ?? [];
      list.push(p);
      grouped.set(key, list);
    }
    return grouped;
  }, [orderedParticipants]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

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

  // Phase 2-I: participant の currentPhase に合う cue を抽出
  // - is_active 必須
  // - actor_id が null (= 全 actor 向け) or myActorIds に含まれる
  // - phase_id が participant.currentPhaseId と一致
  // - priority desc, sort_order asc
  const PRIORITY_RANK_C: Record<LiveCue["priority"], number> = { high: 0, normal: 1, low: 2 };
  const cuesByParticipantId = useMemo(() => {
    const map = new Map<string, LiveCue[]>();
    for (const p of participants) {
      if (!p.current_phase_id) continue;
      const matched = cues
        .filter((c) => {
          if (!c.is_active) return false;
          if (c.phase_id !== p.current_phase_id) return false;
          if (c.actor_id === null) return true;
          if (linkedToMe && myActorIds.includes(c.actor_id)) return true;
          if (!linkedToMe) return true; // 未紐付け Actor は全 actor 向けを見せる
          return false;
        })
        .sort((a, b) => {
          const r = PRIORITY_RANK_C[a.priority] - PRIORITY_RANK_C[b.priority];
          if (r !== 0) return r;
          return a.sort_order - b.sort_order;
        });
      if (matched.length > 0) map.set(p.id, matched);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, cues, myActorIds, linkedToMe]);

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

      {/* Phase 2-K: workId 固定モード (= 作品リスト導線から入った場合) */}
      {lockedWorkId && (
        <div
          style={{
            background: "#eef2ff",
            border: "1px solid #6366f1",
            borderRadius: 10,
            padding: "8px 12px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 12,
            color: "#3730a3",
          }}
        >
          <span style={{ fontWeight: 700 }}>対象作品:</span>
          <span>
            {sessions.find((s) => s.work_id === lockedWorkId)?.work_title ?? "(作品名取得中…)"}
          </span>
          <span style={{ flex: 1 }} />
          <Link href={`/oas/${oaId}/works`} style={{ fontSize: 11, color: "#3730a3", textDecoration: "underline" }}>
            ← 作品リストへ戻る
          </Link>
        </div>
      )}

      {/* Phase 2-J: 表示確認モード (= Owner/Admin だけ表示) */}
      {canPreview && (
        <div
          style={{
            background: activePreview ? "#fef3c7" : "#f9fafb",
            border: activePreview ? "2px solid #f59e0b" : "1px solid #e5e7eb",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: activePreview ? "#92400e" : "#374151" }}>
            🔍 表示確認モード
          </span>
          <select
            value={previewActorId}
            onChange={(e) => setPreviewActorId(e.target.value)}
            style={{ ...inputStyle, maxWidth: 240, padding: "4px 8px", fontSize: 12 }}
          >
            <option value="">(自分として表示)</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
                {a.character_name ? ` / ${a.character_name}` : ""}
              </option>
            ))}
          </select>
          {activePreview && (
            <>
              <span style={{ fontSize: 11, color: "#92400e" }}>
                → 「{activePreview.actor_display_name}」として表示中
              </span>
              <button onClick={() => setPreviewActorId("")} style={buttonSecondary}>
                解除
              </button>
            </>
          )}
        </div>
      )}

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
          <>
            {/* Phase 2-I.3: 月 / 午前午後 フィルタ */}
            {(() => {
              const months = Array.from(new Set(
                sessions.map((s) => sessionYearMonth(s)).filter((m): m is string => m !== null),
              )).sort();
              return (
                <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11, color: "#6b7280" }}>
                  <label>
                    月:&nbsp;
                    <select
                      value={sessionFilterMonth}
                      onChange={(e) => setSessionFilterMonth(e.target.value)}
                      style={{ ...inputStyle, maxWidth: 140, padding: "4px 8px" }}
                    >
                      <option value="">すべて</option>
                      {months.map((m) => {
                        const [y, mm] = m.split("-");
                        return <option key={m} value={m}>{`${y}年${Number(mm)}月`}</option>;
                      })}
                    </select>
                  </label>
                  <label>
                    時間帯:&nbsp;
                    <select
                      value={sessionFilterAmPm}
                      onChange={(e) => setSessionFilterAmPm(e.target.value as "" | "am" | "pm")}
                      style={{ ...inputStyle, maxWidth: 100, padding: "4px 8px" }}
                    >
                      <option value="">すべて</option>
                      <option value="am">午前</option>
                      <option value="pm">午後</option>
                    </select>
                  </label>
                </div>
              );
            })()}
            {/* Phase 2-I.3: 現在選択中の session を prominent 表示 */}
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
                .filter((s) => {
                  if (sessionFilterMonth && sessionYearMonth(s) !== sessionFilterMonth) return false;
                  if (sessionFilterAmPm && sessionAmPm(s) !== sessionFilterAmPm) return false;
                  return true;
                })
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
                      </button>
                    </li>
                  );
                })}
            </ul>
          </>
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
            // Phase 2-I.3: チーム → 参加者の二段アコーディオン
            <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
              {Array.from(participantsByTeam.entries()).map(([teamKey, list]) => {
                const team = teamKey === "__none__" ? null : teams.find((t) => t.id === teamKey) ?? null;
                const teamLabel = team?.name ?? "(チーム未割当)";
                const isTeamCollapsed = collapsedTeams[teamKey] ?? false;
                return (
                  <div
                    key={teamKey}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "8px 10px",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedTeams((s) => ({ ...s, [teamKey]: !isTeamCollapsed }))
                      }
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#111827",
                      }}
                    >
                      <span style={{ width: 12, color: "#6b7280" }}>{isTeamCollapsed ? "▶" : "▼"}</span>
                      <span>{teamLabel}</span>
                      <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}>
                        ({list.length})
                      </span>
                    </button>
                    {!isTeamCollapsed && (
                      <div style={{ display: "grid", gap: 10 }}>
                        {list.map((p) => {
                          const isPCollapsed = collapsedParticipants[p.id] ?? false;
                          return (
                            <div key={p.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedParticipants((s) => ({ ...s, [p.id]: !isPCollapsed }))
                                }
                                style={{
                                  all: "unset",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 12,
                                  color: "#374151",
                                  marginBottom: 4,
                                }}
                              >
                                <span style={{ width: 10, color: "#9ca3af" }}>
                                  {isPCollapsed ? "▶" : "▼"}
                                </span>
                                <span style={{ fontWeight: 600 }}>{p.display_name ?? "(無名)"}</span>
                                <span style={{ fontSize: 10, color: "#9ca3af" }}>
                                  {PARTICIPANT_STATUS_LABEL[p.status]}
                                </span>
                                {assignedParticipantIds.has(p.id) && (
                                  <span
                                    style={{
                                      fontSize: 9, fontWeight: 700,
                                      background: "#fef3c7", color: "#92400e",
                                      padding: "1px 6px", borderRadius: 999,
                                    }}
                                  >
                                    担当
                                  </span>
                                )}
                              </button>
                              {!isPCollapsed && (
                                <ParticipantCard
                                  participant={p}
                                  events={events}
                                  participantInstructions={instructionsByPid.get(p.id) ?? []}
                                  participantCues={cuesByParticipantId.get(p.id) ?? []}
                                  isAssignedToMe={assignedParticipantIds.has(p.id)}
                                  teamName={team?.name ?? null}
                                  oaId={oaId}
                                  sessionId={selectedSessionId}
                                  onMutated={() => void fetchAll()}
                                  onError={(msg) => setError(msg)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 台本 (Phase 2-I.3: scripts は廃止、cues のみ表示) ── */}
          <ScriptsSection
            cues={cues}
            myActorIds={myActorIds}
            linkedToMe={linkedToMe}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScriptsSection — 台本 (Phase 2-I.3)
//   - 旧 ScriptsCuesSection から LiveScript を削除し、LiveCue (= 台本項目) のみ表示
//   - 自分担当 (= actor_id が myActorIds) + actor_id=null (= 共通) のみ
//     priority high → normal → low の順
// ─────────────────────────────────────────────────────────────────────────────
function ScriptsSection({
  cues,
  myActorIds,
  linkedToMe,
}: {
  cues: LiveCue[];
  myActorIds: string[];
  linkedToMe: boolean;
}) {
  const visibleCues = cues.filter((c) => {
    if (!c.is_active) return false;
    if (c.actor_id === null) return true;
    if (linkedToMe && myActorIds.includes(c.actor_id)) return true;
    if (!linkedToMe) return true;
    return false;
  });

  if (visibleCues.length === 0) {
    return (
      <section style={{ ...card, background: "#f0f9ff", borderColor: "#bae6fd" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px", color: "#0369a1" }}>台本</h2>
        <p style={{ fontSize: 12, color: "#0369a1", margin: 0, lineHeight: 1.8 }}>
          🐋 台本項目はまだ登録されていません。Admin Console で登録してください。
        </p>
      </section>
    );
  }

  return (
    <section style={{ ...card, background: "#f0f9ff", borderColor: "#bae6fd" }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "#0369a1" }}>
        台本 ({visibleCues.length} / 優先度高い順)
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {visibleCues.map((c) => (
          <li
            key={c.id}
            style={{
              background: "#ffffff",
              border: "1px solid #bae6fd",
              borderLeft: c.priority === "high" ? "3px solid #dc2626" : "3px solid transparent",
              borderRadius: 6,
              padding: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{
                padding: "0 6px", borderRadius: 999, fontSize: 9, fontWeight: 700,
                background: c.priority === "high" ? "#fee2e2" : c.priority === "low" ? "#f3f4f6" : "#fef3c7",
                color:      c.priority === "high" ? "#991b1b" : c.priority === "low" ? "#6b7280" : "#92400e",
              }}>
                {CUE_PRIORITY_LABEL[c.priority]}
              </span>
              <strong style={{ fontSize: 12, color: "#111827" }}>{c.title}</strong>
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#374151", whiteSpace: "pre-wrap" }}>{c.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
