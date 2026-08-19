"use client";

// src/app/oas/[id]/works/[workId]/liff/[liffPageId]/page.tsx
// LIFF ページ編集画面 — 単一の LiffPageConfig (pageId) を編集する。
// ブロック追加・編集・削除・並び替え + プレビュー。

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { buttonClass, Accordion } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useLiffConfig, type LiffSaveStatus } from "@/hooks/useLiffConfig";
import { ViewerBanner } from "@/components/PermissionGuard";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import { LiffBlockItem } from "@/components/liff/LiffBlockItem";
import { LiffAddBlockModal } from "@/components/liff/LiffAddBlockModal";
import { LiffPreview } from "@/components/liff/LiffPreview";
import { LiffDevicePreviewLinks } from "@/components/liff/LiffDevicePreviewLinks";
import { LiffEditorProvider } from "@/components/liff/LiffEditorContext";
import { LiffWerewolfEditor } from "@/components/liff/LiffWerewolfEditor";
import { normalizeLiffPageType } from "@/types";

function SaveStatusIndicator({ status, dirty }: { status: LiffSaveStatus; dirty: boolean }) {
  if (status === "saving") return <span className="text-xs text-gray-500" aria-live="polite">保存中...</span>;
  if (status === "error")  return <span className="text-xs text-red-500" aria-live="polite">保存に失敗しました</span>;
  if (status === "saved")  return <span className="text-xs text-green-600" aria-live="polite">✓ 保存しました</span>;
  if (dirty)               return <span className="text-xs text-amber-600" aria-live="polite">未保存の変更があります</span>;
  return null;
}

