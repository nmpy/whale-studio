"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { oaApi, workApi, runtimeApi, getDevToken, type WorkListItem, type OaListItem, type RuntimeAdvanceResult } from "@/lib/api-client";
import type { RuntimeState, RuntimePhaseMessage, RuntimeTransition, PhaseType, QuickReplyItem, StartTrigger } from "@/types";

// ── 定数 ──────────────────────────────────────────
const PHASE_TYPE_META: Record<PhaseType, { label: string; color: string; bg: string }> = {
  start:   { label: "開始",       color: "#16a34a", bg: "#f0fdf4" },
  normal:  { label: "通常",       color: "#2563eb", bg: "#eff6ff" },
  ending:  { label: "エンディング", color: "#9333ea", bg: "#faf5ff" },
};

// ────────────────────────────────────────────────
// チャット履歴エントリ型
// ────────────────────────────────────────────────
type ChatEntry =
  | { kind: "bot";       msg: RuntimePhaseMessage; oaTitle: string }
  | { kind: "user";      text: string }
  | { kind: "phase-sep"; name: string; phaseType: PhaseType };

/**
 * 現在フェーズ内の時系列アイテム（ユーザー入力とボット応答を挿入順で保持）
 * extraMessages / sentMessages を統合した単一リスト。
 */
type CurrentChatItem =
  | { kind: "bot";  msg: RuntimePhaseMessage }
  | { kind: "user"; text: string };

/** 現在フェーズ + currentItems をログエントリに変換する */
function buildPhaseSnapshot(
  phase:        RuntimeState["phase"] & {},
  items:        CurrentChatItem[],
  oaTitle:      string,
): ChatEntry[] {
  return [
    { kind: "phase-sep", name: phase.name, phaseType: phase.phase_type },
    ...phase.messages.map((msg): ChatEntry => ({ kind: "bot", msg, oaTitle })),
    ...items.map((item): ChatEntry =>
      item.kind === "bot"
        ? { kind: "bot", msg: item.msg, oaTitle }
        : { kind: "user", text: item.text }
    ),
  ];
}

// ────────────────────────────────────────────────
// エントリポイント（Suspense ラッパー）
// ────────────────────────────────────────────────
export default function PlaygroundPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>読み込み中...</div>}>
      <PlaygroundInner />
    </Suspense>
  );
}

