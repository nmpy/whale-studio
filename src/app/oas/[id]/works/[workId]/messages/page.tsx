"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { bootstrapApi, messageApi, workApi, getDevToken } from "@/lib/api-client";
import { getCachedBootstrap, setCachedBootstrap, invalidateBootstrap } from "@/lib/admin-bootstrap-cache";
import { logAdminPerf, resourceSummary, maskId } from "@/lib/perf-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Switch } from "@/components/Switch";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { ViewerBanner } from "@/components/PermissionGuard";
import { GuideCard } from "@/components/onboarding/GuideCard";
import type { MessageWithRelations, PhaseWithCounts, TransitionWithPhases } from "@/types";
import type { Role } from "@/lib/types/permissions";
import { collectChainContinuationIds, chainLengthFrom, estimateMaxSendUnit, shouldShowSendUnitWarning, LINE_REPLY_MAX, getChainContinuations } from "./_list-helpers";
import { buildResponseKeywordPhaseIndex, findFlexKeywordPhaseIssues } from "./_flex-keyword-check";
import { analyzeMessageList } from "@/lib/message-flow-status";
import MessageCard from "./_MessageCard";
import { PhaseTabs, WarningSummaryBar, PhaseFilterBar, EmptyState, type PhaseTabItem } from "./_message-list-chrome";
import {
  buildTriggerIndexes, classifyTrigger, getMessageWarnings,
  TRIGGER_GROUP_META, ALL_TAB_GROUP_ORDER, type MessageWarningLabel,
} from "./_message-list-model";
import { ImageUploadField } from "@/components/ImageUploadField";
import type { WelcomeMessageItem } from "@/lib/welcome-messages";
import {
  initWelcomeItems, validateWelcomeItems, moveWelcomeItem, dropFirstItemDelay,
  buildWelcomeMessagesPayload, getStartTriggerFromPhases,
  WELCOME_MESSAGES_MAX, WELCOME_TEXT_MAX, WELCOME_DELAY_MAX_SECONDS,
} from "@/lib/welcome-messages-ui";


type Tab = "messages" | "welcome";

// あいさつ item の ▲▼/削除 ボタンの簡易スタイル（_MessageCard と同系統）。
function reorderBtn(disabled: boolean): CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, border: "1px solid #e5e7eb",
    background: "#fff", color: disabled ? "#d1d5db" : "#6b7280",
    cursor: disabled ? "default" : "pointer", fontSize: 12, lineHeight: 1,
  };
}

