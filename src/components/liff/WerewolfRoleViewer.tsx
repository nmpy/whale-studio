"use client";

// src/components/liff/WerewolfRoleViewer.tsx
//
// `/liff/r/[slotToken]` でプレイヤーが配役を見るための renderer。
//
// 仕様:
//   - QR 経由でアクセスされる前提 (戻るボタンは出さない。LIFF 上部バーの閉じるは外側で処理)
//   - ヘッダー: 中央に作品名 (= タイトル名で代替)
//   - タイトル名 / プレイ予定日時 / 注意文 / 配役カード一覧 を縦に並べる
//   - ゲーム開始前 (is_started=false) は cards が空配列で来るので、開始前の案内を出す
//   - Powered by Whale Studio footer (LiffStudioFooter)
//
// 色設計:
//   役職カードは `--liff-line-green` を「控えめなアクセント」として使う。
//   ベースは白カード + 細い緑のサイドストライプ + 緑文字の見出し。
//   LINE Design System 寄りに、塗りつぶしの強い緑にはしない。

import { useEffect } from "react";
import type { WerewolfRoleCard } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import { LiffStudioFooter } from "./LiffStudioFooter";

export interface RoleViewerData {
  slot_token:   string;
  slot_number:  number;
  title:        string;
  description:  string | null;
  scheduled_at: string | null;
  is_started:   boolean;
  cards:        WerewolfRoleCard[];
}

interface Props {
  data: RoleViewerData;
  /** プレビュー時 (CMS) は LIFF SDK を呼ばないので onClose 等は使わない。 */
  preview?: boolean;
  onClose?: () => void;
}

function formatScheduledAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function WerewolfRoleViewer({ data, preview = false, onClose }: Props) {
  // document.title を作品名 = data.title に同期
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (data.title) document.title = data.title;
  }, [data.title]);

  const scheduled = formatScheduledAt(data.scheduled_at);

  return (
    <div className={`liff-font ${liffRootClass(undefined)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      {/* シンプルなヘッダー — 中央にタイトル名、必要なら閉じる */}
      <header className="sticky top-0 z-10 bg-[color:var(--liff-header-bg)] border-b border-[color:var(--liff-header-border)]">
        <div className="liff-player-main flex items-center min-h-[48px] py-2">
          <div className="w-8 shrink-0" aria-hidden="true" />
          <h1 className="flex-1 text-center text-[15px] font-bold text-[color:var(--liff-header-text)] truncate">
            {data.title}
          </h1>
          <div className="w-8 shrink-0 flex justify-end">
            {!preview && onClose && (
              <button
                type="button"
                aria-label="閉じる"
                onClick={onClose}
                className="w-8 h-8 -mr-1 inline-flex items-center justify-center rounded-full text-[color:var(--liff-secondary-text)] active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* タイトル + 日時 */}
      <div className="liff-player-main pt-5 pb-3 flex flex-col gap-1">
        <h2 className="text-[20px] font-bold leading-snug">{data.title}</h2>
        {scheduled && (
          <p className="text-[13px] text-[color:var(--liff-secondary-text)]">
            プレイ予定: {scheduled}
          </p>
        )}
      </div>

      {/* ゲーム開始前: 開始待ち案内 */}
      {!data.is_started ? (
        <div className="liff-player-main pb-6">
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-8 text-center">
            <p className="text-3xl mb-3" aria-hidden="true">⏳</p>
            <p className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">
              ゲーム開始までお待ちください
            </p>
            <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
              GM がゲームを開始すると、あなたの配役を確認できます。
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* 注意文 */}
          <div className="liff-player-main pb-2">
            <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-4 py-3">
              <p className="text-[12px] leading-[1.7] text-amber-800">
                ※ この内容はゲーム開始まで他言しないようにしてください。<br />
                また、この内容を他者の目に触れる場所に載せたり共有することを禁じます。
              </p>
            </div>
          </div>

          {/* 配役カード一覧 */}
          <div className="liff-player-main py-4 flex flex-col gap-4">
            {data.cards.length === 0 ? (
              <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-8 text-center">
                <p className="text-[14px] text-[color:var(--liff-secondary-text)]">
                  配役カードがまだ登録されていません
                </p>
              </div>
            ) : (
              data.cards.map((card) => <RoleCardView key={card.id} card={card} />)
            )}
          </div>
        </>
      )}

      <LiffStudioFooter />
    </div>
  );
}

// ── 役職カード 1 枚 ─────────────────────────────────────────────────────
function RoleCardView({ card }: { card: WerewolfRoleCard }) {
  return (
    <article
      className="relative bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[14px] overflow-hidden"
      style={{
        // 左に細い緑のアクセント帯。塗りつぶしカードにはしない。
        boxShadow: "inset 4px 0 0 0 var(--liff-line-green, #06C755)",
      }}
    >
      <div className="px-5 py-5">
        {card.badge_label && (
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border border-[color:var(--liff-border)] text-[color:var(--liff-secondary-text)] bg-[color:var(--liff-surface-subtle,#FAFAFA)] mb-2">
            {card.badge_label}
          </span>
        )}
        {card.subtitle && (
          <p className="text-[12px] text-[color:var(--liff-secondary-text)] mb-1">
            {card.subtitle}
          </p>
        )}
        <h3 className="text-[20px] font-bold leading-snug text-[color:var(--liff-line-green,#06C755)] mb-3">
          {card.title}
        </h3>
        <p className="text-[15px] leading-[1.85] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)]">
          {card.body}
        </p>
      </div>
    </article>
  );
}
