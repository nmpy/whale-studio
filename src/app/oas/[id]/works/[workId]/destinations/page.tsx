"use client";

// src/app/oas/[id]/works/[workId]/destinations/page.tsx
// 遷移先URL設定ページ — 薄いレイアウト層。
// 状態管理は useDestinations hook、UIはサブコンポーネントに委譲。
//
// Phase 4.2a: page.tsx のレイアウト層を Phase 0 トークン + shared/Button に揃える。
// useDestinations / DestinationListItem / DestinationFormModal / PlanRequiredCard /
// ViewerBanner / Breadcrumb / destinationApi / workApi / 認可ロジックは触らない。
// 削除 confirm 文言・toast 文言・add/update/remove/toggleEnabled・editingDest/showModal
// 遷移ロジック・テンプレ 4 button の key/文言/onClick も完全維持。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchOaLiffId } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { useDestinations } from "@/hooks/useDestinations";
import { ViewerBanner } from "@/components/PermissionGuard";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { DestinationListItem } from "@/components/destination/DestinationListItem";
import { DestinationFormModal } from "@/components/destination/DestinationFormModal";
import { Button } from "@/components/shared";
import type { LineDestination } from "@/types";

// テンプレートショートカット (= 既存挙動維持: クリックで空モーダルを開くだけ)
const TEMPLATE_SHORTCUTS = [
  { name: "開始画面",     key: "start" },
  { name: "証拠一覧",     key: "evidence" },
  { name: "進捗表示",     key: "progress" },
  { name: "プロフィール", key: "profile" },
] as const;

// ── ローカル共通: テンプレ pill (= rounded-full + brand トークン) ──
const templatePillClass =
  "inline-flex items-center rounded-full border border-brand/30 bg-surface px-3 py-1.5 " +
  "text-xs font-medium text-brand transition-colors hover:bg-brand-soft " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export default function DestinationsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  // プラン制限: destinations は Plus 以上が必要。
  // owner の「表示確認モード」を反映するため effectivePlan を使う。
  const { effectivePlan: planTier, loading: planLoading } = useAccessPreview(oaId);
  const planAccess = getPlanAccessState({ plan: planTier, featureKey: FEATURE.destinations });

  // プレビューの liff URL 生成用に対象 OA の Oa.liffId を解決する（env fallback なし）。
  // 既存の正規ヘルパー fetchOaLiffId を再利用し、独自の解決経路は増やさない。
  const [oaLiffId, setOaLiffId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!oaId) { setOaLiffId(null); return; }
    fetchOaLiffId(oaId)
      .then((id) => { if (!cancelled) setOaLiffId(id?.trim() || null); })
      .catch(() => { if (!cancelled) setOaLiffId(null); });
    return () => { cancelled = true; };
  }, [oaId]);

  const dest = useDestinations(workId, {
    onSuccess: (msg) => showToast(msg, "success"),
    onError: (msg) => showToast(msg, "error"),
  });

  const [showModal, setShowModal] = useState(false);
  const [editingDest, setEditingDest] = useState<LineDestination | null>(null);

  // ── Loading ────────────────────────────────────
  if (dest.loading || roleLoading) {
    return (
      <div className="px-6 pb-6">
        <InlineWhaleLoader minHeight={220} />
      </div>
    );
  }

  // プラン不足: 直 URL アクセス時にここで遮断する
  if (!planLoading && !planAccess.allowed) {
    return (
      <PlanRequiredCard
        oaId={oaId}
        workId={workId}
        featureKey={FEATURE.destinations}
        currentPlan={planTier}
        featureLabel="遷移先URL設定"
      />
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

      {/* ── ヘッダー ── */}
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          遷移先URL設定
        </h1>
        {!isReadOnly && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => { setEditingDest(null); setShowModal(true); }}
          >
            + 遷移先を追加
          </Button>
        )}
      </div>
      <p className="mb-1 text-[13px] text-ink-2">
        リッチメニュー、画像メッセージ、カードタイプメッセージ、クイックリプライなどで再利用するURLを管理します。
      </p>
      <p className="mb-6 text-[12px] text-ink-3">
        ここでURLを一元管理しておくと、各編集画面から「保存済みの遷移先」として選べるようになります。
      </p>

      {/* ── 案内ボックス (= 件数 1〜2 の時のみ、sky 系 情報トーン) ── */}
      {dest.destinations.length > 0 && dest.destinations.length <= 2 && (
        <div className="mb-4 rounded-field border border-sky/30 bg-sky-soft p-3 text-[12px] leading-[1.6] text-sky-ink">
          <p>
            <strong>おすすめ:</strong> よく使う遷移先（開始画面・証拠一覧・進捗表示など）を先に作成しておくと、メッセージやリッチメニューの編集時にすぐ選べて便利です。
          </p>
        </div>
      )}

      {/* ── 空状態 ── */}
      {dest.destinations.length === 0 && (
        <div className="rounded-card border-2 border-dashed border-line-2 bg-bg-tint p-10 text-center">
          <p className="mb-3 text-3xl" aria-hidden="true">🔗</p>
          <p className="mb-1 text-[13px] font-medium text-ink-2">遷移先URLはまだありません</p>
          <p className="mb-5 text-[12px] text-ink-3">
            まずはよく使う遷移先を作成しましょう。作成した遷移先は、メッセージ・リッチメニュー・クイックリプライの編集画面から選べるようになります。
          </p>

          {/* テンプレートショートカット (= 既存挙動維持: クリックで空モーダルを開く) */}
          {!isReadOnly && (
            <div className="mb-4 space-y-2">
              <p className="text-[11px] font-medium text-ink-3">よく使う遷移先を作成:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {TEMPLATE_SHORTCUTS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setEditingDest(null); setShowModal(true); }}
                    className={templatePillClass}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isReadOnly && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => { setEditingDest(null); setShowModal(true); }}
            >
              + カスタム遷移先を追加
            </Button>
          )}
        </div>
      )}

      {/* ── 一覧 (= DestinationListItem は別管理、props 完全維持) ── */}
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

      {/* ── 追加/編集モーダル (= DestinationFormModal は別管理、props 完全維持) ── */}
      {showModal && (
        <DestinationFormModal
          workId={workId}
          workPublicId={dest.workPublicId}
          liffId={oaLiffId}
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
