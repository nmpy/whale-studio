"use client";

// src/components/liff/LocationHistoryRenderer.tsx
// LIFF Location モード — プレイヤー本人のチェックイン履歴を表示する。
//
// 仕様:
//   - LINE ユーザー ID が取れない / preview 中 / 履歴 0 件、いずれもクラッシュさせず案内表示にする
//   - データ取得は GET /api/liff/works/[workId]/location-history?line_user_id=...
//   - 取得失敗時は赤いインライン文を出すだけで画面破壊はしない
//   - 表示項目: 地点名 / チェックイン日時 / 種別 (QR / GPS / QR+GPS / Beacon) / 距離 (任意)
//   - 成功したチェックインのみが返ってくる前提（API 側で LocationVisit を読む = 成功記録のみ）

import { useEffect, useState } from "react";
import type { LiffPageConfigSettings } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import { LiffEmptyState } from "./ui";

export interface LocationHistoryRendererConfig {
  work_id:       string;
  /** 作品名。ヘッダーに表示する (新仕様)。未指定なら title にフォールバック */
  work_title?:   string | null;
  /** LIFF ページ名。本文側 h2 として表示する */
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

type CheckinMethod = "qr" | "gps" | "qr_and_gps" | "beacon";

interface HistoryItem {
  id:              string;
  location_id:     string;
  location_name:   string;
  visited_at:      string;
  checkin_method:  CheckinMethod;
  distance_meters: number | null;
}

interface Props {
  config: LocationHistoryRendererConfig;
  lineUserId?: string | null;
  /** プレビュー時はサンプルデータで描画する */
  preview?: boolean;
}

const METHOD_LABEL: Record<CheckinMethod, string> = {
  qr:         "QR",
  gps:        "GPS",
  qr_and_gps: "QR + GPS",
  beacon:     "Beacon",
};

// プレビュー用サンプル
const PREVIEW_ITEMS: HistoryItem[] = [
  {
    id: "preview-1",
    location_id: "loc-1",
    location_name: "渋谷スクランブル交差点",
    visited_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    checkin_method: "qr_and_gps",
    distance_meters: 12.4,
  },
  {
    id: "preview-2",
    location_id: "loc-2",
    location_name: "原宿駅前",
    visited_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    checkin_method: "qr",
    distance_meters: null,
  },
];

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function formatDistance(m: number | null): string | null {
  if (m === null || m === undefined || !isFinite(m)) return null;
  if (m < 1000) return `約 ${Math.round(m)} m`;
  return `約 ${(m / 1000).toFixed(1)} km`;
}

/** チェックイン履歴の取得 + 状態表示（ページ種別 location とブロック checkin_history で共有）。
 *  ページ全体の枠（liff-font ラッパー等）は持たず、リスト/空状態/読み込み/エラーだけを返す。
 *  - preview: サンプルデータを描画（カメラ/通信なし）
 *  - lineUserId 無し: ログイン案内
 *  - 履歴 0 件: 「まだチェックイン履歴がありません」
 *  - max_count: 表示件数の上限（任意） */
export function LocationHistoryList({
  workId, lineUserId, preview, maxCount,
}: {
  workId: string;
  lineUserId?: string | null;
  preview?: boolean;
  maxCount?: number;
}) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取得対象は preview=false かつ lineUserId が取れているときのみ
  useEffect(() => {
    if (preview) {
      setItems(PREVIEW_ITEMS);
      return;
    }
    if (!lineUserId) {
      setItems(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/liff/works/${workId}/location-history?line_user_id=${encodeURIComponent(lineUserId)}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setError(json.error?.message ?? "履歴の取得に失敗しました");
          setItems([]);
          return;
        }
        setItems(Array.isArray(json.data?.items) ? (json.data.items as HistoryItem[]) : []);
      } catch {
        if (cancelled) return;
        setError("通信エラーが発生しました");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [workId, lineUserId, preview]);

  const shown = maxCount && items ? items.slice(0, maxCount) : items;

  return (
    <HistorySection
      lineUserId={lineUserId}
      preview={preview}
      loading={loading}
      error={error}
      items={shown}
    />
  );
}

export function LocationHistoryRenderer({ config, lineUserId, preview }: Props) {
  return (
    <div className={`liff-font ${liffRootClass(config.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      {/* 画面内ヘッダーは廃止。document.title (= LIFF 上部バー) で文脈表現する。 */}
      <main className="liff-player-main pt-5 pb-24 flex flex-col gap-4">
        {/* 説明文（config.description）は LiffSinglePageRenderer のページ見出し側で 1 度だけ表示する。
            ここで再表示すると二重になるため出さない（document.title は LINE 上部バー）。 */}
        <LocationHistoryList workId={config.work_id} lineUserId={lineUserId} preview={preview} />
      </main>
    </div>
  );
}

function HistorySection({
  lineUserId, preview, loading, error, items,
}: {
  lineUserId?: string | null;
  preview?: boolean;
  loading: boolean;
  error: string | null;
  items: HistoryItem[] | null;
}) {
  // 未ログイン案内（preview 中は表示しない）
  if (!preview && !lineUserId) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[18px] px-4 py-6 text-center">
        <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
          LINE にログインすると、これまでのチェックイン履歴を確認できます。
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[18px] px-4 py-6 text-center">
        <p className="text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[18px] px-4 py-6 text-center">
        <p className="text-[14px] text-[color:var(--liff-danger,#E22B2B)] break-words">{error}</p>
      </div>
    );
  }

  if (!items || items.length === 0) {
    // 空状態は共通 LiffEmptyState（QR/GPS/Beacon いずれにも当てはまる中立文言を維持）。
    return <LiffEmptyState emoji="🗺️" text="まだチェックイン履歴がありません" />;
  }

  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((it) => (
        <HistoryRow key={it.id} item={it} />
      ))}
    </ul>
  );
}

// 場所ピン（LINE green・小）。装飾用ローカル SVG。
function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[color:var(--liff-line-green,#06C755)]">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
// 時計（muted・小）。装飾用ローカル SVG。
function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

// マップサムネイル「風」の装飾領域。実際の地図 / 外部 SDK / Google Maps iframe は使わない
// （履歴データに緯度経度がないため）。薄いグラデ + 道路風ライン + 緑ピンのみの純装飾。
function MapThumbnailDecoration() {
  return (
    <div
      className="relative h-[100px] overflow-hidden"
      aria-hidden="true"
      style={{ background: "linear-gradient(180deg,#EAF0EA 0%,#E1E9E0 100%)" }}
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background: [
            "linear-gradient(90deg, transparent 41%, rgba(255,255,255,0.85) 41%, rgba(255,255,255,0.85) 44%, transparent 44%)",
            "linear-gradient(0deg, transparent 64%, rgba(255,255,255,0.85) 64%, rgba(255,255,255,0.85) 67%, transparent 67%)",
            "linear-gradient(56deg, transparent 22%, rgba(241,237,216,0.8) 22%, rgba(241,237,216,0.8) 27%, transparent 27%)",
          ].join(","),
        }}
      />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <span
          className="flex w-5 h-5 items-center justify-center bg-[color:var(--liff-line-green,#06C755)] shadow-[0_3px_5px_rgba(0,0,0,0.25)]"
          style={{ borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)" }}
        >
          <span className="block w-[7px] h-[7px] rounded-full bg-white" style={{ transform: "rotate(45deg)" }} />
        </span>
      </span>
    </div>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const distance = formatDistance(item.distance_meters);
  return (
    <li className="bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border)] rounded-[10px] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <MapThumbnailDecoration />
      <div className="px-4 py-3.5 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-[3px]"><PinIcon /></span>
          <span className="flex-1 min-w-0 text-[15.5px] leading-snug break-words text-[color:var(--liff-primary-text)]">
            {item.location_name}
          </span>
          <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border border-[color:var(--liff-border)] text-[color:var(--liff-secondary-text)] bg-[color:var(--liff-background)]">
            {METHOD_LABEL[item.checkin_method] ?? item.checkin_method}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--liff-tertiary-text,#949494)] flex-wrap">
          <ClockIcon />
          <span>{formatDateTime(item.visited_at)}</span>
          {distance && (
            <>
              <span aria-hidden="true">·</span>
              <span>{distance}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="text-[color:var(--liff-line-green,#06C755)] font-medium">チェックイン成功</span>
        </div>
      </div>
    </li>
  );
}
