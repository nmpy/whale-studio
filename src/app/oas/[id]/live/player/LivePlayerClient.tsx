"use client";

// src/app/oas/[id]/live/player/LivePlayerClient.tsx
// Whale Studio Live for Player — Phase 2-B 最小UI。
//
// 表示:
//   - セッション一覧 (= 選択式)
//   - 自分の参加者情報 (= 同 OA の participant 一覧。Phase 2-B では auth user との紐付けは未実装)
//   - イベントログ一覧 (= 直近)
//   - 最小のイベント追加フォーム (= QR / checkin / 謎正解 / メッセージ送信)
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
  PLAYER_EVENT_TYPES,
  formatDateTime,
  buttonPrimary,
  buttonSecondary,
  inputStyle,
  card,
  errorBox,
} from "../_shared";

type PlayerEventType = typeof PLAYER_EVENT_TYPES[number];

export function LivePlayerClient({ oaId }: { oaId: string }) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [events, setEvents] = useState<LiveEventLog[]>([]);
  const [me, setMe] = useState<LiveParticipant | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 一覧取得 ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : "";
      const res = await fetch(`/api/oas/${oaId}/live/player${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`取得に失敗しました (HTTP ${res.status})`);
      const json = await res.json();
      const data = json?.data ?? json;
      setSessions(data.sessions ?? []);
      setParticipants(data.participants ?? []);
      setEvents(data.events ?? []);
      setMe(data.me ?? null);
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
  const [newType, setNewType] = useState<PlayerEventType>("checked_in");
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 自分の participant が紐付いている場合のみイベント送信可 (= Phase 2-B.5 のなりすまし防止)。
  // 紐付けがなくても owner / admin / live_owner はサーバー側で参加可能だが、一般 Player UI
  // としては「自分の participant が紐付いていれば送信可」の挙動に揃える。
  const linkedMe = !!me;
  const canSubmit = !!selectedSessionId && newTitle.trim().length > 0 && !submitting && linkedMe;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/live/player/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          session_id: selectedSessionId,
          type:       newType,
          title:      newTitle.trim(),
          detail:     newDetail.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `送信に失敗しました (HTTP ${res.status})`);
      }
      setNewTitle("");
      setNewDetail("");
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "8px 0 40px" }}>
      <Link
        href={`/oas/${oaId}/live`}
        style={{ fontSize: 12, color: "#6b7280", textDecoration: "none" }}
      >
        ← Whale Studio Live
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 12, marginBottom: 8, color: "#111827" }}>
        Whale Studio Live for Player
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
        Phase 2-B: 進行イベント (QR / チェックイン / 謎正解 / メッセージ送信) を送信できます。リアルタイム更新は未実装のため、「再読込」ボタンで更新してください。
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {/* ── 自分の参加者情報 (Phase 2-B.5) ── */}
      <section
        style={{
          ...card,
          marginBottom: 16,
          borderColor: linkedMe ? "#10b981" : "#fcd34d",
          background:  linkedMe ? "#ecfdf5" : "#fffbeb",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          あなたの参加者情報
        </h2>
        {linkedMe ? (
          <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.8 }}>
            <div>
              <strong>表示名:</strong> {me?.display_name ?? "(匿名)"}
            </div>
            <div>
              <strong>状態:</strong> {me ? PARTICIPANT_STATUS_LABEL[me.status] : "—"}
            </div>
            <div>
              <strong>現在ステップ:</strong> {me?.current_step ?? "—"}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#92400e", lineHeight: 1.8 }}>
            <p style={{ margin: 0 }}>
              あなたのアカウントに参加者情報がまだ紐付いていません。
            </p>
            <p style={{ margin: "4px 0 0" }}>
              運営に依頼して、参加者として登録してもらってください(= email / auth_user_id の登録が必要です)。
              登録後はこのページを再読込してください。
            </p>
          </div>
        )}
      </section>

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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── 進行イベント送信 ── */}
          <section style={{ ...card, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>
              進行イベント送信
            </h2>
            {!linkedMe && (
              <div
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                参加者情報がまだ紐付いていないため、イベントは送信できません。運営に登録依頼後、再読込してください。
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "200px 1fr auto" }}>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as PlayerEventType)}
                  style={inputStyle}
                  disabled={submitting || !linkedMe}
                >
                  {PLAYER_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{EVENT_TYPE_LABEL[t] ?? t}</option>
                  ))}
                </select>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="タイトル (例: 第3ピース回収 / チェックイン完了)"
                  style={inputStyle}
                  disabled={submitting || !linkedMe}
                />
                <button type="submit" style={buttonPrimary} disabled={!canSubmit}>
                  {submitting ? "送信中…" : "送信"}
                </button>
              </div>
              <textarea
                value={newDetail}
                onChange={(e) => setNewDetail(e.target.value)}
                placeholder="詳細 (任意 / メモ・本文など)"
                style={{ ...inputStyle, minHeight: 60 }}
                disabled={submitting || !linkedMe}
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