export default function LiffPageEditor() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const liffPageId = params.liffPageId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading, isAdmin } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";
  const canPublish = isAdmin;

  const liff = useLiffConfig(workId, {
    pageId: liffPageId,
    onSuccess: (msg) => showToast(msg, "success"),
    onError: (msg) => showToast(msg, "error"),
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx || !liff.config) return;
    const newBlocks = [...liff.config.blocks];
    const [moved] = newBlocks.splice(dragIdx, 1);
    newBlocks.splice(idx, 0, moved);
    liff.updateConfigLocal({
      blocks: newBlocks.map((b, i) => ({ ...b, sort_order: i })),
    });
    setDragIdx(idx);
  }, [dragIdx, liff]);

  const handleDragEnd = useCallback(() => {
    // 並び替えは dragOver 時点でローカル draft に反映済み。
    // 永続化は最下部「すべての変更を保存」で行う（即時 API 呼び出しはしない）。
    setDragIdx(null);
  }, []);

  if (liff.loading || roleLoading) {
    return (
      <div className="p-6">
        <InlineWhaleLoader minHeight={200} />
      </div>
    );
  }

  const { config } = liff;
  if (!config) {
    return (
      <div className="px-6 pb-6">
        <Breadcrumb
          items={[
            { label: "作品一覧", href: `/oas/${oaId}/works` },
            { label: liff.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
            { label: "LIFF設定", href: `/oas/${oaId}/works/${workId}/liff` },
            { label: "編集" },
          ]}
        />
        <p className="text-sm text-red-500 mt-4">LIFF ページが見つかりませんでした。</p>
        <a
          href={`/oas/${oaId}/works/${workId}/liff`}
          className="inline-block mt-3 text-sm text-brand-ink underline"
        >
          一覧に戻る
        </a>
      </div>
    );
  }

  return (
    // ページ種別を問わず、コンテンツ/ブロック以外の周辺背景はグレーに統一（各設定カードは白）。
    <div className="px-6 pb-6 bg-gray-50 min-h-screen">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: liff.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF設定", href: `/oas/${oaId}/works/${workId}/liff` },
          { label: config.title?.trim() || "編集" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      <div className="flex items-center justify-between mb-2 h-4">
        <a
          href={`/oas/${oaId}/works/${workId}/liff`}
          className="text-xs text-brand-ink underline"
        >
          ← 一覧に戻る
        </a>
        <div className="flex items-center gap-3">
          <a
            href={`/oas/${oaId}/works/${workId}/liff/pages/${liffPageId}/submissions`}
            className="text-xs text-brand-ink underline"
          >
            回答結果を見る
          </a>
          <SaveStatusIndicator status={liff.saveStatus} dirty={liff.dirty} />
        </div>
      </div>

      {/* LINE メッセージ編集に倣い、左=編集フォーム / 右=固定プレビューの 2 カラム。
          ButtonLinkForm の遷移先ピッカー用に LiffEditorProvider で配下にページ/ロケーションを供給する。 */}
      <LiffEditorProvider
        oaId={oaId}
        workId={workId}
        pageId={liffPageId}
        workPublicId={config.work_public_id}
      >
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* 左カラム: ページ設定 → 作品メニュー → 表示ブロック → 実機で確認する(下部アコーディオン) */}
          <div className="flex-1 min-w-0 w-full">
            <LiffConfigHeader
              config={config}
              saving={liff.saving}
              readOnly={isReadOnly}
              canPublish={canPublish}
              onToggleEnabled={liff.toggleEnabled}
              onLocalChange={liff.updateConfigLocal}
              onUpdatePageType={liff.updatePageType}
              onUpdatePublishStatus={liff.updatePublishStatus}
            />

            {/* pageType="werewolf" は LiffPageBlock を使わない (専用テーブル WerewolfTitle 配下で
                管理する) ため、ブロック編集 UI ではなく WerewolfEditor を出す。 */}
            {normalizeLiffPageType(config.page_type) === "werewolf" ? (
              <LiffWerewolfEditor
                workId={workId}
                liffPageConfigId={config.id}
                readOnly={isReadOnly}
              />
            ) : (
              // 他のページ種別（FAQ / アンケート / ヒント等）と同じく、編集エリアを
              // グレー背景の上の白カードに揃える（「既存LIFF」だけ浮いて見えないようにする）。
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">表示ブロック</h2>
                  {!isReadOnly && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className={buttonClass({ variant: "primary", size: "sm" })}
                    >
                      + ブロック追加
                    </button>
                  )}
                </div>

                {/* PR-LB1: default 以外のページ種別では、ブロックは専用コンテンツの「下」に補足表示される。 */}
                {normalizeLiffPageType(config.page_type) !== "default" && (
                  <p className="text-[11px] text-gray-400 mb-3">
                    ページ種別ごとのメイン内容の下に、補足コンテンツとして表示されます。
                  </p>
                )}

                {config.blocks.length === 0 && (
                  <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
                    <p className="text-sm text-gray-500 mb-2">
                      ブロックがまだ追加されていません
                    </p>
                    <p className="text-xs text-gray-400">
                      「ブロック追加」ボタンから表示したい項目を選んでください
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {config.blocks.map((block, idx) => (
                    <LiffBlockItem
                      key={block.id}
                      block={block}
                      index={idx}
                      totalBlocks={config.blocks.length}
                      isEditing={liff.editingBlockId === block.id}
                      readOnly={isReadOnly}
                      onEdit={() => liff.setEditingBlockId(block.id)}
                      onCloseEdit={() => liff.cancelBlockEdit()}
                      onToggleEnabled={() => liff.toggleBlockEnabled(block)}
                      onDelete={() => liff.deleteBlock(block.id)}
                      onMove={(dir) => liff.moveBlock(idx, dir)}
                      onLocalChange={(patch) => liff.updateBlockLocal(block.id, patch)}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 実機で確認する — 最下部のアコーディオン（初期は閉じた状態） */}
            <div className="mt-6">
              <Accordion title="実機で確認する" defaultOpen={false}>
                <LiffDevicePreviewLinks
                  oaId={oaId}
                  workId={workId}
                  workPublicId={config.work_public_id}
                  pageId={config.id}
                  pagePublicId={config.public_id}
                  publishStatus={config.publish_status}
                  embedded
                />
              </Accordion>
            </div>
          </div>

          {/* 右カラム: 固定プレビュー（スクロール追従） */}
          <div className="w-full lg:w-auto lg:shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-500 mb-2">プレビュー</h2>
            <LiffPreview
              blocks={config.blocks}
              workId={workId}
              pageId={config.id}
              workTitle={liff.workTitle}
              title={config.title}
              config={config}
            />
          </div>
        </div>
      </LiffEditorProvider>

      {/* 最下部の一括保存バー（ブロックごとの保存・自動保存は廃止し、ここに統一）。
          ページ設定・デザイン設定・ページ種別・公開状態・ブロックの追加/編集/削除/並び替えは
          すべてローカル draft に保持され、このボタンでまとめて保存する。 */}
      {!isReadOnly && (
        <div className="sticky bottom-0 z-30 -mx-6 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
          <div className="text-xs">
            {liff.saveStatus === "error" ? (
              <span className="text-red-500">保存に失敗しました。変更は保持されています。もう一度お試しください。</span>
            ) : liff.saving ? (
              <span className="text-gray-500">保存中...</span>
            ) : liff.dirty ? (
              <span className="text-amber-600">未保存の変更があります</span>
            ) : (
              <span className="text-gray-400">すべての変更が保存されています</span>
            )}
          </div>
          <button
            onClick={() => void liff.saveAll()}
            disabled={liff.saving || !liff.dirty}
            className={
              buttonClass({ variant: "primary" }) +
              " disabled:opacity-50 disabled:cursor-not-allowed" +
              (liff.dirty && !liff.saving ? " ring-2 ring-brand/40" : "")
            }
          >
            {liff.saving ? "保存中..." : "すべての変更を保存"}
          </button>
        </div>
      )}

      {showAddModal && (
        <LiffAddBlockModal
          saving={liff.saving}
          onAdd={async (type) => {
            await liff.addBlock(type);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
