"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { bootstrapApi, messageApi, getDevToken } from "@/lib/api-client";
import { getCachedBootstrap, setCachedBootstrap, invalidateBootstrap } from "@/lib/admin-bootstrap-cache";
import { logAdminPerf, resourceSummary, maskId } from "@/lib/perf-client";
import { HelpAccordion } from "@/components/HelpAccordion";
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
  const [workTitle, setWorkTitle]       = useState("");
  // あいさつメッセージ / follow_action / 途中再開 などの「共通設定」は作品設定ページ
  // （/oas/[id]/works/[workId]/settings）へ移設済み。この画面はメッセージ管理に専念する。
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

  useEffect(() => {
    let cancelled = false;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Bootstrap レスポンスを各 state に反映する共通処理。
    function applyData(data: import("@/lib/api-client").MessagesBootstrapData) {
      setWorkTitle(data.work.title);
      // welcome_message / follow_action / resume_enabled は作品設定ページへ移設済み（ここでは使わない）。
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

  return (
    <>
      <ViewerBanner role={role} />
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>メッセージ</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            フェーズごとに送信するメッセージを管理します
          </p>
        </div>
        {canEdit && (
          <Link href={`/oas/${oaId}/works/${workId}/messages/new`} className="btn btn-primary">
            ＋ メッセージを追加
          </Link>
        )}
        {/* 共通設定（あいさつメッセージ等）は作品設定ページ（…/settings）へ移設済み。 */}
      </div>

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
    </>
  );
}
