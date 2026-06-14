"use client";

// src/app/oas/[id]/works/[workId]/liff/_HomeTab.tsx
//
// 「ホーム」タブ — 作品メニューのホーム画面の見せ方を編集する。
//   左: 詳細ページ (show_in_menu=true) の並び替え + 表示形式 (カード/コンパクト) 編集
//   右: 実機ホームと同じ LiffMenuHomeRenderer を sticky 表示 (ローカル変更を即時反映)
//
// 保存は明示「保存」ボタンでまとめて行う。settingsJson を壊さないよう、保存直前に
// getPage で最新 settings を取得し menu_order / menu_card_style だけ merge して PUT する。

// 管理画面ルートでは LIFF レイアウトの CSS がロードされていないため明示 import する。
import "@/app/liff/liff-font.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { buttonClass } from "@/components/shared";
import {
  liffConfigApi,
  getDevToken,
  type LiffPageSummary,
} from "@/lib/api-client";
import { LiffMenuHomeRenderer, type LiffMenuHomePage } from "@/components/liff/LiffMenuHomeRenderer";

type CardStyle = "card" | "compact";

interface Row {
  id:            string;
  title:         string | null;
  description:   string | null;
  pageType:      string;
  publicId:      string | null;
  isEnabled:     boolean;
  publishStatus: string;
  createdAt:     string;
  menuLabel:     string | null;
  menuIcon:      string | null;
  cardStyle:     CardStyle;
  /** 永続化されている menu_order（差分判定用。null は未設定）。 */
  origMenuOrder: number | null;
  /** 永続化されている表示形式（差分判定用）。 */
  origCardStyle: CardStyle;
}

interface Props {
  workId:     string;
  workTitle:  string;
  pages:      LiffPageSummary[];
  isReadOnly: boolean;
  /** 保存完了後に親へ再読込を促す。 */
  onSaved:    () => void;
}

