"use client";

// src/app/oas/[id]/works/[workId]/liff/page.tsx
// LIFF表示設定ページ — ブロック追加・編集・削除・並び替え + プレビュー
// 状態管理は useLiffConfig hook に集約し、UIはサブコンポーネントに分割

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useLiffConfig } from "@/hooks/useLiffConfig";
import { ViewerBanner } from "@/components/PermissionGuard";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import { LiffBlockItem } from "@/components/liff/LiffBlockItem";
import { LiffAddBlockModal } from "@/components/liff/LiffAddBlockModal";
import { LiffPreview } from "@/components/liff/LiffPreview";

export default function LiffConfigPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const liff = useLiffConfig(workId, {
    onSuccess: (msg) => showToast(msg, "success"),
    onError: (msg) => showToast(msg, "error"),
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // ── DnD ────────────────────────────────────────
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

  // ── Loading ────────────────────────────────────
  if (liff.loading || roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  const { config } = liff;
  if (!config) return null;

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: liff.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF表示設定" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      <LiffConfigHeader
        config={config}
        saving={liff.saving}
        readOnly={isReadOnly}
        onToggleEnabled={liff.toggleEnabled}
        onUpdateField={liff.updateConfigField}
        onLocalChange={(patch) => liff.updateConfigLocal(patch)}
      />

      {/* メインエリア: ブロックリスト + プレビュー */}
      <div className="flex gap-6 items-start">
        {/* 左: ブロックリスト */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">表示ブロック</h2>
            {!isReadOnly && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-1.5 bg-violet-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-violet-600 transition-colors"
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
                onCloseEdit={() => { liff.setEditingBlockId(null); liff.reload(); }}
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
        </div>

        {/* 右: プレビュー */}
        <div className="sticky top-6 shrink-0">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">プレビュー</h2>
          <LiffPreview blocks={config.blocks} title={config.title} />
        </div>
      </div>

      {/* 追加モーダル */}
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
