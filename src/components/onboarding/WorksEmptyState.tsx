"use client";

import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Props {
  oaId:     string;
  isTester: boolean;
}

export function WorksEmptyState({ oaId, isTester }: Props) {
  const sp = useIsMobile();
  return (
    <div className="flex flex-col items-center rounded-3xl border border-neutral-200 bg-white shadow-sm text-center" style={{ padding: sp ? "32px 16px" : "48px 32px" }}>
      <div className="text-5xl mb-4">🐳</div>

      <h3 className="font-bold text-neutral-800" style={{ fontSize: 18, marginBottom: 8 }}>
        まだ作品がありません
      </h3>
      <p className="text-neutral-500 leading-relaxed" style={{ fontSize: 13, maxWidth: 360, marginBottom: 32 }}>
        まずは1つ作品を作ってみましょう。<br />
        作品を作成すると、キャラクター・メッセージ・シナリオフローを設定できるようになります。
      </p>

      {/* かんたん3ステップ */}
      <div
        className="rounded-2xl border border-neutral-100 bg-neutral-50 text-left w-full"
        style={{ maxWidth: sp ? "100%" : 360, padding: sp ? "14px 16px" : "16px 20px", marginBottom: 24 }}
      >
        <p className="font-bold text-neutral-400" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>
          かんたん 3 ステップ
        </p>
        <div className="flex flex-col" style={{ gap: 12 }}>
          {[
            { n: "①", label: "作品情報を入力",       desc: "タイトルと説明を設定" },
            { n: "②", label: "キャラクターを作成",   desc: "送信者の名前・アイコンを設定" },
            { n: "③", label: "メッセージ・謎を追加", desc: "会話や謎チャレンジを作成" },
          ].map(({ n, label, desc }) => (
            <div key={n} className="flex items-start" style={{ gap: 12 }}>
              <span
                className="flex-shrink-0 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center"
                style={{ width: 24, height: 24, fontSize: 11, marginTop: 1 }}
              >
                {n}
              </span>
              <div>
                <div className="font-semibold text-neutral-700" style={{ fontSize: 13 }}>{label}</div>
                <div className="text-neutral-400" style={{ fontSize: 11 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!isTester && (
        <Link
          href={`/oas/${oaId}/works/new`}
          className="inline-flex items-center justify-center rounded-xl bg-emerald-500 text-white font-semibold transition-colors hover:bg-emerald-600"
          style={{
            gap:     6,
            padding: sp ? "13px 22px" : "10px 22px",
            fontSize: 14,
            width:   sp ? "100%" : "auto",
          }}
        >
          作品を作る
        </Link>
      )}
    </div>
  );
}
