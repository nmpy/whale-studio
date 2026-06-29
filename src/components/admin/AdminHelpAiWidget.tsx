"use client";

// src/components/admin/AdminHelpAiWidget.tsx
// 管理画面ヘルプAI（MVP）ウィジェット。/oas 配下に右下固定で表示する独立コンポーネント。
//
// 設計（既存操作に干渉しない）:
//   - 状態は本コンポーネント内の useState のみ（既存 form/state と完全分離）。
//   - position: fixed・z-index 900（既存モーダル ~1000 / トースト 9999 より下＝それらが上に出る）。
//   - 入力は <form> を作らず、Enter は preventDefault + stopPropagation（背後フォームを submit させない）。
//   - パネル内の click / keydown は stopPropagation して背後画面へ伝播させない。
//   - 送信は POST /api/admin/help-ai の fetch のみ。保存/削除/公開/LINE送信/DB更新は一切呼ばない。
//   - AI 障害（未設定/タイムアウト/エラー）でも widget 内で完結し、管理画面本体に影響しない。
//   - AI 回答は dangerouslySetInnerHTML を使わず、プレーンテキストとして安全に描画。

import { useState, useRef, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { ADMIN_HELP_QUESTION_MAX } from "@/lib/admin-help/types";

type ChatMessage = { role: "user" | "assistant"; text: string };

const SUGGESTED = [
  "クイックリプライとは？",
  "問題にヒントを出したい",
  "画像タップでフェーズ遷移したい",
  "LIFFページを公開したい",
  "メッセージが5通以上あるとどうなる？",
];

const ERROR_TEXT = "回答を生成できませんでした。少し時間をおいて再度お試しください。";

// AI 回答を安全に描画（HTML 注入なし・箇条書きと改行だけ整える）。
function renderAnswer(text: string) {
  const lines = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${key}`} style={{ margin: "0 0 6px", paddingLeft: 18 }}>
          {bullets.map((b, i) => <li key={i} style={{ marginBottom: 2 }}>{b}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*[-・*]\s+(.*)$/);
    if (m) { bullets.push(m[1]); return; }
    flush(String(i));
    const t = ln.trim();
    if (t) out.push(<p key={i} style={{ margin: "0 0 6px" }}>{t}</p>);
  });
  flush("end");
  return out;
}

export function AdminHelpAiWidget() {
  const [open,     setOpen]     = useState(false);
  const [input,    setInput]    = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/help-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          question,
          // 内部ID・本文は送らない。画面情報は pathname / タイトルのみ。
          pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
          pageTitle: typeof document !== "undefined" ? document.title : undefined,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = (await res.json()) as { data?: { answer?: string } };
      const answer = j?.data?.answer;
      if (!answer) throw new Error("empty");
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
    } catch {
      setError(ERROR_TEXT);
    } finally {
      setLoading(false);
    }
  }

  // パネル内のイベントを背後画面に伝播させない。
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      // ルートは fixed。クリック/キーは内部で止める。
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 900 }}
      onClick={stop}
      onKeyDown={stop}
    >
      {open && (
        <div
          style={{
            width: "min(360px, calc(100vw - 32px))",
            height: "min(520px, calc(100vh - 120px))",
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            marginBottom: 10,
          }}
        >
          {/* ヘッダー */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #f0f0f0", background: "#f7faf9" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>AIヘルプ（操作サポート）</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="閉じる"
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#999", lineHeight: 1, padding: 4 }}>×</button>
          </div>

          {/* 本文 */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
            {messages.length === 0 && (
              <div>
                <p style={{ fontSize: 12.5, color: "#444", lineHeight: 1.7, margin: "0 0 10px" }}>
                  Whale Studio の操作で迷ったことを質問できます。
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SUGGESTED.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={loading}
                      style={{ fontSize: 11.5, color: "#2F6F5E", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: "4px 10px", cursor: loading ? "default" : "pointer" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "85%", fontSize: 12.5, lineHeight: 1.7,
                  padding: "8px 11px", borderRadius: 10,
                  background: m.role === "user" ? "#2F6F5E" : "#f3f4f6",
                  color: m.role === "user" ? "#fff" : "#1a1a1a",
                  whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
                  wordBreak: "break-word",
                }}>
                  {m.role === "user" ? m.text : renderAnswer(m.text)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ fontSize: 12, color: "#999", padding: "4px 2px" }}>回答を生成しています…</div>
            )}
            {error && (
              <div style={{ fontSize: 12, color: "#b91c1c", padding: "6px 0" }}>{error}</div>
            )}

            {messages.some((m) => m.role === "assistant") && (
              <p style={{ fontSize: 10.5, color: "#9ca3af", lineHeight: 1.6, marginTop: 8 }}>
                AIの回答は補助情報です。重要な設定は画面上の内容を確認してください。
              </p>
            )}
          </div>

          {/* 入力（form を作らず、Enter は preventDefault + stopPropagation） */}
          <div style={{ borderTop: "1px solid #f0f0f0", padding: 10, display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, ADMIN_HELP_QUESTION_MAX))}
              onKeyDown={(e) => {
                e.stopPropagation(); // 背後のショートカット/フォームへ伝播させない
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder="操作の質問を入力（Enterで送信 / Shift+Enterで改行）"
              disabled={loading}
              style={{ flex: 1, resize: "none", fontSize: 12.5, fontFamily: "inherit", padding: "8px 10px", border: "1px solid #e5e5e5", borderRadius: 8, lineHeight: 1.5 }}
            />
            <button type="button" onClick={() => send(input)} disabled={loading || !input.trim()}
              style={{ background: loading || !input.trim() ? "#9ca3af" : "#2F6F5E", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: loading || !input.trim() ? "default" : "pointer", whiteSpace: "nowrap" }}>
              送信
            </button>
          </div>
        </div>
      )}

      {/* 起動ボタン（右下固定） */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          marginLeft: "auto", display: "block",
          background: "#2F6F5E", color: "#fff", border: "none",
          borderRadius: 24, padding: "10px 16px", fontSize: 13, fontWeight: 700,
          boxShadow: "0 4px 14px rgba(0,0,0,0.20)", cursor: "pointer",
        }}
      >
        {open ? "閉じる" : "💬 AIに質問"}
      </button>
    </div>
  );
}
