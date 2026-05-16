"use client";

// src/components/liff/WerewolfRenderer.tsx
//
// 人狼 / 配役閲覧モード — `/liff/w/[workPublicId]/p/[werewolfPagePublicId]` のメイン renderer。
//
// プレイヤーが直接この URL を開いた場合の画面 (= QR を使わず LIFF メニュー経由で来たとき)。
//
// 表示内容:
//   - プレイ予定タイトル一覧 (アコーディオン形式、配下に scheduled_at + 開始状態 + QR 案内)
//   - マイページ (Phase 3 で対応予定の案内のみ)
//
// 役職カード本体はここには出さない。プレイヤーが自分の配役を見るには GM から渡された QR を
// 読み込んで `/liff/r/[slotToken]` に遷移する必要がある。これによりサーバー側 gating と
// 合わせて他人の配役を盗み見できないようになっている。

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LiffPageConfigSettings } from "@/types";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";

export interface WerewolfRendererConfig {
  work_id?:            string;
  liff_page_config_id?: string;
  work_title?:   string | null;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

interface Props {
  config: WerewolfRendererConfig;
  preview?: boolean;
}

interface TitleListItem {
  id:           string;
  public_id:    string;
  title:        string;
  description:  string | null;
  scheduled_at: string | null;
  is_started:   boolean;
  player_count: number;
}

interface TitleListResponse {
  success: boolean;
  data?: {
    work_id:             string;
    liff_page_config_id: string;
    titles:              TitleListItem[];
  };
}

function formatScheduledAt(iso: string | null): string {
  if (!iso) return "日時未定";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "日時未定";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function WerewolfRenderer({ config, preview = false }: Props) {
  const settings = config.settings_json;
  const searchParams = useSearchParams();
  const isPreviewQuery = searchParams?.get("preview") === "1";
  const effectivePreview = preview || isPreviewQuery;

  const [titles, setTitles] = useState<TitleListItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config.work_id || !config.liff_page_config_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ liff_page_config_id: config.liff_page_config_id! });
        if (effectivePreview) qs.set("preview", "1");
        const res = await fetch(`/api/liff/works/${config.work_id}/werewolf/titles?${qs}`);
        const json = (await res.json()) as TitleListResponse;
        if (cancelled) return;
        if (json.success && json.data) {
          setTitles(json.data.titles);
        } else {
          setTitles([]);
        }
      } catch {
        if (!cancelled) setTitles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [config.work_id, config.liff_page_config_id, effectivePreview]);

  return (
    <div className={`liff-font ${liffRootClass(settings)} bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <div className="liff-player-main pt-2 pb-8 flex flex-col gap-5">
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(settings)}`}>
            {config.description}
          </p>
        )}

        {/* プレイ予定タイトル一覧 */}
        <section>
          <h2 className="text-[15px] font-bold mb-2 text-[color:var(--liff-primary-text)]">プレイ予定</h2>

          {loading ? (
            <div className="h-16 bg-[color:var(--liff-surface-subtle,#FAFAFA)] rounded-[12px] animate-pulse" />
          ) : !titles || titles.length === 0 ? (
            <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
              <p className="text-2xl mb-2" aria-hidden="true">🐺</p>
              <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
                プレイ予定がまだ登録されていません
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--liff-border)] border border-[color:var(--liff-border)] rounded-[12px] overflow-hidden bg-[color:var(--liff-surface)]">
              {titles.map((t) => (
                <TitleAccordion key={t.id} title={t} />
              ))}
            </ul>
          )}
        </section>

        {/* マイページ (Phase 3 placeholder) */}
        <section>
          <h2 className="text-[15px] font-bold mb-2 text-[color:var(--liff-primary-text)]">マイページ</h2>
          <div className="bg-[color:var(--liff-surface-subtle,#FAFAFA)] border border-dashed border-[color:var(--liff-border)] rounded-[12px] px-4 py-5 text-center">
            <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
              プレイ履歴は今後のアップデートで対応予定です。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── タイトル単位のアコーディオン ────────────────────────────────────────────
function TitleAccordion({ title }: { title: TitleListItem }) {
  const [open, setOpen] = useState(false);
  const scheduled = formatScheduledAt(title.scheduled_at);
  const isStarted = title.is_started;

  // 開始前はカード見出しを少しグレーアウト、ただし完全には消さない
  // (= 押せるが配役を見れない状態が分かるように)
  const labelCls = isStarted ? "text-[color:var(--liff-primary-text)]" : "text-[color:var(--liff-secondary-text)]";

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left px-4 py-3.5 min-h-[56px] active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[15px] font-bold leading-snug break-words ${labelCls}`}>
              {title.title}
            </span>
            <span
              className={[
                "text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0",
                isStarted
                  ? "border-[color:var(--liff-line-green,#06C755)] text-[color:var(--liff-line-green,#06C755)] bg-white"
                  : "border-[color:var(--liff-border)] text-[color:var(--liff-secondary-text)] bg-[color:var(--liff-surface-subtle,#FAFAFA)]",
              ].join(" ")}
            >
              {isStarted ? "開始済み" : "開始前"}
            </span>
          </div>
          <p className="text-[12px] text-[color:var(--liff-secondary-text)] mt-0.5">{scheduled}</p>
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[color:var(--liff-secondary-text)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-[color:var(--liff-border)]">
          {/* 注意文 */}
          <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2.5 mb-3">
            <p className="text-[11px] leading-[1.7] text-amber-800">
              ※ ゲーム内容は他言しないようにしてください。<br />
              他者の目に触れる場所に共有することを禁じます。
            </p>
          </div>
          {isStarted ? (
            <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
              GM から渡された QR コードを読み込むと、あなたの配役を確認できます。
            </p>
          ) : (
            <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
              ゲーム開始までお待ちください。<br />
              GM がゲームを開始すると、QR からあなたの配役を確認できます。
            </p>
          )}
        </div>
      )}
    </li>
  );
}
