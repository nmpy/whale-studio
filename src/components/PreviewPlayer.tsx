// src/components/PreviewPlayer.tsx
// 演出プレビュー再生コントローラー
//
// resolveMessageTimingConfig と同等のロジックをフロント内で再現し、
// ChatPreview に状態を渡して擬似 LINE トークを時系列再生する。
// 実際の LINE API は呼ばない。

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPreview, type ChatBubble, type ChatBubbleType, type ChatPreviewState, type ChatQuickReply } from "./ChatPreview";
import type { MessageTimingConfig } from "@/types";

/** chain prop で渡す 1 通分のプレビューデータ。
 *  実送信処理 (= buildPhaseMessages) は触らず、フロント側でチェーン表示を組むためだけに使う。 */
export interface PreviewChainItem {
  /** 安定した key。 */
  key:           string;
  /** 表示種別。"text" 以外は media 系として描画する。 */
  bubbleType:    ChatBubbleType;
  /** 本文 (= text 用 / 画像/動画の alt 兼用)。 */
  text:          string;
  /** 画像/動画の URL。 */
  mediaUrl?:     string;
  /** カルーセル枚数 (= bubbleType="carousel" 用 placeholder)。 */
  carouselCount?: number;
  /** このメッセージに付いている QuickReply。chain 全体で末尾 1 件にのみ表示される
   *  (= moveQuickReplyToTail と同じ姿勢で PreviewPlayer 側が tail に集約)。 */
  quickReplies?: ChatQuickReply[];
}

// ────────────────────────────────────────────────
// フロント用 resolve（サーバー側の line-read-receipt.ts と同等）
// ────────────────────────────────────────────────

/** 環境変数デフォルト（フロント側はハードコード）*/
const ENV_DEFAULTS = {
  readReceiptMode:    "delayed" as "immediate" | "delayed" | "before_reply",
  readDelayMs:        2000,
  typingEnabled:      false,
  typingMinMs:        300,
  typingMaxMs:        1200,
  loadingEnabled:     true,
  loadingThresholdMs: 3000,
  loadingMinSeconds:  5,
  loadingMaxSeconds:  15,
};

type Resolved = typeof ENV_DEFAULTS;

function resolve(
  msgConfig: MessageTimingConfig | null | undefined,
  workConfig: MessageTimingConfig | null | undefined,
): Resolved {
  const msgMode  = msgConfig?.read_receipt_mode;
  const workMode = workConfig?.read_receipt_mode;
  let readReceiptMode: Resolved["readReceiptMode"];
  if (msgMode && msgMode !== "inherit") {
    readReceiptMode = msgMode as Resolved["readReceiptMode"];
  } else if (workMode && workMode !== "inherit") {
    readReceiptMode = workMode as Resolved["readReceiptMode"];
  } else {
    readReceiptMode = ENV_DEFAULTS.readReceiptMode;
  }

  return {
    readReceiptMode,
    readDelayMs:        msgConfig?.read_delay_ms        ?? workConfig?.read_delay_ms        ?? ENV_DEFAULTS.readDelayMs,
    typingEnabled:      msgConfig?.typing_enabled       ?? workConfig?.typing_enabled       ?? ENV_DEFAULTS.typingEnabled,
    typingMinMs:        msgConfig?.typing_min_ms        ?? workConfig?.typing_min_ms        ?? ENV_DEFAULTS.typingMinMs,
    typingMaxMs:        msgConfig?.typing_max_ms        ?? workConfig?.typing_max_ms        ?? ENV_DEFAULTS.typingMaxMs,
    loadingEnabled:     msgConfig?.loading_enabled      ?? workConfig?.loading_enabled      ?? ENV_DEFAULTS.loadingEnabled,
    loadingThresholdMs: msgConfig?.loading_threshold_ms ?? workConfig?.loading_threshold_ms ?? ENV_DEFAULTS.loadingThresholdMs,
    loadingMinSeconds:  msgConfig?.loading_min_seconds  ?? workConfig?.loading_min_seconds  ?? ENV_DEFAULTS.loadingMinSeconds,
    loadingMaxSeconds:  msgConfig?.loading_max_seconds  ?? workConfig?.loading_max_seconds  ?? ENV_DEFAULTS.loadingMaxSeconds,
  };
}