/** 詳細ページ (show_in_menu) を menu_order → created_at 昇順で Row 化する。 */
function buildRows(pages: LiffPageSummary[]): Row[] {
  return pages
    .filter((p) => p.show_in_menu !== false)
    .slice()
    .sort((a, b) => {
      const ao = a.menu_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.menu_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .map((p) => ({
      id:            p.id,
      title:         p.title,
      description:   p.description,
      pageType:      p.page_type,
      publicId:      p.public_id ?? null,
      isEnabled:     p.is_enabled,
      publishStatus: p.publish_status,
      createdAt:     p.created_at,
      menuLabel:     p.menu_label ?? null,
      menuIcon:      p.menu_icon ?? null,
      cardStyle:     p.menu_card_style === "compact" ? "compact" : "card",
      origMenuOrder: p.menu_order ?? null,
      origCardStyle: p.menu_card_style === "compact" ? "compact" : "card",
    }));
}

const PUBLISH_BADGE: Record<string, string> = {
  draft:     "下書き",
  published: "公開中",
  archived:  "アーカイブ",
};

export function HomeTab({ workId, workTitle, pages, isReadOnly, onSaved }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>(() => buildRows(pages));
  const [saving, setSaving] = useState(false);

  // 親が pages を再取得したら Row を作り直す（保存後リセット含む）。
  useEffect(() => { setRows(buildRows(pages)); }, [pages]);

  const dirty = useMemo(
    () => rows.some((r, i) => r.origMenuOrder !== i || r.cardStyle !== r.origCardStyle),
    [rows],
  );

  const move = useCallback((index: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = prev.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const setCardStyle = useCallback((id: string, style: CardStyle) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cardStyle: style } : r)));
  }, []);

  const handleSave = useCallback(async () => {
    if (isReadOnly || saving || !dirty) return;
    setSaving(true);
    const token = getDevToken();
    // index = 望ましい menu_order。永続値と異なる or 表示形式が変わった行だけ保存する。
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.origMenuOrder !== i || r.cardStyle !== r.origCardStyle);
    try {
      for (const { r, i } of targets) {
        // settingsJson を上書きで壊さないよう、最新 settings を取得して merge する。
        const full = await liffConfigApi.getPage(token, workId, r.id);
        const merged = {
          ...(full.settings_json ?? {}),
          menu_order:      i,
          menu_card_style: r.cardStyle,
        };
        await liffConfigApi.updatePage(token, workId, r.id, { settings_json: merged });
      }
      showToast("ホームの表示設定を保存しました", "success");
      onSaved();
    } catch {
      showToast("保存に失敗しました。時間をおいて再度お試しください", "error");
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, saving, dirty, rows, workId, showToast, onSaved]);

  // ── プレビュー用ページ（ローカルの順序・形式・ラベルを即時反映）──
  const previewPages = useMemo<LiffMenuHomePage[]>(
    () => rows.map((r, i) => ({
      id:          r.id,
      public_id:   r.publicId,
      title:       r.title,
      description: r.description,
      page_type:   r.pageType,
      is_enabled:  r.isEnabled,
      settings_json: {
        show_in_menu:    true,
        menu_order:      i,
        menu_card_style: r.cardStyle,
        ...(r.menuLabel ? { menu_label: r.menuLabel } : {}),
        ...(r.menuIcon ? { menu_icon: r.menuIcon } : {}),
      },
      created_at: r.createdAt,
    })),
    [rows],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* 左: 編集 */}
      <div className="flex-1 min-w-0 w-full">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">ホームに表示するページ</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">並び順と表示形式を編集できます。右のプレビューに即時反映されます。</p>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              aria-busy={saving || undefined}
              className={buttonClass({ variant: "primary", size: "md" })}
            >
              {saving && <span className="spinner" aria-hidden="true" />}
              {saving ? "保存中..." : dirty ? "保存" : "保存済み"}
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
            <p className="text-sm text-gray-500 mb-2">ホームに表示する詳細ページがまだありません</p>
            <p className="text-xs text-gray-400">
              LIFFページ作成時に「このページを作品メニューのカードとして表示する」をオンにすると、ここに表示されます。
            </p>
          </div>
        ) : (
          <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {rows.map((r, i) => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                {/* 並び替え (上下ボタン) */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={isReadOnly || i === 0}
                    aria-label="上へ"
                    className="w-6 h-5 inline-flex items-center justify-center rounded border border-gray-200 text-gray-500 text-[11px] hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={isReadOnly || i === rows.length - 1}
                    aria-label="下へ"
                    className="w-6 h-5 inline-flex items-center justify-center rounded border border-gray-200 text-gray-500 text-[11px] hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▼
                  </button>
                </div>

                <span className="shrink-0 w-6 text-center text-[12px] font-bold text-gray-400 tabular-nums">{i + 1}</span>

                {/* タイトル + ステータス */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-gray-900 truncate">
                      {r.menuLabel?.trim() || r.title?.trim() || "（無題）"}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        r.publishStatus === "published"
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : r.publishStatus === "archived"
                            ? "bg-gray-100 text-gray-500 border border-gray-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {PUBLISH_BADGE[r.publishStatus] ?? r.publishStatus}
                    </span>
                    {!r.isEnabled && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        無効
                      </span>
                    )}
                  </div>
                </div>

                {/* 表示形式 */}
                <select
                  value={r.cardStyle}
                  onChange={(e) => setCardStyle(r.id, e.target.value as CardStyle)}
                  disabled={isReadOnly}
                  aria-label="表示形式"
                  className="shrink-0 px-2 py-1 border border-gray-200 rounded-md text-xs bg-white disabled:bg-gray-50"
                >
                  <option value="card">カード</option>
                  <option value="compact">コンパクト</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 右: プレビュー (sticky) */}
      <div className="w-full lg:w-auto lg:shrink-0 lg:sticky lg:top-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-2">ホームプレビュー</h2>
        <div className="w-[375px] max-w-full min-h-[600px] rounded-[32px] overflow-hidden border border-[#e3e8ec] bg-[#f5f8f6] shadow-[0_10px_30px_rgba(31,64,92,0.10)]">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-white border-b border-[#eef2f5]">
            <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
            <span className="text-[10px] font-semibold tracking-[0.06em] text-[#9aa8a2]">LIFF プレビュー</span>
            <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
          </div>
          <div className="overflow-auto bg-[#f5f8f6]" style={{ maxHeight: 720 }}>
            <LiffMenuHomeRenderer workTitle={workTitle} pages={previewPages} preview />
          </div>
        </div>
      </div>
    </div>
  );
}
