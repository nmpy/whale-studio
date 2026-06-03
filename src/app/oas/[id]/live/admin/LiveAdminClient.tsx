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
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

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

export function LiveAdminClient({ oaId }: { oaId: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(false);
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
      const [pr, er] = await Promise.all([
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/participants`, { credentials: "include" }),
        fetch(`/api/oas/${oaId}/live/sessions/${sessionId}/events`,       { credentials: "include" }),
      ]);
      if (!pr.ok) throw new Error(`参加者一覧の取得に失敗しました (HTTP ${pr.status})`);
      if (!er.ok) throw new Error(`イベント一覧の取得に失敗しました (HTTP ${er.status})`);
      const pj = await pr.json();
      const ej = await er.json();
      setParticipants(pj?.data?.participants ?? []);
      setEvents(ej?.data?.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoadingChildren(false);
    }
  }, [oaId]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      void fetchChildren(selectedSessionId);
    } else {
      setParticipants([]);
      setEvents([]);
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
                    <th style={{ padding: "8px 6px" }}>最終接触</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 6px", color: "#111827" }}>
                        {p.display_name ?? <span style={{ color: "#9ca3af" }}>(匿名)</span>}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <span style={{ fontSize: 11, color: "#374151" }}>
                          {PARTICIPANT_STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td style={{ padding: "8px 6px", color: "#374151" }}>{p.current_step ?? "—"}</td>
                      <td style={{ padding: "8px 6px", color: "#6b7280", fontSize: 12 }}>
                        {formatDateTime(p.last_seen_at)}
                      </td>
                    </tr>
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
    </div>
  );
}
