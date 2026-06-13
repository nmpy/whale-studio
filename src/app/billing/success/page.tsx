// src/app/billing/success/page.tsx
// Stripe Checkout 成功後の戻り先ページ（Server Component）。
//
// プラン反映の正は webhook (checkout.session.completed) → DB の Subscription であり、
// このページは DB を直接更新しない（= webhook を正とする）。
//
// success_url に oaId / plan（内部キー）が載っていれば、反映確認 UX（SuccessClient）を
// マウントして DB 上の Subscription をポーリングし、反映を検知してから「反映済み」を表示する。
// query が不足している（旧 URL / 直アクセス等）場合は、従来どおりの静的案内へフォールバックする。

import Link from "next/link";
import { SuccessClient } from "./_success-client";
import { PLAN_TIER, type PlanTier } from "@/lib/constants/plans";

export const dynamic = "force-dynamic";

// success_url に載る内部キーのみを受理する（plus = Pro / pro = Pro Max）。
const VALID_PLANS = new Set<string>([
  PLAN_TIER.basic,
  PLAN_TIER.standard,
  PLAN_TIER.plus,
  PLAN_TIER.pro,
]);

export default function BillingSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string; oaId?: string; plan?: string };
}) {
  const sessionId = searchParams.session_id ?? "";
  const oaId      = searchParams.oaId ?? "";
  const planRaw   = searchParams.plan ?? "";

  // oaId と有効な plan が揃っていれば反映確認 UX を出す。
  if (oaId && VALID_PLANS.has(planRaw)) {
    return <SuccessClient oaId={oaId} plan={planRaw as PlanTier} sessionId={sessionId} />;
  }

  // ── フォールバック（query 不足 / 旧 URL 直アクセス）: 従来の静的案内 ──
  return (
    <div style={{
      maxWidth: 520,
      margin:   "0 auto",
      padding:  "48px 20px 64px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <h1 style={{
        fontSize:      "clamp(20px, 4vw, 26px)",
        fontWeight:    800,
        color:         "var(--text-primary)",
        letterSpacing: "-0.02em",
        marginBottom:  10,
      }}>
        お申し込みありがとうございます！
      </h1>
      <p style={{
        fontSize:     14,
        color:        "var(--text-secondary)",
        lineHeight:   1.8,
        marginBottom: 28,
      }}>
        決済が完了しました。プランの反映は通常 1〜2 分以内に行われます。
        <br />
        反映後、各機能をご利用いただけます。
      </p>

      <div style={{
        padding:      "16px 20px",
        background:   "var(--surface)",
        border:       "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        textAlign:    "left",
        marginBottom: 28,
        fontSize:     12,
        color:        "var(--text-muted)",
        lineHeight:   1.7,
      }}>
        反映までしばらく時間がかかる場合があります。10 分以上経っても反映されない場合は、
        フィードバックフォームからお問い合わせください。
        {sessionId && (
          <>
            <br /><br />
            <span style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
              session_id: {sessionId}
            </span>
          </>
        )}
      </div>

      <Link
        href="/oas"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          padding:        "12px 28px",
          borderRadius:   "var(--radius-sm)",
          background:     "var(--color-primary, #2F6F5E)",
          color:          "#fff",
          fontSize:       14,
          fontWeight:     700,
          textDecoration: "none",
        }}
      >
        アカウントリストへ戻る
      </Link>
    </div>
  );
}
