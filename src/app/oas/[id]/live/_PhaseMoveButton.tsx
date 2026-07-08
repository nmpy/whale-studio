"use client";

// src/app/oas/[id]/live/_PhaseMoveButton.tsx
//
// スタッフによる実フェーズ移動（PR4-1）の共通 UI。ボタン → 確認モーダル → POST。
//   対象は lineUserId 紐づき済み LiveParticipant のみ（呼び出し側で disabled 制御）。
//   確認モーダルで「対象 / 現在フェーズ / 移動先フェーズ / メッセージ送信有無」を提示（事故防止）。

import { useState } from "react";
import { buttonPrimary, buttonSecondary, inputStyle } from "./_shared";

export type PhaseChoice = { id: string; name: string; phase_type?: string; sort_order?: number };

export function PhaseMoveButton({
  oaId,
  sessionId,
  participantId,
  participantLabel,
  currentPhaseName,
  phases,
  onDone,
  onError,
  disabled,
  disabledReason,
}: {
  oaId: string;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  currentPhaseName: string | null;
  phases: PhaseChoice[];
  onDone: () => void;
  onError: (msg: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [sendMessages, setSendMessages] = useState(true);
  const [busy, setBusy] = useState(false);

  const targetPhase = phases.find((p) => p.id === targetId) ?? null;

  const submit = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/oas/${oaId}/live/sessions/${sessionId}/participants/${participantId}/phase-move`,
        {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify({ target_phase_id: targetId, send_messages: sendMessages }),
        },
      );
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `フェーズ移動に失敗しました (HTTP ${res.status})`);
      setOpen(false);
      setTargetId("");
      setSendMessages(true);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "フェーズ移動に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : "プレイヤーのフェーズを移動し、移動先の冒頭メッセージを送ります"}
        style={{ ...buttonSecondary, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      >
        フェーズ移動
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
          }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 420,
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)", display: "grid", gap: 12,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>フェーズを移動しますか?</div>

            <div style={{ fontSize: 12, color: "#374151", display: "grid", gap: 6, background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
              <div>対象: <strong>{participantLabel}</strong></div>
              <div>現在フェーズ: <strong>{currentPhaseName ?? "—"}</strong></div>
              <div>移動先: <strong style={{ color: targetPhase ? "#065f46" : "#9ca3af" }}>{targetPhase?.name ?? "（未選択）"}</strong>
                {targetPhase?.phase_type === "ending" && <span style={{ marginLeft: 6, fontSize: 10, color: "#3730a3", background: "#e0e7ff", padding: "1px 6px", borderRadius: 999 }}>エンディング</span>}
              </div>
            </div>

            <label style={{ fontSize: 12, color: "#374151", display: "grid", gap: 4 }}>
              移動先フェーズを選択
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={inputStyle} disabled={busy}>
                <option value="">— 選択してください —</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.phase_type === "ending" ? "（エンディング）" : p.phase_type === "start" ? "（開始）" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={sendMessages} onChange={(e) => setSendMessages(e.target.checked)} disabled={busy} />
              移動先フェーズの冒頭メッセージを LINE 送信する（推奨）
            </label>
            {!sendMessages && (
              <p style={{ fontSize: 11, color: "#92400e", margin: 0 }}>
                ※ 送信しない場合、プレイヤーの LINE には何も届かず内部状態のみ移動します。
              </p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={() => setOpen(false)} style={buttonSecondary} disabled={busy}>
                キャンセル
              </button>
              <button type="button" onClick={() => void submit()} style={buttonPrimary} disabled={busy || !targetId}>
                {busy ? "移動中…" : "移動する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
