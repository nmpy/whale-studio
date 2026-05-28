"use client";

// src/components/landing/LandingFaq.tsx
// 公開LPのよくある質問（アコーディオン）。
// トーン: 白〜薄グレー背景、薄い border、+ アイコンは LINEグリーン。

import { useState } from "react";

interface QA {
  q: string;
  a: string;
}

const ITEMS: QA[] = [
  {
    q: "Whale Studioとは？",
    a: "LINE上で、謎解き・マーダーミステリー・周遊イベントなどの物語体験を制作・運用するための管理ツールです。",
  },
  {
    q: "個人でも利用できますか？",
    a: "はい。個人制作や小規模なテスト作品から利用できます。",
  },
  {
    q: "LINE公式アカウントは必要ですか？",
    a: "実際に参加者へ配信するにはLINE公式アカウントとの連携が必要です。登録後、連携に必要な手順を案内します。",
  },
  {
    q: "プログラミングなしで使えますか？",
    a: "基本的なメッセージ設定、LIFFページ作成、チェックイン導線などは管理画面から設定できるようにしています。",
  },
  {
    q: "商業公演やイベントでも使えますか？",
    a: "はい。舞台公演、周遊イベント、企業案件などでの利用も想定しています。必要に応じて個別サポートや委託設定も相談できます。",
  },
  {
    q: "料金はどこで確認できますか？",
    a: "料金ページから確認できます。法人・委託利用は内容に応じて相談となります。",
  },
];

export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border border-[#E3EAE4] bg-white"
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-[15px] font-bold text-[#1F2A24]">{item.q}</span>
              <span
                className={`shrink-0 text-[18px] text-[#06C755] transition-transform ${isOpen ? "rotate-45" : ""}`}
                aria-hidden="true"
              >
                ＋
              </span>
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-[14px] leading-[1.85] text-[#5F6B64]">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
