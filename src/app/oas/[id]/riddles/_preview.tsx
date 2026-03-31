"use client";

// src/app/oas/[id]/riddles/_preview.tsx
// 謎作成・編集フォームに埋め込む LINE 風プレビューパネル

import { useEffect, useRef, useState } from "react";
import type { FormState } from "./_form";
import type { Character, HintQuickReply } from "@/types";

// ── 内部型 ───────────────────────────────────────
interface PMsg {
  id:      string;
  text:    string;
  imgUrl?: string;
  char:    Character | null;  // null = システム（🤖）
  time:    string;
  isUser?: boolean;           // 右寄せのユーザー発言
}

type Phase = "idle" | "question" | "hinting" | "done";

function nowStr() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── Props ────────────────────────────────────────
interface RiddlePreviewProps {
  form:       FormState;
  characters: Character[];
}

// ── Main コンポーネント ──────────────────────────
export function RiddlePreview({ form, characters }: RiddlePreviewProps) {
  const [msgs,     setMsgs]     = useState<PMsg[]>([]);
  const [phase,    setPhase]    = useState<Phase>("idle");
  const [hintStep, setHintStep] = useState(0);
  const chatRef   = useRef<HTMLDivElement>(null);

  // チャットエリア内だけをスクロール（ページスクロールを起こさないよう scrollTop で制御）
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [msgs]);

  // フォーム内容が変わったらプレビューをリセット
  useEffect(() => {
    setMsgs([]);
    setPhase("idle");
    setHintStep(0);
  }, [
    form.question_type,
    form.question_text,
    form.question_image_url,
    form.question_video_url,
  ]);

  // ── ヘルパー ──────────────────────────────────
  function charById(id: string | null | undefined): Character | null {
    if (!id) return null;
    return characters.find((c) => c.id === id) ?? null;
  }

  function makeMsg(text: string, char: Character | null, imgUrl?: string): PMsg {
    return { id: `${Date.now()}-${Math.random()}`, text, imgUrl, char, time: nowStr() };
  }

  function makeUserMsg(text: string): PMsg {
    return { id: `${Date.now()}-${Math.random()}`, text, char: null, time: nowStr(), isUser: true };
  }

  function buildQuestionMsg(): PMsg {
    switch (form.question_type) {
      case "text":
        return makeMsg(form.question_text || "（問題文が未入力です）", null);
      case "image":
        return form.question_image_url
          ? makeMsg("", null, form.question_image_url)
          : makeMsg("🖼 （画像URLが未設定です）", null);
      case "video":
        return makeMsg(`🎬 ${form.question_video_url || "（動画URLが未設定です）"}`, null);
      case "carousel":
        return makeMsg(
          form.question_carousel.length > 0
            ? `🎠 カルーセル（${form.question_carousel.length}枚）\n${form.question_carousel.map((c, i) => `[${i + 1}] ${c.title || "（タイトル未入力）"}`).join("\n")}`
            : "🎠 （カードがありません）",
          null
        );
    }
  }

  // ── アクション ────────────────────────────────
  function handleStart() {
    setMsgs([buildQuestionMsg()]);
    setPhase("question");
    setHintStep(0);
  }

  function handleWrong() {
    setMsgs((prev) => [
      ...prev,
      makeUserMsg("（テスト: 不正解回答）"),
      makeMsg(form.wrong_message || "（不正解時メッセージが未入力です）", null),
    ]);
  }

  function handleCorrect() {
    setMsgs((prev) => [
      ...prev,
      makeUserMsg("（テスト: 正解回答）"),
      makeMsg(form.correct_message || "（正解時メッセージが未入力です）", null),
    ]);
    setPhase("done");
  }

  function handleHint() {
    if (form.hints.length === 0) return;
    const hint = form.hints[0];
    setPhase("hinting");
    setHintStep(0);
    setMsgs((prev) => [
      ...prev,
      makeUserMsg("ヒント"),
      makeMsg(hint.text || "（ヒントテキストが未入力です）", charById(hint.character_id)),
    ]);
  }

  function handleQR(qr: HintQuickReply) {
    switch (qr.action_type) {
      case "next_hint": {
        const next = hintStep + 1;
        if (next < form.hints.length) {
          const hint = form.hints[next];
          setHintStep(next);
          setMsgs((prev) => [
            ...prev,
            makeMsg(hint.text || "（ヒントテキストが未入力です）", charById(hint.character_id)),
          ]);
        } else {
          setMsgs((prev) => [
            ...prev,
            makeMsg("💡 ヒントはここまでです。もう少し考えてみてください！", null),
          ]);
        }
        break;
      }
      case "repeat_hint": {
        const hint = form.hints[hintStep];
        setMsgs((prev) => [
          ...prev,
          makeMsg(hint.text || "（ヒントテキストが未入力です）", charById(hint.character_id)),
        ]);
        break;
      }
      case "cancel_hint":
        setPhase("question");
        break;
      case "custom":
        setMsgs((prev) => [...prev, makeUserMsg(qr.action_value || qr.label)]);
        break;
    }
  }

  function handleReset() {
    setMsgs([]);
    setPhase("idle");
    setHintStep(0);
  }

  // ── 現在のヒント ──────────────────────────────
  const currentHint = phase === "hinting" ? (form.hints[hintStep] ?? null) : null;

  // ── レンダリング ──────────────────────────────
  return (
    <div style={{
      width: 320, background: "#fff", borderRadius: 14,
      border: "1px solid #d1d5db", overflow: "hidden",
      display: "flex", flexDirection: "column",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
    }}>
      {/* ── トークヘッダー（プレイグラウンドと同一デザイン） ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e9ecef",
        padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {form.title || "謎のプレビュー"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          {phase !== "idle" && (
            <button type="button" onClick={handleStart} style={headerBtnStyle2}>▶</button>
          )}
          {phase !== "idle" && (
            <button type="button" onClick={handleReset} style={headerBtnStyle2}>🔄</button>
          )}
        </div>
      </div>

      {/* ── チャットエリア ── */}
      <div ref={chatRef} style={{
        flex: 1,
        background: "#c4dde3",
        padding: "14px 12px 18px",
        overflowY: "auto",
        minHeight: 380,
        maxHeight: 500,
      }}>
        {msgs.length === 0 ? (
          <div style={{
            textAlign: "center", marginTop: 60,
            color: "rgba(0,0,0,0.3)", fontSize: 12,
          }}>
            {phase === "idle" ? "下の「謎を開始する」でプレビュー" : ""}
          </div>
        ) : (
          msgs.map((msg) => <PreviewBubble key={msg.id} msg={msg} />)
        )}
      </div>

      {/* ── アクションバー ── */}
      <div style={{ background: "#f9fafb", borderTop: "1px solid #e5e7eb" }}>
        {phase === "idle" && (
          <div style={{ padding: "10px 12px" }}>
            <button
              type="button"
              onClick={handleStart}
              style={{
                width: "100%", background: "#06C755", color: "#fff",
                border: "none", borderRadius: 22,
                padding: "10px 16px", fontSize: 13, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ▶ 謎を開始する
            </button>
          </div>
        )}

        {phase === "question" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px" }}>
            <ActionBtn label="✗ 不正解にする" color="#ef4444" onClick={handleWrong} />
            <ActionBtn label="✓ 正解にする"   color="#059669" onClick={handleCorrect} />
            {form.hints.length > 0 && (
              <ActionBtn label="💡 ヒント" color="#2563eb" onClick={handleHint} />
            )}
          </div>
        )}

        {phase === "hinting" && currentHint && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px" }}>
            {currentHint.quick_replies.length > 0 ? (
              currentHint.quick_replies.map((qr, i) => (
                <ActionBtn key={i} label={qr.label} color="#2563eb" onClick={() => handleQR(qr)} />
              ))
            ) : (
              <ActionBtn label="← 問題に戻る" color="#6b7280" onClick={() => setPhase("question")} />
            )}
          </div>
        )}

        {phase === "done" && (
          <div style={{ padding: "10px 12px", textAlign: "center" }}>
            <button
              type="button"
              onClick={handleReset}
              style={{
                background: "none", border: "1px solid #d1d5db", borderRadius: 20,
                padding: "6px 20px", fontSize: 12, cursor: "pointer", color: "#6b7280",
              }}
            >
              🔄 リセット
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ヘッダーボタン（白背景用） ────────────────────────────────
const headerBtnStyle2: React.CSSProperties = {
  background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280",
  fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
};

// ── アクションボタン ──────────────────────────────
function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "#fff", border: `1.5px solid ${color}`,
        borderRadius: 20, color, padding: "6px 12px",
        fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

// ── 吹き出し ─────────────────────────────────────
function PreviewBubble({ msg }: { msg: PMsg }) {
  // ユーザー発言（右寄せ・緑）
  if (msg.isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontSize: 10, color: "rgba(0,0,0,0.35)", whiteSpace: "nowrap" }}>{msg.time}</span>
          <div style={{
            background: "#06C755", borderRadius: "18px 18px 2px 18px",
            padding: "9px 14px", fontSize: 14, color: "#fff",
            maxWidth: 200, wordBreak: "break-word", whiteSpace: "pre-wrap",
          }}>
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  const char = msg.char;

  const iconEl = char ? (
    char.icon_image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={char.icon_image_url} alt={char.name}
        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
    ) : (
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: char.icon_color ?? "#06C755",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff",
      }}>
        {char.icon_type === "text" ? (char.icon_text ?? char.name[0]) : char.name[0]}
      </div>
    )
  ) : (
    <div style={{
      width: 36, height: 36, borderRadius: "50%", background: "#c9cdd4",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
    }}>📢</div>
  );

  return (
    <div style={{ display: "flex", gap: 7, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0 }}>{iconEl}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {char && (
          <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4, fontWeight: 400 }}>
            {char.name}
          </p>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          {/* しっぽ付き白吹き出し */}
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", left: -6, top: 10,
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: "5px 7px 5px 0",
              borderColor: "transparent #fff transparent transparent",
            }} />
            <div style={{
              background: "#fff", borderRadius: "4px 16px 16px 16px",
              padding: "8px 12px", fontSize: 14, color: "#111827",
              maxWidth: 220, wordBreak: "break-word", whiteSpace: "pre-wrap",
              boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
              lineHeight: 1.55,
            }}>
              {msg.imgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.imgUrl} alt="問題画像"
                  style={{ maxWidth: 190, borderRadius: 8, display: "block" }}
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = "none";
                    el.parentElement!.textContent = "🖼 （画像を読み込めませんでした）";
                  }} />
              ) : msg.text}
            </div>
          </div>
          <span style={{ fontSize: 10, color: "rgba(0,0,0,0.35)", whiteSpace: "nowrap", marginBottom: 3 }}>
            {msg.time}
          </span>
        </div>
      </div>
    </div>
  );
}
