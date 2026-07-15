"use client";

// src/app/oas/[id]/locations/_summary-cards.tsx
// ロケーション運用の集計カード（read 専用 / GET /api/oas/[id]/locations/summary）。
// クリックで統合ログ（フィルタ付き）へ遷移。「今日」は JST 基準（API 側）。

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/api-client";
import { withWorkId } from "../_lib/work-context";

type Summary = {
  locationCount: number; gpsPointCount: number; qrPointCount: number; beaconTriggerCount: number;
  todaySuccessCount: number; todayFailedAttemptCount: number; todayBeaconEventCount: number;
  last24hSuccessCount: number; last24hFailedCount: number; last24hBeaconSentCount: number;
  lastEventAt: string | null;
};

function fmtJst(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function SummaryCards({ oaId, workIdFilter }: { oaId: string; workIdFilter: string | null }) {
  const [s, setS] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/oas/${oaId}/locations/summary`, { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setS(j.data); else setFailed(true); })
      .catch(() => setFailed(true));
  }, [oaId]);

  const logs = (q: string) => withWorkId(`/oas/${oaId}/locations/logs${q ? `?${q}` : ""}`, workIdFilter);

  if (failed) return null; // 集計失敗時は黙ってカード非表示（一覧は表示される）

  const cards: { label: string; value: number | undefined; sub?: string; href: string; accent?: boolean }[] = [
    { label: "チェックインポイント", value: s?.locationCount, sub: "登録地点数", href: logs("") },
    { label: "GPS 対応", value: s?.gpsPointCount, sub: "GPS を含む地点", href: logs("type=gps") },
    { label: "QR 対応", value: s?.qrPointCount, sub: "QR を含む地点", href: logs("type=qr") },
    { label: "Beacon トリガー", value: s?.beaconTriggerCount, sub: "登録トリガー数", href: logs("type=beacon") },
    { label: "今日の成功", value: s?.todaySuccessCount, sub: `直近24h: ${s?.last24hSuccessCount ?? "—"}`, href: logs("status=success"), accent: true },
    { label: "今日の失敗/未成功", value: s?.todayFailedAttemptCount, sub: `直近24h: ${s?.last24hFailedCount ?? "—"}`, href: logs("type=gps") },
    { label: "今日の Beacon 発火", value: s?.todayBeaconEventCount, sub: `直近24h sent: ${s?.last24hBeaconSentCount ?? "—"}`, href: logs("type=beacon") },
  ];

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`group rounded-card border bg-surface px-3.5 py-3 no-underline transition-all hover:-translate-y-px hover:shadow-card ${c.accent ? "border-brand/30" : "border-line hover:border-brand/30"}`}
          >
            <div className="text-[11px] font-semibold text-ink-3">{c.label}</div>
            <div className={`mt-0.5 font-round text-[26px] font-extrabold leading-none ${c.accent ? "text-brand-ink" : "text-ink"}`}>
              {c.value ?? "…"}
            </div>
            {c.sub && <div className="mt-1 text-[10px] text-ink-3">{c.sub}</div>}
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">最終ログ: {fmtJst(s?.lastEventAt ?? null)}（JST）・「今日」は JST 基準</p>
    </div>
  );
}
