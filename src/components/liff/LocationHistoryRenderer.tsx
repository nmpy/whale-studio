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
import { LiffShareButton } from "./LiffShareButton";

export interface LocationHistoryRendererConfig {
  work_id:       string;
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

export function LocationHistoryRenderer({ config, lineUserId, preview }: Props) {
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
          `/api/liff/works/${config.work_id}/location-history?line_user_id=${encodeURIComponent(lineUserId)}`
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
  }, [config.work_id, lineUserId, preview]);

  return (
    <div className="liff-font min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]">
      <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
        {(config.title || config.description) && (
          <div className="space-y-1.5">
            {config.title && (
              <h1 className="text-[20px] leading-tight font-bold tracking-tight break-words">
                {config.title}
              </h1>
            )}
            {config.description && (
              <p className="text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
                {config.description}
              </p>
            )}
          </div>
        )}

        <HistorySection
          lineUserId={lineUserId}
          preview={preview}
          loading={loading}
          error={error}
          items={items}
        />

        {config.settings_json.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={config.settings_json} pageTitle={config.title || ""} preview={preview} />
          </div>
        )}
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
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
        <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
          LINE にログインすると、これまでのチェックイン履歴を確認できます。
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
        <p className="text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
        <p className="text-[14px] text-[color:var(--liff-danger,#E22B2B)] break-words">{error}</p>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
        <p className="text-3xl mb-2">📍</p>
        <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
          まだチェックイン履歴がありません
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <HistoryRow key={it.id} item={it} />
      ))}
    </ul>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const distance = formatDistance(item.distance_meters);
  return (
    <li className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="font-bold text-[15px] leading-snug break-words flex-1 min-w-0">
          {item.location_name}
        </span>
        <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border border-[color:var(--liff-border)] text-[color:var(--liff-secondary-text)] bg-[color:var(--liff-background)]">
          {METHOD_LABEL[item.checkin_method] ?? item.checkin_method}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-[color:var(--liff-secondary-text)] flex-wrap">
        <span>{formatDateTime(item.visited_at)}</span>
        {distance && (
          <>
            <span aria-hidden="true">·</span>
            <span>{distance}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="text-[color:var(--liff-line-green,#06C755)] font-bold">チェックイン成功</span>
      </div>
    </li>
  );
}
