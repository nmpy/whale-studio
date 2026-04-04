"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { WorkCard } from "@/components/WorkCard";
import { FriendAddSection } from "@/components/FriendAddSection";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import { trackBillingEvent } from "@/lib/billing-tracker";
import type { FriendAddSettings } from "@/types";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/event-tracker";
import { useTesterMode } from "@/hooks/useTesterMode";
import { WorksEmptyState } from "@/components/onboarding/WorksEmptyState";
import { TesterUpgradeCard } from "@/components/upgrade/TesterUpgradeCard";

/* ── スケルトンカード ─────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-light)",
      borderRadius: "var(--radius-md)",
      padding: "20px 22px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="skeleton" style={{ width: 56, height: 24, borderRadius: 12 }} />
        <div className="skeleton" style={{ width: 180, height: 18, flex: 1 }} />
        <div className="skeleton" style={{ width: 72, height: 30, borderRadius: 6 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {[80, 70, 90, 90].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 24, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}

/* ── メインページ ─────────────────────────────────────────────────────── */
export default function WorkListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const { showToast } = useToast();
  const sp = useIsMobile();
  const { role, isTester: isRoleTester } = useWorkspaceRole(oaId);
  const { isTester } = useTesterMode();

  const [oaTitle, setOaTitle]     = useState("");
  const [works, setWorks]         = useState<WorkListItem[]>([]);
  const [friendAdd, setFriendAdd] = useState<FriendAddSettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // tester ロールが作品上限（1件）に達しているか
  // loading 中は false（ちらつき防止）
  const testerAtLimit = isRoleTester && !loading && works.length >= 1;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list, fa] = await Promise.all([
        oaApi.get(token, oaId),
        workApi.list(token, oaId),
        friendAddApi.get(token, oaId).catch(() => null),  // 未設定でも 404 → null
      ]);
      setOaTitle(oa.title);
      setWorks(list);
      setFriendAdd(fa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const token = getDevToken();
    trackEvent("screen_view", { page: "/oas/[id]/works" }, { token, oa_id: oaId });
    trackEvent("flow_step",   { step: "works", source: "direct" }, { token, oa_id: oaId });
  // oaId 変化時のみ再実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oaId]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？\nキャラクター・フェーズ・メッセージもすべて削除されます。`)) return;
    try {
      await workApi.delete(getDevToken(), id);
      showToast(`「${title}」を削除しました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  const sorted = [...works].sort((a, b) => a.sort_order - b.sort_order);
  const activeCount = works.filter((w) => w.publish_status === "active").length;

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle }] : []),
          ]} />
          <h2>作品リスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {oaTitle ? `${oaTitle} の謎解きシナリオを管理します` : "謎解きシナリオを管理します"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* tester ロールには「プランを見る」リンクを常時表示 */}
          {isRoleTester && (
            <Link
              href="/pricing?source=header"
              onClick={() => trackBillingEvent("pricing_click_from_header", getDevToken(), "header")}
              style={{
                fontSize:       12,
                fontWeight:     600,
                color:          "var(--color-primary, #2F6F5E)",
                textDecoration: "none",
                padding:        "6px 12px",
                borderRadius:   "var(--radius-sm)",
                border:         "1px solid #b9ddd6",
                background:     "var(--color-primary-soft, #EAF4F1)",
                whiteSpace:     "nowrap",
              }}
            >
              🔓 プランを見る
            </Link>
          )}
          {!isTester && !isRoleTester && (
            <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost">
              ⚙ 設定
            </Link>
          )}
          {/* tester ロールが上限到達 → グレーアウトボタン */}
          {testerAtLimit ? (
            <button className="btn btn-primary" disabled style={{ opacity: 0.45, cursor: "not-allowed" }}>
              ＋ 作品を追加
            </button>
          ) : !isTester && !isRoleTester ? (
            <Link href={`/oas/${oaId}/works/new`} className="btn btn-primary">
              ＋ 作品を追加
            </Link>
          ) : isRoleTester && !testerAtLimit ? (
            /* tester で上限未到達 → 通常ボタン */
            <Link href={`/oas/${oaId}/works/new`} className="btn btn-primary">
              ＋ 作品を追加
            </Link>
          ) : null}
        </div>
      </div>

      <ViewerBanner role={role} />

      {/* tester ロールが上限到達 → アップグレード誘導バナー */}
      {testerAtLimit && <TesterUpgradeCard variant="banner" />}

      {/* テスターモード時の注意文 */}
      {isTester && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "var(--radius-md)",
          marginBottom: 16,
          fontSize: 12, color: "#b45309",
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
          <span>※ テスター環境のため、一部機能は制限されています。</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 統計サマリー ── */}
      {!loading && works.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: sp ? 12 : 10,
          marginBottom: 20,
          padding: sp ? "12px 14px" : "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          {[
            { label: "総作品数", value: works.length, color: "var(--text-primary)" },
            { label: "公開中", value: activeCount, color: "var(--color-success)" },
            {
              label: "総プレイヤー数",
              value: works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0).toLocaleString(),
              color: "var(--color-info)",
            },
          ].map((s, i, arr) => (
            <div key={s.label} style={{
              display: "flex", alignItems: "center", gap: 6,
              paddingRight: sp ? 0 : 18,
              // SP ではボーダーなし、PC では最後以外に右ボーダー
              borderRight: (!sp && i < arr.length - 1) ? "1px solid var(--border-light)" : "none",
            }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── コンテンツ ── */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : sorted.length === 0 ? (
        <WorksEmptyState oaId={oaId} isTester={isTester} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((w) => (
            <WorkCard
              key={w.id}
              work={w}
              oaId={oaId}
              basePath={`/oas/${oaId}/works`}
              role={role}
              onDelete={!isTester ? handleDelete : undefined}
            />
          ))}
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)", paddingTop: 4 }}>
            全 {works.length} 件
          </div>
        </div>
      )}

      {/* ── 友だち追加 ── */}
      {!loading && friendAdd?.add_url && (
        <FriendAddSection
          addUrl={friendAdd.add_url}
          changeHref={!isTester ? `/oas/${oaId}/friend-add` : undefined}
        />
      )}
    </>
  );
}
