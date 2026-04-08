"use client";

// src/app/oas/[id]/works/[workId]/destinations/page.tsx
// 遷移先URL設定ページ — 薄いレイアウト層。
// 状態管理は useDestinations hook、UIはサブコンポーネントに委譲。

import { useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useDestinations } from "@/hooks/useDestinations";
import { ViewerBanner } from "@/components/PermissionGuard";
import { DestinationListItem } from "@/components/destination/DestinationListItem";
import { DestinationFormModal } from "@/components/destination/DestinationFormModal";
import type { LineDestination } from "@/types";

export default function DestinationsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const dest = useDestinations(workId, {
    onSuccess: (msg) => showToast(msg, "success"),
    onError: (msg) => showToast(msg, "error"),
  });

  const [showModal, setShowModal] = useState(false);
  const [editingDest, setEditingDest] = useState<LineDestination | null>(null);

  // ── Loading ────────────────────────────────────
  if (dest.loading || roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: dest.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "遷移先URL設定" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-gray-900">遷移先URL設定</h1>
        {!isReadOnly && (
          <button
            onClick={() => { setEditingDest(null); setShowModal(true); }}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-700 transition-colors"
          >
            + 遷移先を追加
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        リッチメニュー、画像メッセージ、カードタイプメッセージなどで再利用するURLを管理します。
      </p>

      {/* 案内ボックス */}
      {dest.destinations.length > 0 && dest.destinations.length <= 2 && (
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-4">
          <p className="text-xs text-gray-500">
            遷移先URLとは、LINE上の各タップ導線から開くURLの定義です。一度作成しておくと、メッセージ編集画面などから再利用しやすくなります。
          </p>
        </div>
      )}

      {/* 空状態 */}
      {dest.destinations.length === 0 && (
        <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
          <p className="text-3xl mb-3">🔗</p>
          <p className="text-sm font-medium text-gray-600 mb-1">遷移先URLはまだありません</p>
          <p className="text-xs text-gray-400 mb-4">
            まずは「開始画面」や「証拠一覧」など、LINEから開きたい遷移先を作成してください。
          </p>
          {!isReadOnly && (
            <button
              onClick={() => { setEditingDest(null); setShowModal(true); }}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-700 transition-colors"
            >
              + 最初の遷移先を追加
            </button>
          )}
          <div className="flex gap-2 justify-center mt-4">
            {["start", "evidence", "progress", "profile"].map((k) => (
              <span key={k} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{k}</span>
            ))}
          </div>
        </div>
      )}

      {/* 一覧 */}
      {dest.destinations.length > 0 && (
        <div className="space-y-3">
          {dest.destinations.map((d) => (
            <DestinationListItem
              key={d.id}
              destination={d}
              readOnly={isReadOnly}
              onEdit={() => { setEditingDest(d); setShowModal(true); }}
              onDelete={() => dest.remove(d.id)}
              onToggleEnabled={() => dest.toggleEnabled(d)}
            />
          ))}
        </div>
      )}

      {/* 追加/編集モーダル */}
      {showModal && (
        <DestinationFormModal
          workId={workId}
          saving={dest.saving}
          editingDestination={editingDest}
          onSave={async (data, editingId) => {
            if (editingId) {
              return dest.update(editingId, data);
            } else {
              return dest.add(data);
            }
          }}
          onClose={() => { setShowModal(false); setEditingDest(null); }}
        />
      )}
    </div>
  );
}
