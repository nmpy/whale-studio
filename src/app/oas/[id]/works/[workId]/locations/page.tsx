"use client";

// src/app/oas/[id]/works/[workId]/locations/page.tsx
// ロケーション一覧ページ（QR表示 + URLコピー導線付き）

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { locationApi, getDevToken } from "@/lib/api-client";
import type { LocationWithTransition } from "@/types";

function buildLiffUrl(liffId: string, locationId: string, workId: string) {
  return `https://liff.line.me/${liffId}?location_id=${locationId}&work_id=${workId}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        padding: "3px 10px", fontSize: 11, fontWeight: 600,
        background: copied ? "#dcfce7" : "#f3f4f6",
        color: copied ? "#16a34a" : "#374151",
        border: `1px solid ${copied ? "#86efac" : "#e5e7eb"}`,
        borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
        transition: "all 0.15s",
      }}
    >
      {copied ? "コピー済み" : "URLをコピー"}
    </button>
  );
}

export default function LocationsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [locations, setLocations] = useState<LocationWithTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQR, setExpandedQR] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await locationApi.list(getDevToken(), workId);
        setLocations(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [workId]);

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[
        { label: "OA一覧", href: "/oas" },
        { label: "作品", href: `/oas/${oaId}` },
        { label: "ロケーション" },
      ]} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>ロケーション</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {liffId && locations.length > 0 && (
            <Link
              href={`/oas/${oaId}/works/${workId}/locations/print`}
              style={{ padding: "8px 14px", background: "#f3f4f6", color: "#374151", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none", border: "1px solid #e5e7eb" }}
            >
              QR一括印刷
            </Link>
          )}
          <Link
            href={`/oas/${oaId}/works/${workId}/locations/new`}
            style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            + 新規作成
          </Link>
        </div>
      </div>

      {!liffId && (
        <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, color: "#92400e", fontSize: 13, marginBottom: 16 }}>
          LIFF ID が未設定のため QR コードを生成できません。<code style={{ fontSize: 11 }}>NEXT_PUBLIC_LIFF_ID</code> を設定してください。
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>読み込み中...</div>}
      {error && <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626" }}>{error}</div>}

      {!loading && !error && locations.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, background: "#f9fafb", borderRadius: 12, border: "1px dashed #d1d5db", color: "#6b7280" }}>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>ロケーションがまだありません</p>
          <p style={{ fontSize: 13 }}>ビーコンやQRコードと連動するチェックインポイントを作成しましょう</p>
        </div>
      )}

      {!loading && locations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {locations.map((loc) => {
            const liffUrl = liffId ? buildLiffUrl(liffId, loc.id, workId) : null;
            const isExpanded = expandedQR === loc.id;
            return (
              <div key={loc.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.05)", overflow: "hidden" }}>
                <Link
                  href={`/oas/${oaId}/works/${workId}/locations/${loc.id}`}
                  style={{ display: "block", padding: "16px 20px", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{loc.name}</span>
                        {!loc.is_active && (
                          <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>無効</span>
                        )}
                      </div>
                      {loc.description && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{loc.description}</p>}
                      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                        <span>{loc.beacon_uuid ? "Beacon" : "QR only"}</span>
                        <span>CD: {loc.cooldown_seconds}秒</span>
                        {loc.transition && <span>遷移: {loc.transition.label}</span>}
                        {loc.set_flags !== "{}" && <span>Flags</span>}
                      </div>
                    </div>
                    <span style={{ color: "#9ca3af", fontSize: 20, flexShrink: 0 }}>›</span>
                  </div>
                </Link>

                {/* QR + URL セクション */}
                {liffUrl && (
                  <div style={{ padding: "0 20px 16px", borderTop: "1px solid #f3f4f6" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                      <div style={{ flex: 1, fontSize: 11, color: "#3b82f6", wordBreak: "break-all", background: "#f0f9ff", padding: "6px 10px", borderRadius: 6 }}>
                        {liffUrl}
                      </div>
                      <CopyButton text={liffUrl} />
                      <button
                        type="button"
                        onClick={() => setExpandedQR(isExpanded ? null : loc.id)}
                        style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {isExpanded ? "QR閉じる" : "QR表示"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                        <QRCodeSVG value={liffUrl} size={160} level="M" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
