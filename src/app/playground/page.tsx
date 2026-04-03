"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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

  // ── LINE 演出用 ──
  const [showRead, setShowRead] = useState(false);

  // ── QR タップで追加表示されるメッセージ（target_message_id 用） ──
  const [extraMessages, setExtraMessages] = useState<RuntimePhaseMessage[]>([]);

  // ── ユーザーが送信したテキスト（チャットに表示） ──
  const [sentMessages, setSentMessages] = useState<string[]>([]);

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
      setExtraMessages([]);
      setSentMessages([]);
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
    setShowRead(true);  // 既読を表示
    setLoading(true);
    setError(null);
    setMessage(null);
    addLog("action", `→ 選択: 「${transition.label}」`);
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id:   lineUserId.trim(),
        work_id:        selectedWorkId,
        transition_id:  transition.id,
      });
      setShowRead(false);
      setState(result);
      setExtraMessages([]);
      setSentMessages([]);
      if (result._message) {
        setMessage(result._message);
        addLog("system", result._message);
      }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
      // フラグ更新をログに記録
      if (transition.set_flags && transition.set_flags !== "{}") {
        addLog("system", `🎌 フラグ更新: ${transition.set_flags}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "遷移に失敗しました";
      setShowRead(false);
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
    if (item.action === "hint") {
      const hintText = item.hint_text ?? "（ヒントなし）";
      setMessage(`💡 ${hintText}`);
      addLog("system", `💡 ヒント: ${hintText}`);
      return;
    }

    // target_message_id: チェーンを辿ってチャットに追加（フェーズ変更なし）
    if (item.target_type === "message" && item.target_message_id) {
      setLoading(true);
      try {
        const msgs = await runtimeApi.getMessage(getDevToken(), item.target_message_id);
        setExtraMessages((prev) => [...prev, ...msgs]);
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
      setShowRead(true);
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
          line_user_id:    lineUserId.trim(),
          work_id:         selectedWorkId,
          target_phase_id: item.target_phase_id,
        });
        setShowRead(false);
        setState(result);
        setExtraMessages([]);
        setSentMessages([]);
        if (result._message) { setMessage(result._message); addLog("system", result._message); }
        if (result.phase) {
          addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "遷移に失敗しました";
        setShowRead(false);
        setError(errMsg);
        addLog("error", `エラー: ${errMsg}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // action="text" / "next" / "custom" → テキストとして advance
    const text = item.value ?? item.label;
    setShowRead(true);
    setLoading(true);
    setError(null);
    setMessage(null);
    const prevPhaseIdQr = state?.phase?.id;
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
        label:        text,
      });
      setShowRead(false);
      setState(result);
      if (result.phase?.id !== prevPhaseIdQr) {
        setExtraMessages([]);
        setSentMessages([]);
      } else if (result._response_messages && result._response_messages.length > 0) {
        setExtraMessages((prev) => [...prev, ...result._response_messages!]);
        const summary = result._response_messages.map((m) => m.body ?? "[非テキスト]").join(" → ");
        addLog("system", `💬 応答: 「${summary}」`);
      }
      if (result._message) { setMessage(result._message); addLog("system", result._message); }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "遷移に失敗しました";
      setShowRead(false);
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

    // ユーザー吹き出しを即座に追加
    setSentMessages((prev) => [...prev, trimmed]);
    addLog("action", `✏️ テキスト送信: 「${trimmed}」`);
    setShowRead(true);
    setLoading(true);
    setError(null);
    setMessage(null);

    const prevPhaseId = state?.phase?.id;
    try {
      const result: RuntimeAdvanceResult = await runtimeApi.advance(getDevToken(), {
        line_user_id: lineUserId.trim(),
        work_id:      selectedWorkId,
        label:        trimmed,
      });
      setShowRead(false);
      setState(result);
      // フェーズが変わった場合はユーザー吹き出し・追加メッセージをクリア
      if (result.phase?.id !== prevPhaseId) {
        setExtraMessages([]);
        setSentMessages([]);
      } else if (result._response_messages && result._response_messages.length > 0) {
        // 同一フェーズで response メッセージがあれば追加表示
        setExtraMessages((prev) => [...prev, ...result._response_messages!]);
        const summary = result._response_messages.map((m) => m.body ?? "[非テキスト]").join(" → ");
        addLog("system", `💬 応答: 「${summary}」`);
      }
      if (result._message) { setMessage(result._message); addLog("system", result._message); }
      if (result.phase) {
        addLog("system", `📍 フェーズ: 「${result.phase.name}」（${PHASE_TYPE_META[result.phase.phase_type].label}）`);
      }
    } catch (e) {
      setShowRead(false);
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
      setExtraMessages([]);
      setSentMessages([]);
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
  }

  const isStarted     = !!state?.progress;
  // 開始待機中: progress はあるが phase がなく start_triggers が設定されている
  const isPending     = isStarted && !state?.phase && (state?.start_triggers?.length ?? 0) > 0;
  const startTriggers = state?.start_triggers ?? [];
  const isEnding      = state?.progress?.reached_ending ?? false;
  const currentPhase  = state?.phase;
  const selectedWork  = works.find((w) => w.id === selectedWorkId);

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
                  phase={currentPhase}
                  loading={loading}
                  showRead={showRead}
                  onAdvance={handleAdvance}
                  onQrTap={handleQrTap}
                  extraMessages={extraMessages}
                  sentMessages={sentMessages}
                  onSendText={handleSendText}
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
// PhasePanel — 通常フェーズ表示
// ────────────────────────────────────────────────
interface PhasePanelProps {
  phase:         RuntimeState["phase"] & {};
  loading:       boolean;
  showRead:      boolean;
  onAdvance:     (t: RuntimeTransition) => void;
  onQrTap:       (item: QuickReplyItem) => void;
  extraMessages: RuntimePhaseMessage[];
  sentMessages:  string[];
  onSendText:    (text: string) => void;
}

