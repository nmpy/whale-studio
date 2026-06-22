"use client";

// src/app/oas/[id]/settings/_quota-usage-card.tsx
// 「月間メッセージ使用状況」カード。OA の今月の LINE push 通数枠を表示する（時間差メッセージ = push の通数消費の可視化）。
// 70% 注意 / 90% 警告 / 100% 送信失敗リスク を色分け表示。取得失敗・上限なしも安全に表示する。

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { OaQuotaUsage, QuotaLevel } from "@/lib/line-quota";

const LEVEL_STYLE: Record<QuotaLevel, { bg: string; border: string; color: string }> = {
  ok:        { bg: "#f8fafc", border: "#e2e8f0", color: "#475569" },
  notice:    { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
  warn:      { bg: "#fffbeb", border: "#fde68a", color: "#92400e" },
  over:      { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  unlimited: { bg: "#f8fafc", border: "#e2e8f0", color: "#475569" },
  unknown:   { bg: "#f8fafc", border: "#e2e8f0", color: "#64748b" },
};

function levelMessage(u: OaQuotaUsage): string | null {
  switch (u.level) {
    case "notice": return "無料枠の70%に達しました。予約済みの時間差メッセージを含めると、上限に近づく可能性があります。";
    case "warn":   return "無料枠の90%に達しました。これ以上の push 配信は送信できなくなる可能性があります。";
    case "over":   return "今月の送信上限に達しています。無料枠を超えると LINE 側で送信できない場合があります。コミュニケーションプランでは追加メッセージ配信ができないため、LINE公式アカウント側でプラン変更や追加メッセージ設定をご確認ください。";
    default:       return null;
  }
}

export function QuotaUsageCard({ oaId }: { oaId: string }) {
  const [usage, setUsage] = useState<OaQuotaUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/oas/${oaId}/quota-usage`, { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => { if (alive) setUsage((json?.data ?? json) as OaQuotaUsage); })
      .catch(() => { if (alive) setUsage({ type: "unknown", limit: null, used: null, remaining: null, ratio: null, level: "unknown" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [oaId]);

  const style = usage ? LEVEL_STYLE[usage.level] : LEVEL_STYLE.unknown;
  const pct = usage?.ratio != null ? Math.round(usage.ratio * 100) : null;

  return (
    <div style={{ border: `1px solid ${style.border}`, background: style.bg, borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
        月間メッセージ使用状況（push 通数）
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: "#94a3b8" }}>読み込み中…</div>
      ) : !usage ? (
        <div style={{ fontSize: 12, color: "#94a3b8" }}>取得できませんでした</div>
      ) : usage.type === "unknown" ? (
        <div style={{ fontSize: 12, color: style.color }}>
          使用状況を取得できませんでした（LINE 側の一時的なエラーの可能性があります）。
        </div>
      ) : usage.type === "none" ? (
        <div style={{ fontSize: 13, color: style.color }}>
          今月 <strong>{usage.used ?? "—"}</strong> 通 送信済み（このアカウントは月間上限なし）。
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14, color: style.color, fontWeight: 600 }}>
            今月 <strong>{usage.used ?? "—"} / {usage.limit ?? "—"}</strong> 通 使用中
            {usage.remaining != null && <span style={{ fontWeight: 400 }}>（残り {usage.remaining} 通{pct != null ? ` ・ ${pct}%` : ""}）</span>}
          </div>
          {/* 使用率バー */}
          {usage.ratio != null && (
            <div style={{ height: 6, background: "#e5e7eb", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
              <div style={{ height: "100%", width: `${Math.min(100, Math.round(usage.ratio * 100))}%`, background: style.color, opacity: 0.85 }} />
            </div>
          )}
        </>
      )}

      {usage && levelMessage(usage) && (
        <div style={{ fontSize: 12, color: style.color, marginTop: 8, lineHeight: 1.6 }}>{levelMessage(usage)}</div>
      )}

      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, lineHeight: 1.6 }}>
        ※ 時間差メッセージ（予約送信）は push 配信のため通数を消費します。Reply（返信）は通数を消費しません。
        無料枠・追加メッセージ上限は LINE公式アカウント側の設定です（Whale Studio 側では変更しません）。
      </div>
    </div>
  );
}