export default function MessagesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { showToast } = useToast();
  // role / canEdit は Bootstrap API のレスポンス（実 role）から初期化する。
  // 従来は useWorkspaceRole が /api/oas/[id]/members/me を別途 fetch していたが、
  // Bootstrap に集約して初期表示の往復を削減した（preview は UI 専用のため挙動不変）。
  const [role, setRole]                 = useState<Role | null>(null);
  const [canEdit, setCanEdit]           = useState(false);
  const [activeTab, setActiveTab]       = useState<Tab>("messages");
  const [workTitle, setWorkTitle]       = useState("");
  // あいさつメッセージ（複数件・text/image、最大5件）のタブ内インライン編集。
  //  welcomeItems = 編集中 / savedItems = 直近保存スナップショット（dirty 判定・設定済みバッジに使用）。
  const [welcomeItems, setWelcomeItems] = useState<WelcomeMessageItem[]>([]);
  const [savedItems,   setSavedItems]   = useState<WelcomeMessageItem[]>([]);
  const [welcomeSaving, setWelcomeSaving] = useState(false);
  const [welcomeError,  setWelcomeError]  = useState<string | null>(null);
  // 友だち追加（follow）時の動作（作品単位）。Bootstrap の work.follow_action 由来。
  const [followAction,   setFollowAction]   = useState<"auto_start" | "welcome_wait" | "none">("auto_start");
  const [savingFollow,   setSavingFollow]   = useState(false);
  // 途中再開機能の有効/無効（作品単位デフォルト設定）。Bootstrap の work.resume_enabled 由来。
  const [resumeEnabled, setResumeEnabled] = useState(true);
  const [savingResume, setSavingResume]   = useState(false);
  const [messages, setMessages]         = useState<MessageWithRelations[]>([]);
  const [phases, setPhases]             = useState<PhaseWithCounts[]>([]);
  const [transitions, setTransitions]   = useState<TransitionWithPhases[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  // 再設計版: フェーズタブの選択（"all" = すべて / phase.id / "__unassigned"）と、
  // 詳細展開中のカード id（単一展開）。旧テーブルの chain 展開 / phase 折りたたみは廃止。
  const [activePhaseId, setActivePhaseId] = useState<string>("all");
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  // 操作中の messageId (= 削除/並び替え 進行中の表示用)
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);

  // 導線状態の集計（純関数・1 回の fetch 済みデータから算出＝追加クエリなし / N+1 なし）。
  // 表示用に target 名を引くための id→entity マップもここで作る。
  const flowMap   = useMemo(() => analyzeMessageList(messages, new Set(phases.map((p) => p.id))), [messages, phases]);
  const msgById   = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const phaseById = useMemo(() => new Map(phases.map((p) => [p.id, p])), [phases]);
  // Flex の message-action.text ↔ 応答キーワードの「フェーズズレ / 不在」警告用インデックス（全メッセージから構築）。
  const kwPhaseIndex = useMemo(() => buildResponseKeywordPhaseIndex(messages), [messages]);
  // トリガー種別グルーピング用の逆引きインデックス（表示専用・ロジック不変）。
  const triggerIdx = useMemo(() => buildTriggerIndexes(messages), [messages]);
  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  // ── 再設計版 一覧の表示モデル（表示専用・bootstrap 済みデータから導出。送信/保存/遷移ロジックには非影響） ──
  // 各 head の警告ラベル（既存5警告を1つも落とさず集約）。
  const warningsByMsgId = useMemo(() => {
    const contIds = collectChainContinuationIds(messages);
    const map = new Map<string, MessageWarningLabel[]>();
    for (const m of messages) {
      if (contIds.has(m.id)) continue; // head のみ
      const info = flowMap.get(m.id);
      const flexIssues = m.message_type === "flex"
        ? findFlexKeywordPhaseIssues({ flexJson: m.flex_payload_json, flexMessagePhaseId: m.phase?.id ?? null, index: kwPhaseIndex })
        : [];
      map.set(m.id, getMessageWarnings({
        missingKeyword: info?.missingKeyword, hasBrokenLink: info?.hasBrokenLink, unreferenced: info?.unreferenced,
        chainLen: chainLengthFrom(messages, m.id), chainLimit: LINE_REPLY_MAX, hasFlexIssue: flexIssues.length > 0,
      }));
    }
    return map;
  }, [messages, flowMap, kwPhaseIndex]);

  // head 一覧をフェーズ単位に整理（並び替えは既存どおり sort_order + created_at、フェーズ内スコープ）。
  // 一覧は送信順表示: 「すべて」はフェーズ順セクション、各フェーズ内は headsByPhase の sort_order を尊重。
  const listView = useMemo(() => {
    const contIds = collectChainContinuationIds(messages);
    const phaseIds = new Set(phases.map((p) => p.id));
    const heads = messages.filter((m) => !contIds.has(m.id));
    const phaseKeyOf = (m: MessageWithRelations) => (m.phase && phaseIds.has(m.phase.id) ? m.phase.id : "__unassigned");
    const byOrder = (a: MessageWithRelations, b: MessageWithRelations) =>
      (a.sort_order - b.sort_order) ||
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) ||
      a.id.localeCompare(b.id);
    const headsByPhase = new Map<string, MessageWithRelations[]>();
    for (const m of heads) {
      const k = phaseKeyOf(m);
      if (!headsByPhase.has(k)) headsByPhase.set(k, []);
      headsByPhase.get(k)!.push(m);
    }
    for (const arr of headsByPhase.values()) arr.sort(byOrder);
    // 送信順の通し番号（フェーズ順→sort_order）。「すべて」タブのトリガーグループ内ソートに使う。
    const orderIndex = new Map<string, number>();
    let oi = 0;
    for (const p of phases) for (const m of (headsByPhase.get(p.id) ?? [])) orderIndex.set(m.id, oi++);
    for (const m of (headsByPhase.get("__unassigned") ?? [])) orderIndex.set(m.id, oi++);
    const hasUnassigned = (headsByPhase.get("__unassigned")?.length ?? 0) > 0;
    return { heads, headsByPhase, orderIndex, hasUnassigned, phaseKeyOf };
  }, [messages, phases]);

  /** 一覧からメッセージを削除する (chain head 専用)。
   *  確認ダイアログを出し、API 呼び出し成功で local state からも除去する。 */
  async function handleDeleteMessage(headMsg: MessageWithRelations) {
    if (busyMessageId) return;
    const ok = window.confirm(
      `メッセージを削除しますか？\nこの操作は取り消せません。関連する応答キーワードや設定も削除されます。`,
    );
    if (!ok) return;
    setBusyMessageId(headMsg.id);
    try {
      await messageApi.delete(getDevToken(), headMsg.id);
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      // local state からも該当メッセージ + chain continuation を除去
      const contIds = new Set(getChainContinuations(messages, headMsg.id).map((c) => c.id));
      setMessages((prev) => prev.filter((m) => m.id !== headMsg.id && !contIds.has(m.id)));
      // 詳細展開状態も clear
      setExpandedId((prev) => (prev === headMsg.id ? null : prev));
      showToast("メッセージを削除しました", "success");
    } catch (err) {
      console.error("[messages] delete error:", err);
      showToast(err instanceof Error ? err.message : "メッセージの削除に失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** phase グループ内で head メッセージを 1 件分上下に並び替える。
   *  - direction="up": 一つ前と sortOrder を入れ替える (= 0 番目なら no-op)
   *  - direction="down": 一つ後と sortOrder を入れ替える (= 最後なら no-op)
   *  バックエンドには「グループ全体の新しい順序」を渡し、sortOrder を 0,1,2,... で再付番する。
   *  これにより既存メッセージ間で sortOrder の重複が起きていても整理される副次効果あり。 */
  async function handleReorderMessage(
    headMsg: MessageWithRelations,
    direction: "up" | "down",
    groupHeads: MessageWithRelations[],
  ) {
    if (busyMessageId) return;
    const idx = groupHeads.findIndex((m) => m.id === headMsg.id);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === groupHeads.length - 1) return;

    const newOrder = [...groupHeads];
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];

    setBusyMessageId(headMsg.id);
    try {
      await messageApi.reorder(getDevToken(), {
        work_id:     workId,
        message_ids: newOrder.map((m) => m.id),
      });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      // local state を新しい順序で更新 (= sortOrder を 0,1,2,... で再付番)
      const newSortByMsgId = new Map(newOrder.map((m, i) => [m.id, i]));
      setMessages((prev) =>
        prev.map((m) =>
          newSortByMsgId.has(m.id) ? { ...m, sort_order: newSortByMsgId.get(m.id)! } : m,
        ),
      );
    } catch (err) {
      console.error("[messages] reorder error:", err);
      showToast(err instanceof Error ? err.message : "並び替えに失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** 一覧から is_active をトグルする。
   *  楽観的更新で即時反映し、失敗時は元に戻して toast を表示する。
   *  is_active のみを送信するため他フィールドへの副作用なし。 */
  async function handleToggleActive(msg: MessageWithRelations) {
    if (busyMessageId) return;
    const nextActive = !msg.is_active;
    setBusyMessageId(msg.id);
    // 楽観的更新
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_active: nextActive } : m)));
    try {
      await messageApi.update(getDevToken(), msg.id, { is_active: nextActive });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      showToast(nextActive ? "メッセージを有効化しました" : "メッセージを無効化しました", "success");
    } catch (err) {
      console.error("[messages] toggle is_active error:", err);
      // ロールバック
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_active: msg.is_active } : m)));
      showToast(err instanceof Error ? err.message : "状態の切り替えに失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** 途中再開（作品単位デフォルト設定）をトグルする。
   *  楽観的更新で即時反映し、PATCH /api/works/[workId] に resume_enabled を保存。
   *  失敗時は元に戻して toast を表示する。 */
  async function handleToggleResume(next: boolean) {
    if (savingResume) return;
    const prev = resumeEnabled;
    setResumeEnabled(next); // 楽観的更新
    setSavingResume(true);
    try {
      await workApi.update(getDevToken(), workId, { resume_enabled: next });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      showToast(next ? "途中再開を有効にしました" : "途中再開を無効にしました", "success");
    } catch (err) {
      console.error("[messages] toggle resume_enabled error:", err);
      setResumeEnabled(prev); // ロールバック
      showToast(err instanceof Error ? err.message : "設定の保存に失敗しました", "error");
    } finally {
      setSavingResume(false);
    }
  }

  // ── あいさつメッセージ（複数件・text/image）のタブ内インライン編集 ──
  // 画面遷移せず、このタブで追加・編集・並び替え・削除・保存まで完結する。
  // 保存は PATCH /api/works/[workId] の welcome_messages のみ（welcomeMessage 同期は API 側）。
  function addTextItem() {
    if (welcomeItems.length >= WELCOME_MESSAGES_MAX) return;
    setWelcomeItems([...welcomeItems, { type: "text", text: "" }]);
    setWelcomeError(null);
  }
  function addImageItem() {
    if (welcomeItems.length >= WELCOME_MESSAGES_MAX) return;
    setWelcomeItems([...welcomeItems, { type: "image", imageUrl: "" }]);
    setWelcomeError(null);
  }
  function updateItem(index: number, next: WelcomeMessageItem) {
    setWelcomeItems(welcomeItems.map((it, i) => (i === index ? next : it)));
    setWelcomeError(null);
  }
  function removeItem(index: number) {
    // 削除で先頭に繰り上がった item の待機時間は 0 に正規化（案B / 1通目は即時送信）。
    setWelcomeItems(dropFirstItemDelay(welcomeItems.filter((_, i) => i !== index)));
    setWelcomeError(null);
  }
  function moveItem(index: number, dir: "up" | "down") {
    // 並び替えで 1通目に来た item の待機時間は 0 に正規化（案B）。2通目以降同士は保持。
    setWelcomeItems(dropFirstItemDelay(moveWelcomeItem(welcomeItems, index, dir)));
  }
  /** 2通目以降カードの待機時間（秒）変更。0 は delaySeconds を外す（dirty 誤判定回避）。 */
  function updateItemDelay(index: number, seconds: number) {
    const item = welcomeItems[index];
    if (!item) return;
    const next: WelcomeMessageItem = seconds > 0
      ? { ...item, delaySeconds: seconds }
      : (() => { const { delaySeconds: _omit, ...rest } = item; return rest as WelcomeMessageItem; })();
    updateItem(index, next);
  }
  async function saveWelcomeMessages() {
    if (welcomeSaving) return;
    const v = validateWelcomeItems(welcomeItems);
    if (!v.ok) { setWelcomeError(v.overall); return; }
    // 既存の保存済みあいさつを全削除する場合のみ確認する。
    if (welcomeItems.length === 0 && savedItems.length > 0) {
      if (!confirm("あいさつメッセージをすべて削除します。友だち追加時のあいさつは送信されません。よろしいですか？")) return;
    }
    setWelcomeSaving(true);
    setWelcomeError(null);
    try {
      const updated = await workApi.update(getDevToken(), workId, buildWelcomeMessagesPayload(welcomeItems));
      const next = updated.welcome_messages ?? [];
      setWelcomeItems(next);
      setSavedItems(next);
      invalidateBootstrap(oaId, workId); // 次回再訪で最新取得（stale 防止）
      showToast("あいさつメッセージを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setWelcomeSaving(false);
    }
  }

  // 友だち追加時の動作を変更する（PATCH /api/works/[workId] follow_action）。楽観的更新。
  async function changeFollowAction(next: "auto_start" | "welcome_wait" | "none") {
    if (savingFollow || next === followAction) return;
    const prev = followAction;
    setFollowAction(next); // 楽観的更新
    setSavingFollow(true);
    try {
      await workApi.update(getDevToken(), workId, { follow_action: next });
      invalidateBootstrap(oaId, workId);
      showToast("あいさつメッセージの設定を変更しました", "success");
    } catch (err) {
      setFollowAction(prev); // ロールバック
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingFollow(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Bootstrap レスポンスを各 state に反映する共通処理。
    function applyData(data: import("@/lib/api-client").MessagesBootstrapData) {
      setWorkTitle(data.work.title);
      {
        const items = initWelcomeItems(data.work);
        setWelcomeItems(items);
        setSavedItems(items);
      }
      setFollowAction((data.work.follow_action as "auto_start" | "welcome_wait" | "none" | undefined) ?? "auto_start");
      setResumeEnabled(data.work.resume_enabled !== false);
      setMessages(data.messages);
      setPhases([...data.phases].sort((a, b) => a.sort_order - b.sort_order));
      setTransitions(data.transitions);
      setRole(data.role);
      setCanEdit(data.permissions.can_edit);
    }

    const ROUTE = "/oas/[id]/works/[workId]/messages";
    logAdminPerf(ROUTE, { pageStart: 0, oa: maskId(oaId), work: maskId(workId) });

    // 1) cache hit があれば即時表示（真っ白待ちをなくす / 再訪を即時化）。
    const cached = getCachedBootstrap(oaId, workId);
    const cacheState = cached ? (cached.isFresh ? "hit" : "stale") : "miss";
    if (cached) {
      applyData(cached.data);
      setLoading(false);
      setLoadError(null);
      logAdminPerf(ROUTE, { firstListPaint: Math.round(performance.now() - t0), cache: cacheState });
    } else {
      setLoading(true);
      setLoadError(null);
    }

    // 2) cache の有無に関わらず、必ず Bootstrap を 1 本取得して revalidate する
    //    (= stale-while-revalidate)。
    //    こうすることで、メッセージ作成/編集や phase/transition/シナリオ編集など
    //    **他ページでの更新**後にこの一覧へ戻ったとき、各更新ページに invalidate を
    //    仕込まなくても次 mount で必ず最新へ自己修復される（cache hit 時は即描画 →
    //    裏で最新に差し替え）。一覧自身の楽観更新 (delete/reorder/toggle) は即時整合の
    //    ため invalidateBootstrap でも消している。
    const fetchStart = (typeof performance !== "undefined" ? performance.now() : 0);
    bootstrapApi.messages(getDevToken(), oaId, workId)
      .then((data) => {
        if (cancelled) return;
        applyData(data);
        setCachedBootstrap(oaId, workId, data);
        setLoadError(null);
        const res = resourceSummary();
        logAdminPerf(ROUTE, {
          bootstrapFetch: Math.round(performance.now() - fetchStart),
          cache:          cacheState,
          firstData:      Math.round(performance.now() - t0),
          // 初期表示で Bootstrap 1 本に集約済み（旧 5 API は走らない）。
          apiCount:       1,
          msgs:           data.counts.messages,
          phases:         data.counts.phases,
          trans:          data.counts.transitions,
          resourceCount:  res.count,
          transferredKB:  res.transferredKB,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        // cache 表示済みなら、裏 revalidate の失敗で画面を壊さない（既存表示を維持）。
        if (!cached) setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [oaId, workId]);

  // ────────────────────────────────────────────────
  // chain continuation メッセージ (= 他メッセージの next_message_id から指されているもの)
  // を一覧から除外するための ID Set。
  //
  // 背景: 編集画面で chain を組んだ場合、2 通目以降は親と同じ phase_id を持つ
  //   トップレベル行として DB に作成される (= messageApi.create 経由)。
  //   一覧側で chain continuation を除外しないと、ユーザー体験的には「1 つの塊」のはずが
  //   「複数の独立メッセージ」に見えてしまう。
  //
  // 純関数 helper は _list-helpers.ts に切り出し (= テスト容易性のため)。
  // runtime / webhook には一切触らない (Phase 2a スコープ)。
  // ────────────────────────────────────────────────
  const chainContinuationIds = collectChainContinuationIds(messages);
  // 一覧の件数 (タブ / フッター) はチェーン継続を除いた「先頭メッセージ」基準で数える。
  const headMessageCount = messages.length - chainContinuationIds.size;

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "メッセージ" },
    ]} />
  );

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ</h2></div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
              <div className="skeleton" style={{ width: 80,  height: 14 }} />
              <div className="skeleton" style={{ flex: 1,   height: 14 }} />
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  // ── タブ共通スタイル (work detail 配下の他タブと揃える) ──
  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 600,
    color: activeTab === tab ? "#06C755" : "#6b7280",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid #06C755" : "2px solid transparent",
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap" as const,
  });

  return (
    <>
      <ViewerBanner role={role} />
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{activeTab === "welcome" ? "共通設定" : "メッセージ"}</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {activeTab === "welcome"
              ? "作品全体で共通して使う設定を管理します"
              : "フェーズごとに送信するメッセージを管理します"}
          </p>
        </div>
        {activeTab === "messages" && canEdit && (
          <Link href={`/oas/${oaId}/works/${workId}/messages/new`} className="btn btn-primary">
            ＋ メッセージを追加
          </Link>
        )}
        {/* あいさつメッセージはタブ内（カード内）で設定・編集・解除する（画面遷移しない）。
            ヘッダーのアカウント情報画面への遷移ボタンは廃止。 */}
      </div>

      {/* ── タブバー ── */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border-light)",
        marginBottom: 20,
        gap: 0,
      }}>
        <button type="button" style={tabStyle("messages")} onClick={() => setActiveTab("messages")}>
          メッセージ
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: activeTab === "messages" ? "#dcfce7" : "#f3f4f6",
            color: activeTab === "messages" ? "#166534" : "#9ca3af",
            borderRadius: 8, padding: "2px 8px",
          }}>
            {headMessageCount}
          </span>
        </button>
        <button type="button" style={tabStyle("welcome")} onClick={() => setActiveTab("welcome")}>
          共通設定
          {savedItems.length > 0 ? (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: activeTab === "welcome" ? "#dcfce7" : "#f3f4f6",
              color: activeTab === "welcome" ? "#166534" : "#9ca3af",
              borderRadius: 8, padding: "2px 8px",
            }}>設定済み</span>
          ) : (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: "#fef2f2", color: "#dc2626",
              borderRadius: 8, padding: "2px 8px",
            }}>未設定</span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          タブ: あいさつメッセージ
      ══════════════════════════════════════════════ */}
      {activeTab === "welcome" && (
        <div style={{ maxWidth: 680 }}>
          {/* この画面の使い方（共通設定の上部に表示）。あいさつメッセージ＋デフォルト設定の概要。 */}
          <div style={{ marginBottom: 24 }}>
            <HelpAccordion items={[
              { title: "あいさつメッセージ", points: [
                "友だち追加時に送信するメッセージと、その後の動作を設定できます",
                "「はじめる」と送る前に自動で届く、シナリオ開始前の一度きりのメッセージです",
                "未設定（空欄）のときは、友だち追加時に何も送信されません（デフォルト文は送信されません）",
                "OA Manager 側のあいさつメッセージが ON だと二重送信になる可能性があるため、Whale Studio 側で管理する場合は OA Manager 側を OFF にしてください",
              ]},
              { title: "デフォルト設定", points: [
                "作品全体にあらかじめ適用する初期値・挙動（途中再開など）を設定できます",
              ]},
            ]} />
          </div>

          {/* あいさつメッセージ（作品単位）。welcome_wait のときだけ下のあいさつ設定が有効。 */}
          <div className="card" style={{ padding: "20px 24px", marginBottom: 24 }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", margin: "0 0 4px" }}>
              あいさつメッセージ
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px", lineHeight: 1.7 }}>
              友だち追加（フォロー）された直後の挙動を作品単位で選べます。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {([
                { value: "welcome_wait", label: "あいさつメッセージを送って「はじめる」を待つ" },
                { value: "auto_start",   label: "すぐにシナリオを開始する" },
                { value: "none",         label: "何もしない" },
              ] as const).map(({ value, label }) => (
                <label key={value} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  fontSize: 13, color: "#374151", cursor: canEdit ? "pointer" : "default",
                }}>
                  <input
                    type="radio"
                    name="follow_action"
                    value={value}
                    checked={followAction === value}
                    disabled={!canEdit || savingFollow}
                    onChange={() => changeFollowAction(value)}
                    style={{ marginTop: 2 }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {followAction === "auto_start" && (
              <p style={{ fontSize: 12, color: "#6b7280", margin: "12px 0 0", lineHeight: 1.7 }}>
                この設定では友だち追加直後に本編が始まるため、あいさつメッセージは送信されません。
              </p>
            )}
            {followAction === "none" && (
              <p style={{ fontSize: 12, color: "#6b7280", margin: "12px 0 0", lineHeight: 1.7 }}>
                友だち追加時には何も送信されません。
              </p>
            )}
            {followAction === "welcome_wait" && savedItems.length === 0 && (
              <p style={{ fontSize: 12, color: "#b45309", margin: "12px 0 0", lineHeight: 1.7 }}>
                あいさつメッセージが未設定（空欄）のため、友だち追加時には何も送信されません。送信したい場合は下であいさつメッセージを設定してください。
              </p>
            )}
          </div>

          {/* 現在の設定（あいさつメッセージ）。「はじめる」を待つモードのときのみ表示・編集可能。 */}
          {followAction === "welcome_wait" ? (
          <div className="card" style={{ padding: "20px 24px" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                  あいさつメッセージ（最大{WELCOME_MESSAGES_MAX}件）
                </span>
                {savedItems.length > 0 ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#166534",
                    background: "#dcfce7", padding: "1px 8px", borderRadius: 10,
                    border: "1px solid #bbf7d0",
                  }}>設定済み</span>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#dc2626",
                    background: "#fef2f2", padding: "1px 8px", borderRadius: 10,
                    border: "1px solid #fecaca",
                  }}>未設定</span>
                )}
              </div>
            </div>

            {/* OA Manager 側との二重送信に関する注意書き（ニュートラル表示） */}
            <div style={{
              background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
              padding: "10px 14px", marginBottom: 16,
              fontSize: 12, color: "#6b7280", lineHeight: 1.7,
            }}>
              LINE Official Account Manager 側のあいさつメッセージが ON の場合、メッセージが二重で
              送信される可能性があります。Whale Studio 側で管理する場合は、OA Manager 側の
              あいさつメッセージを OFF にしてください。
            </div>

            {(() => {
              const validation = validateWelcomeItems(welcomeItems);
              const startTrigger = getStartTriggerFromPhases(phases);
              const dirty = JSON.stringify(welcomeItems) !== JSON.stringify(savedItems);
              const atMax = welcomeItems.length >= WELCOME_MESSAGES_MAX;
              return (
                <>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px", lineHeight: 1.7 }}>
                    友だち追加時、または開始前の案内で送信されるメッセージです。最大{WELCOME_MESSAGES_MAX}件まで設定できます。
                  </p>

                  {welcomeItems.length === 0 ? (
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "20px", textAlign: "center", marginBottom: 12 }}>
                      <p style={{ fontWeight: 700, fontSize: 13, color: "#111827", margin: "0 0 4px" }}>あいさつメッセージは送信されません。</p>
                      <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.7 }}>「テキストを追加」または「画像を追加」で設定できます。</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
                      {welcomeItems.map((item, i) => (
                        <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>
                              {item.type === "text" ? `テキスト ${i + 1}` : `画像 ${i + 1}`}
                            </span>
                            {canEdit && (
                              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                <button type="button" onClick={() => moveItem(i, "up")} disabled={i === 0} aria-label="上へ移動" style={reorderBtn(i === 0)}>▲</button>
                                <button type="button" onClick={() => moveItem(i, "down")} disabled={i === welcomeItems.length - 1} aria-label="下へ移動" style={reorderBtn(i === welcomeItems.length - 1)}>▼</button>
                                <button type="button" onClick={() => removeItem(i)} aria-label="削除" style={{ ...reorderBtn(false), color: "#dc2626" }}>✕</button>
                              </span>
                            )}
                          </div>
                          {item.type === "text" ? (
                            <>
                              <textarea
                                value={item.text}
                                onChange={(e) => updateItem(i, { ...item, text: e.target.value })}
                                readOnly={!canEdit}
                                maxLength={WELCOME_TEXT_MAX}
                                rows={4}
                                placeholder="例：はじめまして！この物語体験へようこそ。"
                                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, lineHeight: 1.7, border: "1.5px solid #e5e7eb", borderRadius: 10, resize: "vertical", color: "#111827" }}
                              />
                              <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0" }}>{item.text.length} / {WELCOME_TEXT_MAX}</p>
                            </>
                          ) : (
                            <ImageUploadField
                              value={item.imageUrl}
                              onChange={(url) => updateItem(i, { ...item, imageUrl: url })}
                              readOnly={!canEdit}
                              previewShape="rect"
                              previewAlt="あいさつ画像プレビュー"
                            />
                          )}

                          {/* 送信前の待機時間。1通目は reply 即時送信のため disabled・0 固定。 */}
                          <div style={{ marginTop: 10 }}>
                            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
                              送信前の待機時間
                            </label>
                            <select
                              value={i === 0 ? 0 : (item.delaySeconds ?? 0)}
                              onChange={(e) => updateItemDelay(i, Number(e.target.value))}
                              disabled={!canEdit || i === 0}
                              style={{ padding: "6px 10px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", background: i === 0 ? "#f3f4f6" : "#fff" }}
                            >
                              {Array.from({ length: WELCOME_DELAY_MAX_SECONDS + 1 }, (_, s) => (
                                <option key={s} value={s}>{s} 秒</option>
                              ))}
                            </select>
                            <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0", lineHeight: 1.6 }}>
                              {i === 0 ? "1通目は即時送信されます。" : "前のメッセージ送信後に待つ秒数です。"}
                            </p>
                          </div>

                          {validation.itemErrors[i] && (
                            <p style={{ fontSize: 12, color: "#dc2626", margin: "6px 0 0" }}>{validation.itemErrors[i]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canEdit && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                      <button type="button" className="btn btn-ghost" onClick={addTextItem} disabled={atMax}>＋ テキストを追加</button>
                      <button type="button" className="btn btn-ghost" onClick={addImageItem} disabled={atMax}>＋ 画像を追加</button>
                    </div>
                  )}
                  {atMax && (
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px" }}>あいさつメッセージは最大{WELCOME_MESSAGES_MAX}件までです。</p>
                  )}

                  <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, lineHeight: 1.7 }}>
                    {startTrigger ? (
                      <>
                        <span style={{ color: "#374151" }}>最後のメッセージに「{startTrigger}」の開始クイックリプライが付きます。</span><br />
                        <span style={{ color: "#6b7280" }}>画像が最後の場合も、その画像に開始クイックリプライが付きます。</span>
                      </>
                    ) : (
                      <span style={{ color: "#b45309" }}>開始キーワードが未設定のため、開始クイックリプライは表示されません。</span>
                    )}
                    <br />
                    <span style={{ color: "#6b7280" }}>2通目以降は設定した待機時間後に送信されます。</span>
                  </div>

                  {/* push 送信になる旨の補足（待機時間を設定したときだけ控えめに表示）。 */}
                  {welcomeItems.some((it, idx) => idx > 0 && (it.delaySeconds ?? 0) > 0) && (
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 12px", lineHeight: 1.6 }}>
                      待機時間を設定したメッセージは、LINEの追加送信として送られます。
                    </p>
                  )}

                  {welcomeError && (
                    <p style={{ fontSize: 12, color: "#dc2626", margin: "0 0 12px" }}>{welcomeError}</p>
                  )}

                  {canEdit && (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button type="button" className="btn btn-primary" onClick={saveWelcomeMessages} disabled={welcomeSaving || !dirty || !validation.ok}>
                        {welcomeSaving ? "保存中..." : "保存する"}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          ) : null}

          {/* デフォルト設定（作品単位）。共通設定の一部として あいさつメッセージ の下に表示（messages タブから移設）。 */}
          <div className="card" style={{ padding: "16px 24px", marginTop: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
              デフォルト設定
            </div>
            {/* checkbox → トグルスイッチ（見た目のみ・保存値/ハンドラ/API は不変）。 */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, opacity: canEdit ? 1 : 0.6 }}>
              <Switch
                checked={resumeEnabled}
                onChange={(v) => handleToggleResume(v)}
                disabled={!canEdit || savingResume}
                ariaLabel="途中再開を有効にする"
              />
              <span
                style={{ cursor: canEdit && !savingResume ? "pointer" : "default" }}
                onClick={() => { if (canEdit && !savingResume) handleToggleResume(!resumeEnabled); }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  途中再開を有効にする
                </span>
                {savingResume && (
                  <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 8 }}>保存中…</span>
                )}
                <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 1.6 }}>
                  ユーザーがフェーズの途中で開始トリガーを再送したときに、「途中から再開する / 最初からやり直す」を表示します。
                  無効にすると、途中状態があっても選択肢を出さず、最初から開始します。
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          タブ: メッセージ
      ══════════════════════════════════════════════ */}
      {activeTab === "messages" && (<>
      {/* デフォルト設定（作品単位）は「共通設定」タブへ移設済み。 */}

      {/* ── 初回ガイド（メッセージ未作成時） ── */}
      {!loading && messages.length === 0 && (
        <GuideCard
          message="メッセージや謎を追加して、体験の流れを作りましょう。フェーズに紐づけると、参加者に LINE メッセージとして届きます。"
        />
      )}

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { title: "この画面でできること", points: [
          "フェーズごとに送信するメッセージを管理します",
          "テキスト・画像・謎など複数の種別を設定できます",
          "フェーズに関係なく反応する「共通メッセージ」も設定できます",
        ]},
        { title: "共通メッセージとは", points: [
          "フェーズに関係なく、どの状態でも反応するメッセージです",
          "例：「ヒント」キーワードでヒントを返す、「ヘルプ」で案内を返す、「やり直し」でリセット案内を返す",
          "メッセージ追加画面で「送信タイミング」→「共通メッセージ」を選んで設定します",
          "通常メッセージとの違い：フェーズ設定が不要で、常に最優先で評価されます",
        ]},
        { title: "操作手順", points: [
          "「＋ メッセージを追加」→ フェーズとキャラクターを選んで内容を入力",
          "同一フェーズに複数ある場合は「順序」の小さい順に送信されます",
          "タイプが「謎」のメッセージも「順序」の通りに送信されます",
        ]},
        { title: "注意点", points: [
          "全フェーズ共通フェーズのメッセージはどのフェーズでもキーワードに反応します",
          "有効／無効の切り替えは各メッセージの編集画面から行います",
        ]},
      ]} />

      {/* ── メッセージ一覧（再設計: フェーズタブ → 警告サマリー → トリガー種別グループ → カード） ── */}
      {messages.length === 0 ? (
        <EmptyState phaseName="" canEdit={canEdit} addHref={`/oas/${oaId}/works/${workId}/messages/new`} />
      ) : (() => {
        const ALL = "all";
        const UNASSIGNED = "__unassigned";
        // フェーズタブ: すべて → 通常フェーズ(sort_order) → フェーズ未定 → 共通(全フェーズ共通=最後)
        const normalPhases = phases.filter((p) => p.phase_type !== "global");
        const globalPhase = phases.find((p) => p.phase_type === "global") ?? null;
        const tabs: PhaseTabItem[] = [
          { id: ALL, name: "すべて" },
          ...normalPhases.map((p) => ({ id: p.id, name: p.name })),
          ...(listView.hasUnassigned ? [{ id: UNASSIGNED, name: "フェーズ未定" }] : []),
          ...(globalPhase ? [{ id: globalPhase.id, name: "共通" }] : []),
        ];
        // 選択タブが消えた場合（フェーズ削除等）は「すべて」にフォールバック
        const effectiveId = tabs.some((t) => t.id === activePhaseId) ? activePhaseId : ALL;
        const activeTabName = tabs.find((t) => t.id === effectiveId)?.name ?? "";

        const filtered = listView.heads.filter((m) =>
          effectiveId === ALL ? true : listView.phaseKeyOf(m) === effectiveId,
        );
        const warningCount = filtered.filter((m) => (warningsByMsgId.get(m.id)?.length ?? 0) > 0).length;

        // 集計警告（1操作から6通以上連続の可能性）: フィルタ対象フェーズのうち該当するもの（既存挙動を維持）。
        const scopePhases = effectiveId === ALL ? phases : phases.filter((p) => p.id === effectiveId);
        const aggWarnPhaseNames = scopePhases
          .filter((p) => {
            const phaseMsgs = messages
              .filter((m) => m.phase?.id === p.id)
              .sort((a, b) =>
                a.sort_order - b.sort_order ||
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
                a.id.localeCompare(b.id),
              );
            return shouldShowSendUnitWarning(estimateMaxSendUnit(phaseMsgs), LINE_REPLY_MAX);
          })
          .map((p) => (p.phase_type === "global" ? "共通" : p.name));

        // 種別バッジ（クイックリプライ/応答メッセージ/チェックインのみ。条件なし/順送り・その他は非表示）。
        // classifyTrigger はこのバッジ表示専用。表示順・送信・遷移・応答判定には影響させない。
        const triggerBadgeOf = (m: MessageWithRelations) => {
          const key = classifyTrigger(m, triggerIdx);
          if (key === "sequential" || key === "other") return null;
          const meta = TRIGGER_GROUP_META[key];
          return { label: meta.label, icon: meta.icon, bg: meta.bg, color: meta.color };
        };

        // カードのフェーズピル表示名（共通/フェーズ未定 はタブ名に合わせる）。
        const phaseLabelOf = (m: MessageWithRelations): string | null => {
          const phaseKey = listView.phaseKeyOf(m);
          if (phaseKey === UNASSIGNED) return "フェーズ未定";
          const ph = phaseById.get(phaseKey);
          if (!ph) return null;
          return ph.phase_type === "global" ? "共通" : ph.name;
        };

        const renderCard = (m: MessageWithRelations) => {
          const phaseKey = listView.phaseKeyOf(m);
          const groupHeads = listView.headsByPhase.get(phaseKey) ?? [];
          const idx = groupHeads.findIndex((g) => g.id === m.id);
          return (
            <MessageCard
              key={m.id}
              msg={m}
              triggerBadge={triggerBadgeOf(m)}
              warnings={warningsByMsgId.get(m.id) ?? []}
              flowInfo={flowMap.get(m.id)}
              phaseName={phaseLabelOf(m)}
              isExpanded={expandedId === m.id}
              onToggleExpand={() => toggleExpand(m.id)}
              canEdit={canEdit}
              busy={busyMessageId === m.id}
              editHref={`/oas/${oaId}/works/${workId}/messages/${m.id}`}
              onDelete={() => handleDeleteMessage(m)}
              onToggleActive={() => handleToggleActive(m)}
              onReorder={(dir) => handleReorderMessage(m, dir, groupHeads)}
              canMoveUp={idx > 0}
              canMoveDown={idx >= 0 && idx < groupHeads.length - 1}
              allMessages={messages}
              transitions={transitions}
              phases={phases}
              msgById={msgById}
              phaseById={phaseById}
            />
          );
        };

        return (
          <>
            <PhaseTabs tabs={tabs} activeId={effectiveId} onChange={setActivePhaseId} />
            {warningCount > 0 && <WarningSummaryBar count={warningCount} />}
            {effectiveId !== ALL && (
              <PhaseFilterBar
                phaseName={activeTabName}
                count={filtered.length}
                onClear={() => setActivePhaseId(ALL)}
              />
            )}
            {aggWarnPhaseNames.length > 0 && (
              <div style={{ padding: "8px 14px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 9, fontSize: 11.5, lineHeight: 1.6, marginBottom: 14 }}>
                ⚠️ {aggWarnPhaseNames.join("・")} に、1回のプレイヤー操作から<strong>6通以上</strong>連続で送信される可能性があるメッセージがあります。LINE の Reply API で一度に返信できるのは最大5通までです。QR読み取り・クイックリプライ・テキスト入力・分岐・謎回答などプレイヤーのアクションを挟むと送信単位が区切られます。
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState
                phaseName={effectiveId === ALL ? "" : activeTabName}
                canEdit={canEdit}
                addHref={`/oas/${oaId}/works/${workId}/messages/new`}
              />
            ) : effectiveId === ALL ? (
              // 「すべて」: トリガー種別グループ（応答→QR→チェックイン→その他→条件なし）。各群内は送信順。
              ALL_TAB_GROUP_ORDER.map((key) => {
                const meta = TRIGGER_GROUP_META[key];
                const msgs = filtered
                  .filter((m) => classifyTrigger(m, triggerIdx) === key)
                  .sort((a, b) => (listView.orderIndex.get(a.id) ?? 0) - (listView.orderIndex.get(b.id) ?? 0));
                if (msgs.length === 0) return null;
                return (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 500, padding: "3px 11px", borderRadius: 6, color: meta.color, background: meta.bg }}>
                        {meta.icon} {meta.label}
                      </span>
                      <span style={{ fontSize: 11.5, color: "#B4B8BC" }}>{msgs.length}件</span>
                    </div>
                    {msgs.map(renderCard)}
                  </div>
                );
              })
            ) : (
              // 特定フェーズ / フェーズ未定 / 共通 タブ: そのスコープを送信順でフラット表示。
              (listView.headsByPhase.get(effectiveId) ?? []).map(renderCard)
            )}

            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", padding: "4px 4px 0" }}>
              合計 {headMessageCount} 件
            </div>
          </>
        );
      })()}

      </>)}
    </>
  );
}
