// src/components/shared/Accordion.tsx
// 共通アコーディオン。デザインガイド §4 「Accordion」 + §6 NG「ヘルプを開きっぱなし」 に準拠。
//
// 仕様:
// - デフォルト閉じ (= ヘルプ / 進捗 / 演出デフォルト設定 等は initially collapsed)
// - 閉じていてもサマリー (進捗率 / 件数 等) を見せられる summary prop
// - シェブロンは開閉で 180° 回転
// - ヘルプ系見出しは text-sky-ink で控えめなアクセント
//
// 内部は <details>/<summary> ではなく useState ベースで実装。
// (= summary 内のクリック判定 / animation 制御がしやすいため)

"use client";

import { useState, type ReactNode } from "react";

// インライン SVG (= 依存ライブラリを増やさない)。
// 将来 lucide-react を導入したら差し替える。
function ChevronDownIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width={16} height={16} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface Props {
  /** 折りたたみのタイトル (= 必須)。例: "この画面の使い方" */
  title:      ReactNode;
  /** 折りたたみ右側に閉じたままでも見せたい要約 (= 任意)。例: "完了 3/5" */
  summary?:    ReactNode;
  /** 中身。open=true のときに表示される。 */
  children:   ReactNode;
  /** 初期表示で開いておくか (= デフォルト false、ガイド §4) */
  defaultOpen?: boolean;
  /** タイトルを sky 系 (= ヘルプ) にするか。false なら ink。 */
  helpTone?: boolean;
  className?: string;
}

export function Accordion({
  title,
  summary,
  children,
  defaultOpen = false,
  helpTone    = false,
  className   = "",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const titleColor = helpTone ? "text-sky-ink" : "text-ink";

  return (
    <div
      className={
        "rounded-card border border-line bg-surface " +
        "transition-shadow hover:shadow-sm " + className
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          "w-full flex items-center justify-between gap-3 px-5 py-3.5 " +
          "text-left cursor-pointer"
        }
      >
        <span className={"font-bold text-[13px] " + titleColor}>{title}</span>
        <span className="flex items-center gap-3">
          {summary && (
            <span className="text-[12px] text-ink-3 font-num">{summary}</span>
          )}
          <ChevronDownIcon
            className={
              "text-ink-3 transition-transform duration-200 " +
              (open ? "rotate-180" : "rotate-0")
            }
          />
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 border-t border-line-2 text-[13px] text-ink-2 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
