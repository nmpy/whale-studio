"use client";

// src/app/oas/[id]/works/[workId]/liff/[liffPageId]/page.tsx
// LIFF ページ編集画面 — 単一の LiffPageConfig (pageId) を編集する。
// ブロック追加・編集・削除・並び替え + プレビュー。

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { buttonClass } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useLiffConfig, type LiffSaveStatus } from "@/hooks/useLiffConfig";
import { ViewerBanner } from "@/components/PermissionGuard";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import { LiffBlockItem } from "@/components/liff/LiffBlockItem";
import { LiffAddBlockModal } from "@/components/liff/LiffAddBlockModal";
import { LiffPreview } from "@/components/liff/LiffPreview";
import { LiffDevicePreviewLinks } from "@/components/liff/LiffDevicePreviewLinks";
import { LiffAnalyticsTab } from "@/components/liff/LiffAnalyticsTab";
import { LiffWerewolfEditor } from "@/components/liff/LiffWerewolfEditor";
import { normalizeLiffPageType } from "@/types";

function SaveStatusIndicator({ status }: { status: LiffSaveStatus }) {
  if (status === "idle") return null;
  const label =
    status === "pending" ? "未保存..." :
    status === "saving" ? "保存中..." :
    status === "saved"  ? "✓ 保存しました" :
    "保存に失敗しました";
  const cls =
    status === "error" ? "text-red-500" :
    status === "saved" ? "text-green-600" :
    "text-gray-500";
  return <span className={`text-xs ${cls}`} aria-live="polite">{label}</span>;
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
  const [activeTab, setActiveTab] = useState<"editor" | "analytics">("editor");

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

  const handleDragEnd = useCallback(async () => {
    setDragIdx(null);
    if (!liff.config || isReadOnly) return;
    await liff.reorderBlocks(liff.config.blocks);
  }, [liff, isReadOnly]);

  if (liff.loading || roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
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
            { label: "LIFF表示設定", href: `/oas/${oaId}/works/${workId}/liff` },
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
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: liff.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF表示設定", href: `/oas/${oaId}/works/${workId}/liff` },
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
          <SaveStatusIndicator status={liff.saveStatus} />
        </div>
      </div>

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

      <LiffDevicePreviewLinks
        workId={workId}
        workPublicId={config.work_public_id}
        pageId={config.id}
        pagePublicId={config.public_id}
        publishStatus={config.publish_status}
      />

      {/* タブ切り替え: 編集 / 計測 (work detail 配下の他タブと揃える) */}
      <div className="flex gap-0 border-b border-gray-200 mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("editor")}
          className={`px-[18px] py-2 text-[13px] font-semibold transition-colors border-b-2 whitespace-nowrap ${
            activeTab === "editor"
              ? "border-[#06C755] text-[#06C755]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          編集
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("analytics")}
          className={`px-[18px] py-2 text-[13px] font-semibold transition-colors border-b-2 whitespace-nowrap ${
            activeTab === "analytics"
              ? "border-[#06C755] text-[#06C755]"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          計測
        </button>
      </div>

      {activeTab === "analytics" ? (
        <LiffAnalyticsTab workId={workId} pageId={liffPageId} />
      ) : (
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0">
          {/* pageType="werewolf" は LiffPageBlock を使わない (専用テーブル WerewolfTitle 配下で
              管理する) ため、ブロック編集 UI ではなく WerewolfEditor を出す。 */}
          {normalizeLiffPageType(config.page_type) === "werewolf" ? (
            <LiffWerewolfEditor
              workId={workId}
              liffPageConfigId={config.id}
              readOnly={isReadOnly}
            />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">表示ブロック</h2>
                {!isReadOnly && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className={buttonClass({ variant: "primary", size: "sm" })}
                  >
                    + ブロック追加
                  </button>
                )}
              </div>

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
                    saving={liff.saving}
                    onEdit={() => liff.setEditingBlockId(block.id)}
                    onCloseEdit={() => liff.cancelBlockEdit()}
                    onSave={liff.updateBlock}
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
            </>
          )}
        </div>

        <div className="sticky top-6 shrink-0">
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