function PhasePanel({ phase, loading, showRead, onAdvance, onQrTap, extraMessages, sentMessages, onSendText }: PhasePanelProps) {
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
  }, [visibleCount, isTyping]);

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

        {/* メッセージエリア */}
        {phase.messages.length === 0 ? (
          <div style={{ background: "#c4dde3", padding: "28px 16px", textAlign: "center" }}>
            <p style={{ color: "rgba(0,0,0,0.35)", fontSize: 13 }}>
              このフェーズにはメッセージがありません
            </p>
          </div>
        ) : (
          <div style={{ background: "#c4dde3", padding: "14px 12px 18px", maxHeight: 420, overflowY: "auto" }}>
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
            {phase.messages.slice(0, visibleCount).map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                index={i}
                showRead={showRead && i === visibleCount - 1 && extraMessages.length === 0}
              />
            ))}
            {/* target_message_id で追加されたメッセージ */}
            {allShown && extraMessages.map((msg, i) => (
              <MessageBubble
                key={`extra-${msg.id}-${i}`}
                msg={msg}
                index={phase.messages.length + i}
                showRead={showRead && i === extraMessages.length - 1 && sentMessages.length === 0}
              />
            ))}
            {/* ユーザーが送信したテキスト */}
            {allShown && sentMessages.map((text, i) => (
              <UserMessageBubble key={`sent-${i}`} text={text} />
            ))}
            {isTyping && <TypingIndicator char={nextTypingChar} />}
            {/* QR ボタン（LINE 風：チャット下部に表示） */}
            {allShown && (() => {
              const allMsgs = [...phase.messages.slice(0, visibleCount), ...extraMessages];
              const lastWithQr = [...allMsgs].reverse().find(
                (m) => m.quick_replies && m.quick_replies.length > 0
              );
              if (!lastWithQr?.quick_replies) return null;
              const enabledQr = lastWithQr.quick_replies.filter((q) => q.enabled !== false);
              if (enabledQr.length === 0) return null;
              return (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 6,
                  justifyContent: "flex-end",
                  padding: "8px 4px 4px",
                }}>
                  {enabledQr.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => onQrTap(q)}
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
            })()}
            <div ref={chatBottomRef} />
          </div>
        )}

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

      {/* 遷移選択肢 — allShown になったら表示 */}
      {allShown && phase.transitions !== null && (
        <div className="card">
          <p style={{
            fontSize: 11, fontWeight: 600, color: "#9ca3af",
            marginBottom: 10, textAlign: "center", letterSpacing: "0.05em",
          }}>
            ── 選択してください ──
          </p>
          {phase.transitions.length === 0 ? (
            <p style={{ color: "#ef4444", fontSize: 13, textAlign: "center" }}>
              ⚠ このフェーズに遷移が設定されていません。管理画面から追加してください。
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {phase.transitions.map((tr) => {
                const toMeta = PHASE_TYPE_META[tr.to_phase.phase_type];
                return (
                  <button
                    key={tr.id}
                    onClick={() => onAdvance(tr)}
                    disabled={loading}
                    title={
                      `→ ${toMeta.label}` +
                      (tr.set_flags && tr.set_flags !== "{}" ? `  ✏️ ${tr.set_flags}` : "")
                    }
                    style={{
                      padding: "8px 18px",
                      border: `2px solid ${toMeta.color}`,
                      borderRadius: 24,
                      background: loading ? "#f9fafb" : toMeta.bg,
                      color: toMeta.color,
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: 700,
                      transition: "background 0.15s, transform 0.1s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (!loading) {
                        e.currentTarget.style.background = toMeta.color;
                        e.currentTarget.style.color = "#fff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = toMeta.bg;
                      e.currentTarget.style.color = toMeta.color;
                    }}
                  >
                    {tr.label}
                    {tr.set_flags && tr.set_flags !== "{}" && (
                      <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.8 }}>✏️</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
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
function MessageBubble({ msg, index, showRead }: { msg: RuntimePhaseMessage; index: number; showRead?: boolean }) {
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
        {hasChar && char && (
          <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4, fontWeight: 400 }}>
            {char.name}
          </p>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
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
          {/* 既読表示 */}
          {showRead && (
            <span style={{ fontSize: 10, color: "rgba(0,0,0,0.45)", flexShrink: 0, lineHeight: 1, paddingBottom: 2 }}>
              既読
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
