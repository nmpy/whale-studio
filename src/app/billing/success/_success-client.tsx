"use client";

// src/app/billing/success/_success-client.tsx
// Stripe Checkout 完了後の「反映待ち」UX（クライアント）。
//
// 設計方針:
//   - プラン反映の正は webhook (checkout.session.completed) → DB の Subscription。
//     このコンポーネントは Stripe の完了をフロントで直接信用せず、必ず DB 上の
//     Subscription を GET /api/oas/:id/subscription で確認してから「反映済み」と表示する。
//   - webhook は非同期（通常 1〜2 分）。戻った直後は未反映の可能性があるため、
//     3〜5 秒間隔でポーリングし、その間は「プランを反映中です」と表示する。
//   - 反映検知（status=active 相当 かつ plan が expected と一致）で「◯◯プランに
//     反映されました」+ 該当 OA を開く CTA を出す。
//   - 最大 ~90 秒でタイムアウト扱い（契約自体は完了している旨 + 手動再確認導線）。
//
// plan は内部キー（basic / standard / plus / pro）で受け取り、表示名は PLAN_LABELS で解決する
//   （plus = "Pro" / pro = "Pro Max"）。

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthHeaders } from "@/lib/api-client";
import { clearAllTtlCaches } from "@/lib/client-cache";
import { PLAN_LABELS, type PlanTier } from "@/lib/constants/plans";

// ── ポーリング設定 ───────────────────────────────────────────────────
const POLL_INTERVAL_MS = 4_000;          // 3〜5 秒間隔の中央値
const MAX_ATTEMPTS      = 23;            // 4s × 23 ≒ 92 秒で timeout（1〜2 分相当）

// full access とみなす Subscription ステータス（webhook は checkout 完了で "active" を入れる）。
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

type Phase = "checking" | "reflected" | "timeout";

export function SuccessClient({
  oaId,
  plan,
  sessionId,
}: {
  oaId: string;
  plan: PlanTier;
  sessionId: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");

  const planLabel = PLAN_LABELS[plan];

  // ── 反映確認（1 回分）: DB の Subscription を no-store で取得して判定 ──
  // 反映完了 = status が active 相当 かつ plan.name が expected（内部キー）と一致。
  const checkOnce = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/oas/${oaId}/subscription`, {
        headers: { ...getAuthHeaders() },
        cache:   "no-store",
      });
      if (!res.ok) return false;
      const json = await res.json();
      if (!json?.success || !json.data) return false;
      const sub      = json.data.subscription;
      const planData = json.data.plan;
      if (!sub || !planData) return false;
      return ACTIVE_STATUSES.has(sub.status) && planData.name === plan;
    } catch {
      return false;
    }
  }, [oaId, plan]);

  // ── ポーリングループ ────────────────────────────────────────────────
  // phase が "checking" の間だけ走る。"再確認する" は phase を "checking" に戻して再起動する。
  useEffect(() => {
    if (phase !== "checking") return;

    let cancelled = false;
    let attempts  = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loop() {
      if (cancelled) return;
      const reflected = await checkOnce();
      if (cancelled) return;

      if (reflected) {
        // 反映検知 → 古い plan-info / role の TTL キャッシュを破棄してから success 表示へ。
        // これで遷移先の管理画面が旧プランを引きずらない。
        clearAllTtlCaches();
        setPhase("reflected");
        return;
      }

      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        setPhase("timeout");
        return;
      }
      timer = setTimeout(loop, POLL_INTERVAL_MS);
    }

    // 初回は即確認（戻った時点で既に webhook 反映済みのケースを取りこぼさない）。
    timer = setTimeout(loop, 0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, checkOnce]);

  // ── 該当 OA のプラン詳細画面へ（遷移前にも保険でキャッシュ破棄） ──
  // 契約直後に一番確認したい「現在プラン・料金・契約状態」が見える plan ページへ着地させる。
  const openAccount = useCallback(() => {
    clearAllTtlCaches();
    router.push(`/oas/${oaId}/settings/plan`);
  }, [router, oaId]);

  const retry = useCallback(() => {
    setPhase("checking");
  }, []);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px 64px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>
        {phase === "reflected" ? "🎉" : phase === "timeout" ? "⏳" : "🎉"}
      </div>

      {/* ── 反映中（初期 / ポーリング中） ── */}
      {phase === "checking" && (
        <>
          <h1 style={headingStyle}>お申し込みありがとうございます！</h1>
          <p style={leadStyle}>
            プランを反映中です。通常 1〜2 分以内に反映されます。
            <br />
            この画面のままお待ちください。
          </p>
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 28px" }}>
            <Spinner />
          </div>
        </>
      )}

      {/* ── 反映検知後 ── */}
      {phase === "reflected" && (
        <>
          <h1 style={headingStyle}>{planLabel}プランに反映されました</h1>
          <p style={leadStyle}>
            プランの反映が完了しました。各機能をご利用いただけます。
          </p>
          <button type="button" onClick={openAccount} style={primaryButtonStyle}>
            このアカウントを開く
          </button>
        </>
      )}

      {/* ── タイムアウト（契約は完了・反映確認に時間がかかっている） ── */}
      {phase === "timeout" && (
        <>
          <h1 style={headingStyle}>契約は完了しています</h1>
          <p style={leadStyle}>
            反映確認に時間がかかっています。少し時間をおいてから再確認するか、
            管理画面で最新のプランをご確認ください。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginBottom: 24 }}>
            <button type="button" onClick={retry} style={primaryButtonStyle}>
              再確認する
            </button>
            <button type="button" onClick={openAccount} style={secondaryButtonStyle}>
              管理画面へ戻る
            </button>
          </div>
          <p style={noteStyle}>
            10 分以上経っても反映されない場合は、フィードバックフォームからお問い合わせください。
          </p>
        </>
      )}

      {/* session_id は問い合わせ時の手掛かりとして控えめに表示 */}
      {sessionId && (
        <p style={{ ...noteStyle, marginTop: 20, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
          session_id: {sessionId}
        </p>
      )}
    </div>
  );
}

// ── スピナー（依存追加なしの最小実装） ──────────────────────────────
function Spinner() {
  return (
    <span
      aria-label="反映を確認中"
      role="status"
      style={{
        display:      "inline-block",
        width:        28,
        height:       28,
        border:       "3px solid var(--border-light, #e5e7eb)",
        borderTopColor: "var(--color-primary, #2F6F5E)",
        borderRadius: "50%",
        animation:    "spin 0.8s linear infinite",
      }}
    />
  );
}

// ── インラインスタイル（既存 success ページの見た目に合わせる） ──────
const headingStyle: React.CSSProperties = {
  fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 800,
  color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 10,
};
const leadStyle: React.CSSProperties = {
  fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.8, marginBottom: 28,
};
const noteStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7,
};
const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "12px 28px", borderRadius: "var(--radius-sm)",
  background: "var(--color-primary, #2F6F5E)", color: "#fff",
  fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
};
const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "10px 24px", borderRadius: "var(--radius-sm)",
  background: "transparent", color: "var(--text-secondary)",
  fontSize: 13, fontWeight: 600, border: "1px solid var(--border-light)", cursor: "pointer",
};
