"use client";

// src/app/oas/[id]/live/actor/LiveActorClient.tsx
// Whale Studio Live for Actor — Phase 2-B 最小UI。
//
// 表示:
//   - セッション一覧 (= 選択式)
//   - 参加者一覧 (= 演者が状態把握する対象)
//   - 直近のイベントログ (= actor_contacted / alert / note_added を含む)
//   - 演者用イベント追加フォーム (= 対象 participant 選択 + event_type + note)
//
// リアルタイム更新は未実装。各セクションに「再読込」ボタン。

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type LiveSession,
  type LiveParticipant,
  type LiveEventLog,
  SESSION_STATUS_LABEL,
  PARTICIPANT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  ACTOR_EVENT_TYPES,
  formatDateTime,
  buttonPrimary,
  buttonSecondary,
  inputStyle,
  card,
  errorBox,
} from "../_shared";

type ActorEventType = typeof ACTOR_EVENT_TYPES[number];

export function LiveActorClient({ oaId }: { oaId: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
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

  // ── イベント追加 ──
  const [newParticipantId, setNewParticipantId] = useState<string>("");
  const [newType, setNewType] = useState<ActorEventType>("actor_contacted");
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = !!selectedSessionId && newTitle.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/actor/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          session_id:     selectedSessionId,
          type:           newType,
          title:          newTitle.trim(),
          detail:         newDetail.trim() || null,
          participant_id: newParticipantId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `送信に失敗しました (HTTP ${res.status})`);
      }
      setNewTitle("");
      setNewDetail("");
      setNewParticipantId("");
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
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
        Whale Studio Live for Actor
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
        Phase 2-B: 演者向け。対象プレイヤーへの接触・メモ・アラートを記録できます。リアルタイム更新は未実装のため、各セクションの「再読込」ボタンで更新してください。
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {/* ── セッション ── */}
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
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>
              参加者
            </h2>
            {participants.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6b7280" }}>参加者がまだ登録されていません。</p>
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
                      <td style={{ padding: "8px 6px", color: "#374151" }}>
                        {PARTICIPANT_STATUS_LABEL[p.status]}
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

          {/* ── イベント追加 (= 演者用) ── */}
          <section style={{ ...card, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>
              演者用イベント追加
            </h2>
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "200px 200px 1fr auto" }}>
                <select
                  value={newParticipantId}
                  onChange={(e) => setNewParticipantId(e.target.value)}
                  style={inputStyle}
                  disabled={submitting}
                >
                  <option value="">— 参加者未指定 —</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name ?? "(匿名)"}
                    </option>
                  ))}
                </select>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ActorEventType)}
                  style={inputStyle}
                  disabled={submitting}
                >
                  {ACTOR_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{EVENT_TYPE_LABEL[t] ?? t}</option>
                  ))}
                </select>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="タイトル (例: ヒント1を口頭で渡した / 動線で詰まり中)"
                  style={inputStyle}
                  disabled={submitting}
                />
                <button type="submit" style={buttonPrimary} disabled={!canSubmit}>
                  {submitting ? "送信中…" : "送信"}
                </button>
              </div>
              <textarea
                value={newDetail}
                onChange={(e) => setNewDetail(e.target.value)}
                placeholder="詳細 (任意 / メモ・状況補足など)"
                style={{ ...inputStyle, minHeight: 60 }}
                disabled={submitting}
              />
            </form>
          </section>

          {/* ── イベントログ ── */}
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>
                直近のイベント
              </h2>
              <button onClick={() => void fetchAll()} style={buttonSecondary} disabled={loading}>
                {loading ? "読込中…" : "再読込"}
              </button>
            </div>

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
                        {EVENT_TYPE_LABEL[e.type] ?? e.type}
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