// ────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────
function PlaygroundInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  // ── セレクション ──
  const [oas, setOas]           = useState<OaListItem[]>([]);
  const [works, setWorks]       = useState<WorkListItem[]>([]);
  const [selectedOaId, setSelectedOaId]   = useState("");
  const [selectedWorkId, setSelectedWorkId] = useState(searchParams.get("work_id") ?? "");
  const [lineUserId, setLineUserId]         = useState(searchParams.get("user_id") ?? "test-user-01");
  const [oasLoading, setOasLoading]         = useState(true);
  const [worksLoading, setWorksLoading]     = useState(false);

  // ── ランタイム状態 ──
  const [state, setState]     = useState<RuntimeState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── 現在フェーズ内の時系列チャットアイテム（ユーザー入力 + ボット応答を挿入順で保持） ──
  const [currentItems, setCurrentItems] = useState<CurrentChatItem[]>([]);

  // ── フェーズをまたいで蓄積するチャット履歴 ──
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);

  // ── 操作ログ ──
  const [log, setLog] = useState<Array<{ type: "action" | "system" | "error"; text: string }>>([]);

  function addLog(type: "action" | "system" | "error", text: string) {
    setLog((prev) => [...prev, { type, text }].slice(-50)); // 最大 50 件
  }

  // ── OA 一覧ロード ─────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await oaApi.list(getDevToken());
        setOas(data);
        if (data.length > 0 && !selectedOaId) {
          setSelectedOaId(data[0].id);
        }
      } catch { /* silent */ } finally {
        setOasLoading(false);
      }
    })();
  }, []);

  // ── 作品リストロード（OA 選択時）────────────────
  useEffect(() => {
    if (!selectedOaId) return;
    setWorksLoading(true);
    setWorks([]);
    (async () => {
      try {
        const list = await workApi.list(getDevToken(), selectedOaId);
        setWorks(list.sort((a, b) => a.sort_order - b.sort_order));
        // URL の work_id に一致する作品があれば選択を維持
        if (selectedWorkId && !list.find((w) => w.id === selectedWorkId)) {
          setSelectedWorkId(list[0]?.id ?? "");
        } else if (!selectedWorkId && list.length > 0) {
          setSelectedWorkId(list[0].id);
        }
      } catch { /* silent */ } finally {
        setWorksLoading(false);
      }
    })();
  }, [selectedOaId]);

  // ── 進行状態ロード ────────────────────────────
  const loadProgress = useCallback(async (workId: string, userId: string) => {
    if (!workId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await runtimeApi.getProgress(getDevToken(), userId, workId);
      setState(s);
      setMessage(null);
      setCurrentItems([]);
      setChatLog([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "状態の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── アクション: シナリオ開始 ──────────────────
  async function handleStart() {
    if (!selectedWorkId || !lineUserId.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setLog([]);
    try {
      const s = await runtimeApi.start(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
      });
      setState(s);
      setCurrentItems([]);
      setChatLog([]);
      addLog("system", `▶ シナリオ開始: 「${s.phase?.name ?? "（不明）"}」`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "開始に失敗しました";
      setError(msg);
      addLog("error", `エラー: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── アクション: 遷移選択 ──────────────────────
  async function handleAdvance(transition: RuntimeTransition) {
    if (!selectedWorkId || !lineUserId.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    addLog("action", `→ 選択: 「${transition.label}」`);
    // 現在フェーズをログに保存してから遷移（ユーザーの遷移選択も吹き出し追加）
    const snapOaTitle = oas.find((o) => o.id === selectedOaId)?.title ?? "";
    const snapState   = state;
    // ユーザーが選んだ遷移ラベルを currentItems に付加したスナップショット用リスト
    const snapItems: CurrentChatItem[] = [...currentItems, { kind: "user", text: transition.label }];
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id:   lineUserId.trim(),
        work_id:        selectedWorkId,
        transition_id:  transition.id,
      });
      if (snapState?.phase) {
        setChatLog((prev) => [
          ...prev,
          ...buildPhaseSnapshot(snapState.phase!, snapItems, snapOaTitle),
        ]);
      }
      setState(result);
      setCurrentItems([]);
      if (result._message) {
        setMessage(result._message);
        addLog("system", result._message);
      }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
      if (transition.set_flags && transition.set_flags !== "{}") {
        addLog("system", `🎌 フラグ更新: ${transition.set_flags}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "遷移に失敗しました";
      setError(msg);
      addLog("error", `エラー: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── アクション: QR タップ ─────────────────────
  async function handleQrTap(item: QuickReplyItem) {
    if (!selectedWorkId || !lineUserId.trim()) return;
    addLog("action", `🔘 QR: 「${item.label}」`);

    // URL を開く
    if (item.action === "url" && item.value) {
      window.open(item.value, "_blank", "noopener,noreferrer");
      return;
    }

    // ヒント表示（API 呼び出しなし）
    // - ユーザー吹き出しにラベルを表示（hint ID ではなく表示文言）
    // - ヒント本文・回答誘導メッセージをチャットに追加
    // - QR は消費しない（再表示のため）
    if (item.action === "hint") {
      const hintMsgs: RuntimePhaseMessage[] = [];
      const hintBody = item.hint_text?.trim() || "ヒントはまだ設定されていません。";
      hintMsgs.push({
        id: `hint-${Date.now()}-body`,
        message_type: "text",
        body: hintBody,
        asset_url: null,
        alt_text: null,
        flex_payload_json: null,
        quick_replies: null,
        sort_order: 0,
        character: null,
      });
      if (item.hint_followup?.trim()) {
        hintMsgs.push({
          id: `hint-${Date.now()}-followup`,
          message_type: "text",
          body: item.hint_followup.trim(),
          asset_url: null,
          alt_text: null,
          flex_payload_json: null,
          quick_replies: null,
          sort_order: 1,
          character: null,
        });
      }
      // ユーザー吹き出し（ヒントボタンのラベル）→ ボット吹き出し（ヒント本文）を挿入順で追加
      setCurrentItems((prev) => [
        ...prev,
        { kind: "user", text: item.label },
        ...hintMsgs.map((m) => ({ kind: "bot" as const, msg: m })),
      ]);
      addLog("system", `💡 ヒント: ${hintBody}`);
      return;
    }

    // target_message_id: チェーンを辿ってチャットに追加（フェーズ変更なし）
    if (item.target_type === "message" && item.target_message_id) {
      // ユーザー吹き出しを即座に挿入
      setCurrentItems((prev) => [...prev, { kind: "user", text: item.label }]);
      setLoading(true);
      try {
        const msgs = await runtimeApi.getMessage(getDevToken(), item.target_message_id);
        setCurrentItems((prev) => [
          ...prev,
          ...msgs.map((m) => ({ kind: "bot" as const, msg: m })),
        ]);
        const summary = msgs.map((m) => m.body ?? "[非テキスト]").join(" → ");
        addLog("system", `💬 メッセージ返信: 「${summary}」`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "メッセージの取得に失敗しました";
        setError(errMsg);
        addLog("error", `エラー: ${errMsg}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // target_phase_id: フェーズへ直接ジャンプ
    if (item.target_phase_id) {
      setLoading(true);
      setError(null);
      setMessage(null);
      const snapOaTitle2 = oas.find((o) => o.id === selectedOaId)?.title ?? "";
      const snapState2   = state;
      // ユーザーが押した QR ラベルを吹き出しに含めてスナップショット
      const snapItems2: CurrentChatItem[] = [...currentItems, { kind: "user", text: item.label }];
      try {
        const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
          line_user_id:    lineUserId.trim(),
          work_id:         selectedWorkId,
          target_phase_id: item.target_phase_id,
        });
        if (snapState2?.phase) {
          setChatLog((prev) => [
            ...prev,
            ...buildPhaseSnapshot(snapState2.phase!, snapItems2, snapOaTitle2),
          ]);
        }
        setState(result);
        setCurrentItems([]);
        if (result._message) { setMessage(result._message); addLog("system", result._message); }
        if (result.phase) {
          addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "遷移に失敗しました";
        setError(errMsg);
        addLog("error", `エラー: ${errMsg}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // action="text" / "next" / "custom" → テキストとして advance
    const text = item.value ?? item.label;
    // ユーザー吹き出しを即座に追加（楽観的更新）
    const userItemQr: CurrentChatItem = { kind: "user", text: item.label };
    setCurrentItems((prev) => [...prev, userItemQr]);
    setLoading(true);
    setError(null);
    setMessage(null);
    const prevPhaseIdQr  = state?.phase?.id;
    const snapOaTitle3   = oas.find((o) => o.id === selectedOaId)?.title ?? "";
    const snapState3     = state;
    // currentItems + userItem（state 更新前なので手動で付加）
    const snapItems3: CurrentChatItem[] = [...currentItems, userItemQr];
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
        label:        text,
      });
      if (result.phase?.id !== prevPhaseIdQr) {
        if (snapState3?.phase) {
          setChatLog((prev) => [
            ...prev,
            ...buildPhaseSnapshot(snapState3.phase!, snapItems3, snapOaTitle3),
          ]);
        }
        setState(result);
        setCurrentItems([]);
      } else {
        setState(result);
        if (result._response_messages && result._response_messages.length > 0) {
          setCurrentItems((prev) => [
            ...prev,
            ...result._response_messages!.map((m) => ({ kind: "bot" as const, msg: m })),
          ]);
          const summary = result._response_messages.map((m) => m.body ?? "[非テキスト]").join(" → ");
          addLog("system", `💬 応答: 「${summary}」`);
        }
      }
      const suppressMsg =
        result._matched === false &&
        (!!result._response_messages?.length || !!activeQrItems?.length);
      if (result._message && !suppressMsg) { setMessage(result._message); addLog("system", result._message); }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "遷移に失敗しました";
      setError(errMsg);
      addLog("error", `エラー: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── アクション: テキスト送信 ─────────────────
  async function handleSendText(text: string) {
    if (!text.trim() || !selectedWorkId || !lineUserId.trim() || loading) return;
    const trimmed = text.trim();

    // QR アクティブ時: QR ラベルとの一致を先に確認 → 一致したら QR タップとして処理
    if (activeQrItems?.length) {
      const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
      const matched = activeQrItems.find(
        (q) => norm(q.label) === norm(trimmed) || (q.value && norm(q.value) === norm(trimmed))
      );
      if (matched) {
        handleQrTap(matched);
        return;
      }
    }

    // ユーザー吹き出しを即座に追加（楽観的更新）
    const userItemText: CurrentChatItem = { kind: "user", text: trimmed };
    setCurrentItems((prev) => [...prev, userItemText]);
    addLog("action", `✏️ テキスト送信: 「${trimmed}」`);
    setLoading(true);
    setError(null);
    setMessage(null);

    const prevPhaseId  = state?.phase?.id;
    const snapOaTitle4 = oas.find((o) => o.id === selectedOaId)?.title ?? "";
    const snapState4   = state;
    // currentItems + userItem（state 更新前なので手動で付加）
    const snapItems4: CurrentChatItem[] = [...currentItems, userItemText];
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
        label:        trimmed,
      });
      if (result.phase?.id !== prevPhaseId) {
        if (snapState4?.phase) {
          setChatLog((prev) => [
            ...prev,
            ...buildPhaseSnapshot(snapState4.phase!, snapItems4, snapOaTitle4),
          ]);
        }
        setState(result);
        setCurrentItems([]);
      } else {
        setState(result);
        if (result._response_messages && result._response_messages.length > 0) {
          setCurrentItems((prev) => [
            ...prev,
            ...result._response_messages!.map((m) => ({ kind: "bot" as const, msg: m })),
          ]);
          const summary = result._response_messages.map((m) => m.body ?? "[非テキスト]").join(" → ");
          addLog("system", `💬 応答: 「${summary}」`);
        }
      }
      const suppressMsg =
        result._matched === false &&
        (!!result._response_messages?.length || !!activeQrItems?.length);
      if (result._message && !suppressMsg) { setMessage(result._message); addLog("system", result._message); }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "送信に失敗しました";
      setError(errMsg);
      addLog("error", `エラー: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── アクション: リセット ──────────────────────
  async function handleReset() {
    if (!selectedWorkId || !lineUserId.trim()) return;
    if (!confirm("進行状態をリセットしますか？")) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setLog([]);
    try {
      await runtimeApi.reset(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
      });
      setState(null);
      setCurrentItems([]);
      setChatLog([]);
      addLog("system", "🔄 進行状態をリセットしました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "リセットに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // ── 作品変更 ──────────────────────────────────
  function handleWorkChange(workId: string) {
    setSelectedWorkId(workId);
    setState(null);
    setMessage(null);
    setError(null);
    setLog([]);
    setCurrentItems([]);
    setChatLog([]);
  }

  const isStarted     = !!state?.progress;
  // 開始待機中: progress はあるが phase がなく start_triggers が設定されている
  const isPending     = isStarted && !state?.phase && (state?.start_triggers?.length ?? 0) > 0;
  const startTriggers = state?.start_triggers ?? [];
  const isEnding      = state?.progress?.reached_ending ?? false;
  const currentPhase  = state?.phase;
  const selectedWork  = works.find((w) => w.id === selectedWorkId);

  // アクティブ QR: 表示済みメッセージ列の末尾ボットメッセージに紐づく quick_replies のみ。
  // currentItems に bot アイテムがあればその末尾、なければ phase.messages の末尾。
  // activeQrMessageId と activeQrItems を single source of truth として管理する。
  const { activeQrMessageId, activeQrItems } = (() => {
    const empty = { activeQrMessageId: null as string | null, activeQrItems: null as QuickReplyItem[] | null };
    if (!state?.phase?.messages) return empty;
    const lastBotItem = [...currentItems].reverse().find((x) => x.kind === "bot");
    const lastDisplayed = lastBotItem
      ? lastBotItem.msg
      : state.phase.messages[state.phase.messages.length - 1];
    if (!lastDisplayed?.quick_replies?.length) return empty;
    const items = lastDisplayed.quick_replies.filter((q) => q.enabled !== false);
    if (items.length === 0) return empty;
    return { activeQrMessageId: lastDisplayed.id, activeQrItems: items };
  })();

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* ── ヘッダー ── */}
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            <Link href="/oas">アカウントリスト</Link>
            {" / シナリオテスト"}
          </div>
          <h2>🎮 シナリオテスト</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            作成したシナリオを API 経由でローカルテストできます。
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>

        {/* ── 左ペイン: 設定 ── */}
        <div>
          {/* 作品選択 */}
          <div className="card" style={{ marginBottom: 12 }}>
            <p style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "#374151" }}>
              テスト対象を選択
            </p>

            <div className="form-group">
              <label htmlFor="oa-select">OA</label>
              {oasLoading ? (
                <div className="skeleton" style={{ height: 36 }} />
              ) : (
                <select id="oa-select" value={selectedOaId}
                  onChange={(e) => { setSelectedOaId(e.target.value); handleWorkChange(""); }}
                  style={{ width: "100%" }}>
                  <option value="">— OA を選択 —</option>
                  {oas.map((oa) => (
                    <option key={oa.id} value={oa.id}>{oa.title}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="work-select">作品</label>
              {worksLoading ? (
                <div className="skeleton" style={{ height: 36 }} />
              ) : (
                <select id="work-select" value={selectedWorkId}
                  onChange={(e) => handleWorkChange(e.target.value)}
                  style={{ width: "100%" }}
                  disabled={!selectedOaId || works.length === 0}>
                  <option value="">— 作品を選択 —</option>
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>{w.title}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="user-id">
                テストユーザー ID
                <button
                  type="button"
                  onClick={() => setLineUserId(`test-${Math.random().toString(36).slice(2, 8)}`)}
                  style={{ marginLeft: 8, fontSize: 11, color: "#2563eb", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  ランダム生成
                </button>
              </label>
              <input id="user-id" type="text" value={lineUserId}
                onChange={(e) => { setLineUserId(e.target.value); setState(null); setLog([]); }}
                placeholder="test-user-01" />
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                LINE では実際の lineUserId が入ります
              </p>
            </div>
          </div>

          {/* 操作ボタン */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={!selectedWorkId || !lineUserId.trim() || loading}
              onClick={handleStart}
            >
              {loading ? <><span className="spinner" /> 処理中...</> : "▶ シナリオを開始（リセット含む）"}
            </button>

            {isStarted && !isEnding && (
              <button
                className="btn btn-ghost"
                style={{ width: "100%" }}
                disabled={loading}
                onClick={() => loadProgress(selectedWorkId, lineUserId.trim())}
              >
                🔃 状態を再取得
              </button>
            )}

            {isStarted && (
              <button
                className="btn btn-danger"
                style={{ width: "100%", fontSize: 12 }}
                disabled={loading}
                onClick={handleReset}
              >
                🗑 進行状態をリセット
              </button>
            )}
          </div>

          {/* フロー編集リンク */}
          {selectedWork && (
            <div className="card" style={{ fontSize: 12 }}>
              <p style={{ fontWeight: 600, marginBottom: 8, color: "#374151" }}>作品の編集</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Link
                  href={`/oas/${selectedOaId}/works/${selectedWorkId}/edit`}
                  style={{ color: "#2563eb", textDecoration: "none" }}
                >
                  📋 シナリオ・フェーズ編集 →
                </Link>
                <Link
                  href={`/oas/${selectedOaId}/works/${selectedWorkId}/characters`}
                  style={{ color: "#2563eb", textDecoration: "none" }}
                >
                  👤 キャラクター管理 →
                </Link>
              </div>
            </div>
          )}

          {/* 🎌 フラグパネル */}
          {state?.progress && (
            <FlagsPanel flags={state.progress.flags} />
          )}

          {/* 操作ログ */}
          {log.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "#374151" }}>操作ログ</p>
              <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11, fontFamily: "monospace" }}>
                {log.map((entry, i) => (
                  <div key={i} style={{
                    color: entry.type === "error" ? "#ef4444" : entry.type === "action" ? "#2563eb" : "#6b7280",
                    padding: "2px 0",
                    borderBottom: "1px solid #f3f4f6",
                  }}>
                    {entry.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 右ペイン: プレイ画面 ── */}
        <div>
          {/* ── 開発中バナー ── */}
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 14px",
            marginBottom: 12,
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 10,
            fontSize: 12,
            color: "#92400e",
            lineHeight: 1.65,
          }}>
            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>⚠️</span>
            <span>
              現在開発中の機能のため、一部挙動が実機と異なる場合があります。
              あらかじめご了承ください。
            </span>
          </div>

          {!selectedWorkId ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "40px 0" }}>
                <div className="empty-state-icon">🎮</div>
                <p className="empty-state-title">作品を選択してください</p>
                <p className="empty-state-desc">左側のパネルで OA と作品を選択し、シナリオを開始してください。</p>
              </div>
            </div>
          ) : !isStarted ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "40px 0" }}>
                <div className="empty-state-icon">⏸️</div>
                <p className="empty-state-title">シナリオ未開始</p>
                <p className="empty-state-desc">
                  「▶ シナリオを開始」ボタンを押すと、開始トリガーが表示されます。
                </p>
              </div>
            </div>
          ) : isPending ? (
            /* ── 開始待機パネル ── */
            <PendingPanel
              triggers={startTriggers}
              loading={loading}
              onTriggerClick={handleSendText}
              onSendText={handleSendText}
            />
          ) : (
            <div>
              {/* 進行状況バー */}
              {state?.progress && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  marginBottom: 12, fontSize: 12, color: "#6b7280",
                }}>
                  <span>👤 {state.progress.line_user_id}</span>
                  <span style={{ color: "#d1d5db" }}>|</span>
                  {isEnding ? (
                    <span style={{ color: "#9333ea", fontWeight: 700 }}>🎭 エンディング到達</span>
                  ) : (
                    <span>📍 進行中</span>
                  )}
                </div>
              )}

              {/* エラー表示 */}
              {error && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}

              {/* システムメッセージ */}
              {message && !error && (
                <div style={{
                  background: "#fffbeb", border: "1px solid #fcd34d",
                  borderRadius: 8, padding: "10px 14px",
                  fontSize: 13, color: "#92400e", marginBottom: 12,
                }}>
                  ℹ️ {message}
                </div>
              )}

              {/* エンディング到達 */}
              {isEnding && currentPhase && (
                <EndingPanel phase={currentPhase} />
              )}

              {/* 現在フェーズパネル */}
              {currentPhase && !isEnding && (
                <PhasePanel
                  key={currentPhase.id}
                  phase={currentPhase}
                  loading={loading}
                  onAdvance={handleAdvance}
                  onQrTap={handleQrTap}
                  currentItems={currentItems}
                  onSendText={handleSendText}
                  activeQrMessageId={activeQrMessageId}
                  activeQrItems={activeQrItems}
                  oaTitle={oas.find((o) => o.id === selectedOaId)?.title ?? ""}
                  chatLog={chatLog}
                />
              )}

              {loading && !currentPhase && (
                <div className="card">
                  <div className="skeleton" style={{ height: 20, marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 60, marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 36 }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// FlagsPanel — 現在のフラグ一覧表示
// ────────────────────────────────────────────────
function FlagsPanel({ flags }: { flags: Record<string, unknown> }) {
  const entries = Object.entries(flags);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "#374151" }}>
        🎌 現在のフラグ
      </p>
      {entries.length === 0 ? (
        <p style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
          {"{ }  （フラグなし）"}
        </p>
      ) : (
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{
              display: "flex", gap: 8, padding: "3px 0",
              borderBottom: "1px solid #f3f4f6",
            }}>
              <span style={{ color: "#7c3aed", minWidth: 120, wordBreak: "break-all" }}>{k}</span>
              <span style={{ color: "#111827", fontWeight: 700 }}>
                {typeof v === "string" ? `"${v}"` : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────
function calcTypingDelay(msg: RuntimePhaseMessage): number {
  if (msg.message_type !== "text") return 900;
  const len = msg.body?.length ?? 0;
  return Math.min(500 + len * 22, 2200);
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

// ────────────────────────────────────────────────
// TypingIndicator — タイピングアニメーション
// ────────────────────────────────────────────────
function TypingIndicator({ char }: { char: RuntimePhaseMessage["character"] }) {
  const hasChar = !!char;
  const iconEl = hasChar && char ? (
    char.icon_image_url
      ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={char.icon_image_url} alt={char.name}
          style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: char.icon_color ?? "#06C755", fontSize: 13, fontWeight: 700, color: "#fff",
        }}>
          {char.icon_type === "text" ? (char.icon_text ?? char.name[0]) : char.name[0]}
        </div>
      )
  ) : (
    <div style={{
      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#c9cdd4", fontSize: 16,
    }}>📢</div>
  );

  return (
    <div style={{ display: "flex", gap: 7, marginBottom: 8, alignItems: "flex-end" }}>
      <div style={{ flexShrink: 0 }}>{iconEl}</div>
      <div>
        {hasChar && char && (
          <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4 }}>{char.name}</p>
        )}
        <div style={{
          background: "#fff", borderRadius: "4px 16px 16px 16px",
          padding: "10px 14px", display: "flex", gap: 4, alignItems: "center",
          boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
        }}>
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// QrButtons — QR ボタン列（メッセージ直下インライン表示用）
// ────────────────────────────────────────────────
function QrButtons({ items, onTap, loading }: {
  items:   QuickReplyItem[];
  onTap:   (q: QuickReplyItem) => void;
  loading: boolean;
}) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6,
      justifyContent: "flex-end",
      padding: "6px 4px 10px",
    }}>
      {items.map((q, idx) => (
        <button
          key={idx}
          onClick={() => onTap(q)}
          disabled={loading}
          style={{
            padding: "7px 14px",
            border: "1.5px solid #06C755",
            borderRadius: 20,
            background: loading ? "#f9fafb" : "#fff",
            color: "#06C755",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 600,
            whiteSpace: "nowrap",
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.background = "#06C755";
              e.currentTarget.style.color = "#fff";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.color = "#06C755";
          }}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────
// PhaseSeparator — フェーズ区切り（履歴表示用）
// ────────────────────────────────────────────────
function PhaseSeparator({ name, phaseType }: { name: string; phaseType: PhaseType }) {
  const meta = PHASE_TYPE_META[phaseType];
  return (
    <div style={{ textAlign: "center", margin: "10px 0", fontSize: 11, color: "rgba(0,0,0,0.45)" }}>
      <span style={{
        background: "rgba(255,255,255,0.55)",
        padding: "3px 12px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.08)",
        color: meta.color,
      }}>
        {meta.label} — {name}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────
// PhasePanel — 通常フェーズ表示
// ────────────────────────────────────────────────
interface PhasePanelProps {
  phase:          RuntimeState["phase"] & {};
  loading:        boolean;
  onAdvance:      (t: RuntimeTransition) => void;
  onQrTap:        (item: QuickReplyItem) => void;
  currentItems:   CurrentChatItem[];
  onSendText:     (text: string) => void;
  activeQrMessageId: string | null;
  activeQrItems:     QuickReplyItem[] | null;
  oaTitle:           string;
  chatLog:           ChatEntry[];
}

function PhasePanel({ phase, loading, onAdvance, onQrTap, currentItems, onSendText, activeQrMessageId, activeQrItems, oaTitle, chatLog }: PhasePanelProps) {
  const [inputText, setInputText] = useState("");

  // フェーズ変更時に入力欄をクリア
  useEffect(() => {
    setInputText("");
  }, [phase.id]);

  function handleSubmit() {
    if (!inputText.trim() || loading) return;
    onSendText(inputText.trim());
    setInputText("");
  }
  const meta = PHASE_TYPE_META[phase.phase_type];
  const cancelRef = useRef(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // アニメーション状態
  const [visibleCount, setVisibleCount]   = useState(0);
  const [isTyping, setIsTyping]           = useState(false);
  const [nextTypingChar, setNextTypingChar] = useState<RuntimePhaseMessage["character"]>(null);
  const [allShown, setAllShown]           = useState(false);

  useEffect(() => {
    cancelRef.current = false;
    setVisibleCount(0);
    setIsTyping(false);
    setAllShown(false);

    const msgs = phase.messages;
    if (msgs.length === 0) { setAllShown(true); return; }

    (async () => {
      for (let i = 0; i < msgs.length; i++) {
        if (cancelRef.current) return;
        setNextTypingChar(msgs[i].character ?? null);
        setIsTyping(true);
        await sleep(calcTypingDelay(msgs[i]));
        if (cancelRef.current) return;
        setIsTyping(false);
        setVisibleCount(i + 1);
        if (i < msgs.length - 1) await sleep(180);
      }
      setAllShown(true);
    })();

    return () => { cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  // 最新メッセージへスクロール
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visibleCount, isTyping, chatLog.length, currentItems.length]);

  return (
    <div>
      {/* ── LINEトーク風チャット画面 ── */}
      <div style={{
        border: "1px solid #d1d5db",
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        background: "#fff",
      }}>
        {/* トークヘッダー */}
        <div style={{
          background: "#fff",
          borderBottom: "1px solid #e9ecef",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{phase.name}</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, color: meta.color,
            background: meta.bg, padding: "2px 7px", borderRadius: 8,
            border: `1px solid ${meta.color}33`,
          }}>
            {meta.label}
          </span>
        </div>

        {/* メッセージエリア（固定高さ・内部スクロール） */}
        <div style={{ background: "#c4dde3", padding: "14px 12px 18px", height: 520, overflowY: "auto" }}>
          {/* フェーズをまたいだ履歴（静的・アニメーションなし） */}
          {chatLog.map((entry, i) => {
            if (entry.kind === "phase-sep") {
              return <PhaseSeparator key={`sep-${i}`} name={entry.name} phaseType={entry.phaseType} />;
            }
            if (entry.kind === "bot") {
              return <MessageBubble key={`log-${i}`} msg={entry.msg} index={i} oaTitle={entry.oaTitle} />;
            }
            if (entry.kind === "user") {
              return <UserMessageBubble key={`log-user-${i}`} text={entry.text} />;
            }
            return null;
          })}
          {/* 現在フェーズ区切り（履歴がある場合のみ） */}
          {chatLog.length > 0 && (
            <PhaseSeparator name={phase.name} phaseType={phase.phase_type} />
          )}
          {phase.description && (
            <div style={{
              textAlign: "center", marginBottom: 10,
              fontSize: 11, color: "rgba(0,0,0,0.4)",
              background: "rgba(255,255,255,0.45)",
              borderRadius: 10, padding: "3px 12px",
              display: "inline-block", marginLeft: "50%", transform: "translateX(-50%)",
            }}>
              {phase.description}
            </div>
          )}
          {phase.messages.length === 0 && (
            <p style={{ color: "rgba(0,0,0,0.35)", fontSize: 13, textAlign: "center", padding: "14px 0" }}>
              このフェーズにはメッセージがありません
            </p>
          )}
          {phase.messages.slice(0, visibleCount).map((msg, i) => (
            <Fragment key={msg.id}>
              <MessageBubble msg={msg} index={i} oaTitle={oaTitle} />
              {/* QR: このメッセージが activeQrMessageId と一致するときのみ、直下に描画 */}
              {allShown && msg.id === activeQrMessageId && activeQrItems && (
                <QrButtons items={activeQrItems} onTap={onQrTap} loading={loading} />
              )}
            </Fragment>
          ))}
          {/* currentItems: ユーザー入力とボット応答を挿入順でレンダリング */}
          {allShown && currentItems.map((item, i) => {
            if (item.kind === "bot") {
              return (
                <Fragment key={`ci-bot-${i}`}>
                  <MessageBubble msg={item.msg} index={phase.messages.length + i} oaTitle={oaTitle} />
                  {item.msg.id === activeQrMessageId && activeQrItems && (
                    <QrButtons items={activeQrItems} onTap={onQrTap} loading={loading} />
                  )}
                </Fragment>
              );
            }
            return <UserMessageBubble key={`ci-user-${i}`} text={item.text} />;
          })}
          {/* 遷移 QR — message QR が非アクティブのとき、最後のメッセージ直下にインライン表示 */}
          {allShown && !activeQrItems?.length && phase.transitions !== null && (
            phase.transitions.length === 0 ? (
              <p style={{ color: "rgba(0,0,0,0.35)", fontSize: 11, textAlign: "center", padding: "8px 0" }}>
                ⚠ このフェーズに遷移が設定されていません
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", padding: "6px 4px 10px" }}>
                {phase.transitions.map((tr) => (
                  <button
                    key={tr.id}
                    onClick={() => onAdvance(tr)}
                    disabled={loading}
                    title={tr.set_flags && tr.set_flags !== "{}" ? `✏️ ${tr.set_flags}` : undefined}
                    style={{
                      padding: "7px 14px",
                      border: "1.5px solid #06C755",
                      borderRadius: 20,
                      background: loading ? "#f9fafb" : "#fff",
                      color: "#06C755",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: 600,
                      whiteSpace: "nowrap",
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.background = "#06C755";
                        e.currentTarget.style.color = "#fff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#fff";
                      e.currentTarget.style.color = "#06C755";
                    }}
                  >
                    {tr.label}
                    {tr.set_flags && tr.set_flags !== "{}" && (
                      <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>✏️</span>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
          {isTyping && <TypingIndicator char={nextTypingChar} />}
          <div ref={chatBottomRef} />
        </div>

        {/* テキスト入力バー（LINE 風） */}
        <div style={{
          borderTop: "1px solid #e9ecef",
          background: "#fff",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "#f3f4f6",
            borderRadius: 20,
            padding: "6px 14px",
          }}>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="メッセージを入力..."
              disabled={loading}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 14,
                color: "#111827",
                minWidth: 0,
              }}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !inputText.trim()}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: inputText.trim() && !loading ? "#06C755" : "#d1d5db",
              color: "#fff",
              cursor: inputText.trim() && !loading ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 16,
              transition: "background 0.15s",
            }}
            aria-label="送信"
          >
            ➤
          </button>
        </div>
      </div>

    </div>
  );
}

// ────────────────────────────────────────────────
// PendingPanel — 開始待機状態（トリガー QR 表示）
// ────────────────────────────────────────────────
interface PendingPanelProps {
  triggers:       StartTrigger[];
  loading:        boolean;
  onTriggerClick: (text: string) => void;
  onSendText:     (text: string) => void;
}

function PendingPanel({ triggers, loading, onTriggerClick, onSendText }: PendingPanelProps) {
  const [inputText, setInputText] = useState("");

  function handleSubmit() {
    if (!inputText.trim() || loading) return;
    onSendText(inputText.trim());
    setInputText("");
  }

  return (
    <div>
      {/* LINE 風チャット UI */}
      <div style={{
        border: "1px solid #d1d5db",
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        background: "#fff",
      }}>
        {/* トークヘッダー */}
        <div style={{
          background: "#fff",
          borderBottom: "1px solid #e9ecef",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>シナリオ待機中</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#6b7280",
            background: "#f3f4f6", padding: "2px 7px", borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}>
            未開始
          </span>
        </div>

        {/* 空のメッセージエリア */}
        <div style={{
          background: "#c4dde3",
          padding: "28px 16px",
          minHeight: 120,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}>
          <p style={{ color: "rgba(0,0,0,0.4)", fontSize: 13, textAlign: "center" }}>
            開始トリガーを押すと物語が始まります
          </p>
          {/* トリガー QR ボタン（LINE 風、チャット内下部） */}
          {triggers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>
              {triggers.map((t, i) => (
                <button
                  key={i}
                  onClick={() => { onTriggerClick(t.trigger); }}
                  disabled={loading}
                  style={{
                    padding: "7px 18px",
                    border: "1.5px solid #06C755",
                    borderRadius: 20,
                    background: loading ? "#f9fafb" : "#fff",
                    color: "#06C755",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontSize: 13, fontWeight: 600,
                    whiteSpace: "nowrap",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.background = "#06C755"; e.currentTarget.style.color = "#fff"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#06C755"; }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* テキスト入力バー */}
        <div style={{
          borderTop: "1px solid #e9ecef",
          background: "#fff",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "#f3f4f6",
            borderRadius: 20,
            padding: "6px 14px",
          }}>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="開始トリガーを入力..."
              disabled={loading}
              style={{
                flex: 1, border: "none", outline: "none",
                background: "transparent", fontSize: 14, color: "#111827", minWidth: 0,
              }}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !inputText.trim()}
            style={{
              width: 36, height: 36, borderRadius: "50%", border: "none",
              background: inputText.trim() && !loading ? "#06C755" : "#d1d5db",
              color: "#fff",
              cursor: inputText.trim() && !loading ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, fontSize: 16, transition: "background 0.15s",
            }}
            aria-label="送信"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// EndingMessages — エンディングメッセージのアニメーション表示
// ────────────────────────────────────────────────
function EndingMessages({ messages }: { messages: RuntimePhaseMessage[] }) {
  const cancelRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [nextTypingChar, setNextTypingChar] = useState<RuntimePhaseMessage["character"]>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current = false;
    setVisibleCount(0);
    setIsTyping(false);
    if (messages.length === 0) return;
    (async () => {
      for (let i = 0; i < messages.length; i++) {
        if (cancelRef.current) return;
        setNextTypingChar(messages[i].character ?? null);
        setIsTyping(true);
        await sleep(calcTypingDelay(messages[i]));
        if (cancelRef.current) return;
        setIsTyping(false);
        setVisibleCount(i + 1);
        if (i < messages.length - 1) await sleep(180);
      }
    })();
    return () => { cancelRef.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visibleCount, isTyping]);

  return (
    <div style={{ background: "#c4dde3", padding: "14px 12px 18px", maxHeight: 420, overflowY: "auto" }}>
      {messages.slice(0, visibleCount).map((msg, i) => (
        <MessageBubble key={msg.id} msg={msg} index={i} />
      ))}
      {isTyping && <TypingIndicator char={nextTypingChar} />}
      <div ref={bottomRef} />
    </div>
  );
}

// ────────────────────────────────────────────────
// EndingPanel — エンディング到達表示
// ────────────────────────────────────────────────
function EndingPanel({ phase }: { phase: NonNullable<RuntimeState["phase"]> }) {
  return (
    <div>
      <div style={{
        border: "1px solid #d1d5db",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        background: "#fff",
        marginBottom: 12,
      }}>
        {/* トークヘッダー */}
        <div style={{
          background: "#fff",
          borderBottom: "1px solid #e9ecef",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{phase.name}</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#9333ea",
            background: "#faf5ff", padding: "2px 7px", borderRadius: 8,
            border: "1px solid #e9d5ff",
          }}>
            エンディング
          </span>
        </div>

        {/* エンディング到達バナー */}
        <div style={{
          background: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)",
          padding: "20px 16px",
          textAlign: "center",
          borderBottom: "1px solid #e9d5ff",
        }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>🎭</div>
          <p style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600 }}>エンディングに到達しました</p>
        </div>

        {/* エンディングメッセージ */}
        {phase.messages.length > 0 && (
          <EndingMessages messages={phase.messages} />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// ImageMessage — 画像メッセージ表示（エラー時フォールバック付き）
// ────────────────────────────────────────────────
function ImageMessage({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        background: "#f3f4f6", border: "1px dashed #d1d5db",
        borderRadius: 8, padding: "16px 24px", color: "#9ca3af", fontSize: 12,
      }}>
        <span style={{ fontSize: 24 }}>🖼</span>
        <span>画像を読み込めませんでした</span>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all", fontSize: 11 }}>
          {url}
        </a>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="画像メッセージ"
      onError={() => setErrored(true)}
      style={{
        maxWidth: "100%", maxHeight: 300, borderRadius: 8,
        display: "block", objectFit: "contain",
      }}
    />
  );
}

// ────────────────────────────────────────────────
// UserMessageBubble — ユーザー送信テキスト（右側吹き出し）
// ────────────────────────────────────────────────
function UserMessageBubble({ text }: { text: string }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "flex-end",
      marginBottom: 8,
    }}>
      <div style={{
        background: "#06C755",
        color: "#fff",
        borderRadius: "16px 4px 16px 16px",
        padding: "8px 12px",
        fontSize: 14,
        lineHeight: 1.55,
        maxWidth: 270,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
      }}>
        {text}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// MessageBubble — メッセージ表示
// ────────────────────────────────────────────────
function MessageBubble({ msg, index, oaTitle }: { msg: RuntimePhaseMessage; index: number; oaTitle?: string }) {
  const hasChar = !!msg.character;
  const char    = msg.character;

  const iconEl = hasChar && char ? (
    char.icon_image_url
      ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={char.icon_image_url}
          alt={char.name}
          style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: char.icon_color ?? "#06C755",
          fontSize: 13, fontWeight: 700, color: "#fff",
        }}>
          {char.icon_type === "text" ? (char.icon_text ?? char.name[0]) : char.name[0]}
        </div>
      )
  ) : (
    <div style={{
      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#c9cdd4", fontSize: 16,
    }}>
      📢
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 7, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0 }}>{iconEl}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 送信者名: キャラ名 from OA名（LINE 実機に準拠） */}
        <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4, fontWeight: 400 }}>
          {hasChar && char ? (
            oaTitle ? `${char.name} from ${oaTitle}` : char.name
          ) : (
            oaTitle ? `OA from ${oaTitle}` : "OA"
          )}
        </p>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {/* 吹き出し（しっぽ付き） */}
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", left: -6, top: 10,
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: "5px 7px 5px 0",
              borderColor: "transparent #fff transparent transparent",
            }} />
            <div style={{
              background: "#fff",
              borderRadius: "4px 16px 16px 16px",
              padding: "8px 12px",
              fontSize: 14, color: "#111",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxWidth: 270,
              boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
            }}>
              {msg.message_type === "text" && (msg.body ?? "")}
              {msg.message_type === "image" && (
                msg.asset_url
                  ? <ImageMessage url={msg.asset_url} />
                  : <span style={{ color: "#9ca3af", fontSize: 12 }}>🖼 画像URLなし</span>
              )}
              {(msg.message_type === "riddle" || msg.message_type === "carousel" || msg.message_type === "video" || msg.message_type === "voice") && (
                <span style={{ color: "#9ca3af", fontSize: 12 }}>[{msg.message_type}メッセージ]</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
