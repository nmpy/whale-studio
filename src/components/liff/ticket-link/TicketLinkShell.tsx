// src/components/liff/ticket-link/TicketLinkShell.tsx
//
// チケット連携 LIFF 画面の共通シェル。
//
//   - モバイル: 画面全体を白背景の LIFF ページとして使う
//   - 640px 以上: 最大 420px の 1 枚の縦長カード（薄いボーダー + 控えめな角丸 + ごく薄い影）
//   - 高さは `.liff-ticket-link-page`（100dvh、未対応環境は 100vh へフォールバック）
//   - 下部操作エリアは position:fixed にしない。flex 末尾に置き、本文が短ければ余白で押し下げる。
//     （LINE アプリ内ブラウザでキーボード表示中に固定要素が浮く問題を避けるため）
//   - safe-area は最下端のブロックにだけ足す（二重に足さない）
//
// 独自ヘッダー（作品名 + 閉じる）は置かない。実機 LINE の標準ヘッダーが同じ内容
// （公演名 / ホスト名 / ×）を出しており、二重化するため PR #305 で廃止済み。

import type { ReactNode } from "react";
import { cx } from "../ui/tokens";

interface Props {
  children: ReactNode;
  /** 下部操作エリア（メインボタン + テキストボタン）。 */
  footer?: ReactNode;
  /** "Powered by Whale Studio" を出すか。 */
  showCredit?: boolean;
  /** CMS プレビュー（端末枠の中）ではビューポート基準の高さを使わない。 */
  preview?: boolean;
  className?: string;
}

/** 最下端ブロックに足す safe-area（ホームインジケータ等でボタンが隠れないように）。 */
const SAFE_BOTTOM = { paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" };
const SAFE_TOP = { paddingTop: "calc(1.25rem + env(safe-area-inset-top, 0px))" };

export function TicketLinkShell({ children, footer, showCredit = true, preview, className }: Props) {
  return (
    <div
      className={cx(
        "liff-ticket-link-page mx-auto flex w-full flex-col bg-[color:var(--liff-surface,#fff)]",
        "sm:my-6 sm:max-w-[420px] sm:rounded-[14px] sm:border sm:border-[color:var(--liff-border,#eef2f5)]",
        "sm:shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
        preview && "liff-ticket-link-page--preview",
        className,
      )}
    >
      {/* 本文。長くなった場合はこの領域が伸び、ページごと自然にスクロールする。
          下部操作エリアに隠れないよう十分な下余白を取る。 */}
      <div className="flex-1 px-4 pb-8" style={SAFE_TOP}>
        {children}
      </div>

      {(footer || showCredit) && (
        <div className="px-4 pt-2" style={SAFE_BOTTOM}>
          {footer}
          {showCredit && (
            <p className="pt-5 text-center text-[11px] tracking-[0.04em] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
              Powered by Whale Studio
            </p>
          )}
        </div>
      )}
    </div>
  );
}