// ────────────────────────────────────────────────
// 再生ステート
// ────────────────────────────────────────────────

type Phase =
  | "idle"
  | "user_sent"
  | "waiting_read"
  | "read_shown"
  | "typing"
  | "loading"
  | "replied"
  | "finished";

// ────────────────────────────────────────────────
// コンポーネント
// ────────────────────────────────────────────────

export function PreviewPlayer({
  msgConfig,
  workConfig,
  botReply = "了解しました！",
  userMessage = "テスト送信",
  chain,
}: {
  /** メッセージ単位の演出設定（フォーム値から変換して渡す） */
  msgConfig?: MessageTimingConfig | null;
  /** 作品単位の演出設定 */
  workConfig?: MessageTimingConfig | null;
  /** Bot の返信テキスト (= chain 未指定時の fallback)。 */
  botReply?: string;
  /** ユーザー側の送信テキスト */
  userMessage?: string;
  /** 1 登録分のメッセージ群 (= chain head → tail)。指定があれば botReply は無視され、
   *  チェーンを順番に描画する。末尾の bubble の下に QR を集約表示する。 */
  chain?: PreviewChainItem[];
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [chatState, setChatState] = useState<ChatPreviewState>({
    bubbles: [],
    showTyping: false,
    showLoading: false,
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  // unmount 時にクリア
  useEffect(() => () => clearTimers(), [clearTimers]);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  }, []);

  // ── リセット ──
  const reset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setChatState({ bubbles: [], showTyping: false, showLoading: false });
  }, [clearTimers]);

  // ── 停止（現在の状態を維持） ──
  const stop = useCallback(() => {
    clearTimers();
    // phase はそのまま保持
  }, [clearTimers]);

  // ── 再生 ──
  const play = useCallback(() => {
    clearTimers();
    const cfg = resolve(msgConfig, workConfig);

    // DEBUG (PR #182 review, merge 前削除): PreviewPlayer 側に届いた chain を確認する。
    // chain が undefined / 空 だと従来の単発 botReply にフォールバックされている。
    console.log("[PreviewPlayer DEBUG] play()", {
      chainLength: chain?.length ?? 0,
      chainItems:  chain?.map((c) => ({ key: c.key, type: c.bubbleType, bodyLen: c.text.length, qrCount: c.quickReplies?.length ?? 0 })) ?? null,
      botReplyFallbackUsed: !chain || chain.length === 0,
    });

    const userBubble: ChatBubble = { id: "u1", from: "user", text: userMessage };

    // chain 指定があれば複数 bot bubble を順に流す。chain が空 (= 既存呼び出し) なら従来の単発 botReply。
    // QR は各 chain item に紐づくものをそのまま、その bubble の直下に描画する
    // (= 実機 LINE と同じ「QR は付属メッセージの下」挙動)。
    const chainBubbles: ChatBubble[] = (chain && chain.length > 0)
      ? chain.map((c, i) => ({
          id:            `b${i + 1}`,
          from:          "bot" as const,
          text:          c.text,
          bubbleType:    c.bubbleType,
          mediaUrl:      c.mediaUrl,
          carouselCount: c.carouselCount,
          quickReplies:  c.quickReplies,
        }))
      : [{ id: "b1", from: "bot", text: botReply }];

    // 経過時間を積み上げてシーケンスを組み立てる
    let t = 0;

    // 1. ユーザー送信
    setChatState({ bubbles: [{ ...userBubble, read: false }], showTyping: false, showLoading: false });
    setPhase("user_sent");
    t += 400; // 送信後の短い間

    // 2. 既読
    const readDelay = cfg.readReceiptMode === "immediate" ? 200
      : cfg.readReceiptMode === "before_reply" ? 0 // 返信直前に表示
      : cfg.readDelayMs;

    let readShownTime = t;
    if (cfg.readReceiptMode !== "before_reply") {
      schedule(() => {
        setChatState((s) => ({
          ...s,
          bubbles: s.bubbles.map((b) => b.id === "u1" ? { ...b, read: true } : b),
        }));
        setPhase("read_shown");
      }, t + readDelay);
      readShownTime = t + readDelay;
      t = readShownTime + 200; // 既読表示後の短い間
    } else {
      setPhase("waiting_read");
    }

    // 3. typing
    let typingEnd = t;
    if (cfg.typingEnabled) {
      const typingMs = cfg.typingMinMs + Math.random() * (cfg.typingMaxMs - cfg.typingMinMs);
      schedule(() => {
        setChatState((s) => ({ ...s, showTyping: true }));
        setPhase("typing");
      }, t);
      typingEnd = t + typingMs;
      schedule(() => {
        setChatState((s) => ({ ...s, showTyping: false }));
      }, typingEnd);
      t = typingEnd;
    }

    // 4. loading（threshold 超過をシミュレート）
    // プレビューでは「この設定なら loading が出るか」を視覚的に示す
    const totalElapsed = t; // ここまでの経過
    if (cfg.loadingEnabled && totalElapsed >= cfg.loadingThresholdMs) {
      const loadingSec = Math.max(
        cfg.loadingMinSeconds,
        Math.min(cfg.loadingMaxSeconds, Math.ceil((totalElapsed * 1.5) / 1000)),
      );
      // loading は短く表示して bot 返信で消す（実際の挙動を再現）
      const loadingShowMs = Math.min(loadingSec * 1000, 2500); // プレビューでは最大 2.5s
      schedule(() => {
        setChatState((s) => ({ ...s, showLoading: true }));
        setPhase("loading");
      }, t);
      t += loadingShowMs;
      schedule(() => {
        setChatState((s) => ({ ...s, showLoading: false }));
      }, t);
    }

    // 5. before_reply の場合、返信直前に既読
    if (cfg.readReceiptMode === "before_reply") {
      schedule(() => {
        setChatState((s) => ({
          ...s,
          bubbles: s.bubbles.map((b) => b.id === "u1" ? { ...b, read: true } : b),
        }));
      }, t);
      t += 100;
    }

    // 6. Bot 返信 (chain なら順番に積む)
    chainBubbles.forEach((bb, i) => {
      schedule(() => {
        setChatState((s) => ({
          ...s,
          bubbles: [...s.bubbles, bb],
          showTyping: false,
          showLoading: false,
        }));
        if (i === chainBubbles.length - 1) setPhase("replied");
      }, t);
      // 後続 bubble は短い間隔で続けて描画する (= 実送信時の chain と同様、
      // 演出 timing は 1 回まとめて表示する想定)。最終 bubble は遅延なし。
      if (i < chainBubbles.length - 1) t += 350;
    });

    // 7. finished
    schedule(() => {
      setPhase("finished");
    }, t + 500);
  }, [msgConfig, workConfig, botReply, userMessage, chain, clearTimers, schedule]);

  const isPlaying = phase !== "idle" && phase !== "finished";

  // ── 設定サマリ ──
  const cfg = resolve(msgConfig, workConfig);

  return (
    <div style={{ marginTop: 12 }}>
      {/* 操作ボタン */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: "4px 12px" }}
          onClick={play}
          disabled={isPlaying}
        >
          &#9654; 再生
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: "4px 12px" }}
          onClick={stop}
          disabled={!isPlaying}
        >
          &#9208; 停止
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: "4px 12px" }}
          onClick={reset}
        >
          &#8635; リセット
        </button>
        <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center", marginLeft: 4 }}>
          {phase === "idle" ? "" : phase === "finished" ? "完了" : phase.replace("_", " ")}
        </span>
      </div>

      {/* チャット表示 */}
      <ChatPreview state={chatState} />

      {/* 設定サマリ */}
      <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af", lineHeight: 1.6 }}>
        既読: {cfg.readReceiptMode}{cfg.readReceiptMode === "delayed" ? ` (${cfg.readDelayMs}ms)` : ""}
        {" / "}typing: {cfg.typingEnabled ? `${cfg.typingMinMs}-${cfg.typingMaxMs}ms` : "OFF"}
        {" / "}loading: {cfg.loadingEnabled ? `閾値${cfg.loadingThresholdMs}ms ${cfg.loadingMinSeconds}-${cfg.loadingMaxSeconds}s` : "OFF"}
      </div>
    </div>
  );
}
