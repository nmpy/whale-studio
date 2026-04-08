"use client";

// src/app/oas/[id]/works/[workId]/locations/print/page.tsx
// QR 一括印刷ページ

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { locationApi, workApi, getDevToken } from "@/lib/api-client";
import type { LocationWithTransition } from "@/types";

function buildLiffUrl(liffId: string, locationId: string, workId: string) {
  return `https://liff.line.me/${liffId}?location_id=${locationId}&work_id=${workId}`;
}

export default function LocationsPrintPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [locations, setLocations] = useState<LocationWithTransition[]>([]);
  const [workTitle, setWorkTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

  useEffect(() => {
    (async () => {
      try {
        const token = getDevToken();
        const [locs, work] = await Promise.all([
          locationApi.list(token, workId, { is_active: true }),
          workApi.get(token, workId),
        ]);
        setLocations(locs);
        setWorkTitle(work.title);
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [workId]);

  if (!liffId) {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "40px 16px", textAlign: "center" }}>
        <div style={{ padding: 24, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, color: "#92400e", fontSize: 14 }}>
          LIFF ID 未設定のため印刷用 QR を生成できません。<br />
          <code style={{ fontSize: 12 }}>NEXT_PUBLIC_LIFF_ID</code> を設定してください。
        </div>
        <Link href={`/oas/${oaId}/works/${workId}/locations`} style={{ display: "inline-block", marginTop: 16, fontSize: 14, color: "#2563eb" }}>
          ← ロケーション一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* ── 印刷時非表示のツールバー ── */}
      <div className="print-hide" style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <Link href={`/oas/${oaId}/works/${workId}/locations`} style={{ fontSize: 14, color: "#2563eb", textDecoration: "none" }}>← 戻る</Link>
          <button
            onClick={() => window.print()}
            style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            印刷する
          </button>
        </div>
        {loading && <p style={{ textAlign: "center", color: "#6b7280" }}>読み込み中...</p>}
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      </div>

      {/* ── 印刷コンテンツ ── */}
      {!loading && !error && locations.length > 0 && (
        <div className="print-area" style={{ maxWidth: 700, margin: "0 auto", padding: "0 16px" }}>
          {/* 印刷用タイトル */}
          <h1 className="print-only" style={{ display: "none", fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 24 }}>
            {workTitle} / チェックイン QR 一覧
          </h1>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {locations.map((loc) => {
              const url = buildLiffUrl(liffId, loc.id, workId);
              return (
                <div
                  key={loc.id}
                  className="qr-card"
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    pageBreakInside: "avoid",
                    breakInside: "avoid",
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 4 }}>{loc.name}</h3>
                  {loc.description && <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{loc.description}</p>}
                  <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
                    <QRCodeSVG value={url} size={140} level="M" />
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                    LINE で読み取り、チェックインしてください
                  </p>
                  <p style={{ fontSize: 9, color: "#9ca3af", wordBreak: "break-all", lineHeight: 1.4 }}>
                    {url}
                  </p>
                  <p style={{ fontSize: 8, color: "#d1d5db", marginTop: 4 }}>
                    ID: {loc.id.slice(0, 8)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && locations.length === 0 && (
        <div className="print-hide" style={{ maxWidth: 700, margin: "0 auto", padding: "40px 16px", textAlign: "center", color: "#6b7280" }}>
          有効なロケーションがありません
        </div>
      )}

      {/* ── 印刷用CSS ── */}
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          .print-only { display: block !important; }
          .print-area { max-width: none; padding: 0; }
          .qr-card { border: 1px solid #ccc !important; box-shadow: none; }
          body { background: #fff; }
          header, footer { display: none !important; }
        }
      `}</style>
    </>
  );
}
