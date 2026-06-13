"use client";

// src/app/oas/[id]/works/[workId]/locations/_gps-panel.tsx
// GPSタブ — 既存の location 一覧UIを内部コンポーネント化したもの。

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { locationApi, getDevToken, fetchOaLiffId } from "@/lib/api-client";
import { buildLiffCheckinUrl } from "@/lib/liff/config";
import { buttonClass } from "@/components/shared";
import type { LocationWithTransition } from "@/types";

const MODE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  qr_only:    { label: "QR",      color: "#7c3aed", bg: "#f5f3ff" },
  gps_only:   { label: "GPS",     color: "#059669", bg: "#ecfdf5" },
  qr_and_gps: { label: "QR+GPS", color: "#2563eb", bg: "#eff6ff" },
};

type SortKey = "updated" | "name";

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

function actionSummary(loc: LocationWithTransition): string | null {
  const parts: string[] = [];
  if (loc.transition) parts.push(`遷移: ${loc.transition.label}`);
  if (loc.set_flags !== "{}") parts.push("Flags");
  if (loc.stamp_enabled) parts.push("スタンプ");
  return parts.length ? parts.join(" / ") : null;
}

interface LocStatSummary {
  location_id: string;
  total_visits: number;
  gps_success_rate?: number;
}

interface Props {
  oaId: string;
  workId: string;
}

export default function GpsPanel({ oaId, workId }: Props) {
  const [locations, setLocations] = useState<LocationWithTransition[]>([]);
  // 実機確認 URL は対象 OA の Oa.liffId のみを使う（NEXT_PUBLIC_LIFF_ID は使わない）。
  const [liffId, setLiffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQR, setExpandedQR] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const [locStats, setLocStats] = useState<Map<string, LocStatSummary>>(new Map());

  useEffect(() => { fetchOaLiffId(oaId).then(setLiffId).catch(() => setLiffId(null)); }, [oaId]);

  useEffect(() => {
    const token = getDevToken();
    (async () => {
      try {
        const data = await locationApi.list(token, workId);
        setLocations(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
    fetch(`/api/works/${workId}/location-stats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.success && json.data?.by_location) {
          const m = new Map<string, LocStatSummary>();
          for (const s of json.data.by_location) {
            m.set(s.location_id, s);
          }
          setLocStats(m);
        }
      })
      .catch(() => {});
  }, [workId]);

  const filteredLocations = useMemo(() => {
    let list = locations;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((l) =>
        l.name.toLowerCase().includes(q) || (l.description ?? "").toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ja");
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [locations, search, sortKey]);

  return (
    <div data-panel="gps">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>GPS チェックイン地点</h2>
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
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            + ロケーションを追加
          </Link>
        </div>
      </div>

      {locations.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="名前・説明で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200, padding: "8px 12px",
              border: "1px solid #d1d5db", borderRadius: 8,
              fontSize: 13, outline: "none",
            }}
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{
              padding: "8px 12px", border: "1px solid #d1d5db",
              borderRadius: 8, fontSize: 13, background: "#fff",
            }}
          >
            <option value="updated">更新日順</option>
            <option value="name">名前順</option>
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {filteredLocations.length} / {locations.length} 件
          </span>
        </div>
      )}

      {!liffId && (
        <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, color: "#92400e", fontSize: 13, marginBottom: 16 }}>
          このOAの LIFF ID が未設定のため QR コードを生成できません。
          <Link href={`/oas/${oaId}/settings/liff`} style={{ color: "#2563eb", textDecoration: "underline" }}>設定 → LIFF設定</Link>
          で LIFF ID を設定してください。
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>読み込み中...</div>}
      {error && <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626" }}>{error}</div>}

      {!loading && !error && locations.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, background: "#f9fafb", borderRadius: 12, border: "1px dashed #d1d5db", color: "#6b7280" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
          <p style={{ fontSize: 18, fontWeight: 600, color: "#374151", marginBottom: 8 }}>ロケーションを追加しましょう</p>
          <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
            GPS チェックインや QR スタンプラリーで使う地点を作成します。
            <br />地図上で場所を選び、半径を設定するだけで始められます。
          </p>
          <Link
            href={`/oas/${oaId}/works/${workId}/locations/new`}
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            + 最初のロケーションを作成
          </Link>
        </div>
      )}

      {!loading && filteredLocations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredLocations.map((loc) => {
            const liffUrl = liffId ? buildLiffCheckinUrl({ liffId, workId, locationId: loc.id }) : null;
            const isExpanded = expandedQR === loc.id;
            const stats = locStats.get(loc.id);
            const modeBadge = MODE_BADGE[loc.checkin_mode] ?? MODE_BADGE.qr_only;
            const action = actionSummary(loc);
            return (
              <div key={loc.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.05)", overflow: "hidden" }}>
                <Link
                  href={`/oas/${oaId}/works/${workId}/locations/${loc.id}`}
                  style={{ display: "block", padding: "16px 20px", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{loc.name}</span>
                        {!loc.is_active && (
                          <span style={{ fontSize: 10, background: "#f3f4f6", color: "#6b7280", padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>無効</span>
                        )}
                        <span style={{ fontSize: 10, background: modeBadge.bg, color: modeBadge.color, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                          {modeBadge.label}
                        </span>
                        {loc.radius_meters && loc.checkin_mode !== "qr_only" && (
                          <span style={{ fontSize: 10, color: "#9ca3af" }}>{loc.radius_meters}m</span>
                        )}
                      </div>
                      {loc.description && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{loc.description}</p>}

                      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "#9ca3af", flexWrap: "wrap" }}>
                        {action && <span>{action}</span>}
                        <span>CD: {loc.cooldown_seconds}秒</span>
                        {stats && <span style={{ color: stats.total_visits > 0 ? "#059669" : "#9ca3af", fontWeight: stats.total_visits > 0 ? 600 : 400 }}>チェックイン: {stats.total_visits}</span>}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      {liffUrl && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(liffUrl, "_blank"); }}
                          style={{
                            padding: "5px 10px", fontSize: 11, fontWeight: 600,
                            background: "#ecfdf5", color: "#059669",
                            border: "1px solid #86efac", borderRadius: 6, cursor: "pointer",
                          }}
                        >
                          テスト
                        </button>
                      )}
                      <span style={{ color: "#9ca3af", fontSize: 20 }}>›</span>
                    </div>
                  </div>
                </Link>

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

      {!loading && locations.length > 0 && filteredLocations.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
          「{search}」に一致するロケーションはありません
        </div>
      )}
    </div>
  );
}
