// src/app/billing/success/page.tsx
// Stripe Checkout 成功後の戻り先ページ。
//
// 実際のプラン反映は webhook (checkout.session.completed) で行うため、
// このページは「決済が完了しました」の案内のみを表示する。
// session_id は表示用に受け取るだけで、ここで DB を更新しない (= webhook を正とする)。

import Link from "next/link";

export const dynamic = "force-dynamic";

export default function BillingSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = searchParams.session_id ?? "";

  return (
    <div style={{
      maxWidth: 520,
      margin:   "0 auto",
      padding:  "48px 20px 64px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize:     48,
        marginBottom: 16,
      }}>
        🎉
      </div>
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
