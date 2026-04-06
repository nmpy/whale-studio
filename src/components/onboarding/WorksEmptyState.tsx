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

      {/* ビジュアルアンカー — 作品（シナリオ）を表すブックアイコン */}
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        background: "#ecfdf5", border: "1px solid #6ee7b7",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 20, flexShrink: 0,
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>

      <h3 className="font-bold text-neutral-800" style={{ fontSize: 19, marginBottom: 8 }}>
        まだ作品がありません
      </h3>
      <p className="text-neutral-500 leading-relaxed" style={{ fontSize: 13, maxWidth: 360, marginBottom: 28 }}>
        まずは1つ作品を作ってみましょう。<br />
        作品を作成すると、キャラクター・メッセージ・シナリオフローを設定できるようになります。
      </p>

      {/* かんたん3ステップ */}
      <div
        className="rounded-2xl border border-neutral-100 bg-neutral-50 text-left w-full"
        style={{ maxWidth: sp ? "100%" : 360, padding: sp ? "14px 16px" : "18px 20px", marginBottom: 28 }}
      >
        <p className="font-bold text-neutral-400" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
          はじめかた
        </p>
        <div className="flex flex-col" style={{ gap: 14 }}>
          {[
            { n: "1", label: "作品情報を入力",       desc: "タイトルと説明を設定" },
            { n: "2", label: "キャラクターを作成",   desc: "送信者の名前・アイコンを設定" },
            { n: "3", label: "メッセージ・謎を追加", desc: "会話や謎チャレンジを作成" },
          ].map(({ n, label, desc }) => (
            <div key={n} className="flex items-start" style={{ gap: 12 }}>
              <span
                className="flex-shrink-0 rounded-full font-bold flex items-center justify-center"
                style={{
                  width: 22, height: 22, fontSize: 11, marginTop: 1,
                  background: "#d1fae5", color: "#065f46",
                  border: "1px solid #6ee7b7",
                }}
              >
                {n}
              </span>
              <div style={{ paddingTop: 2 }}>
                <div className="font-semibold text-neutral-700" style={{ fontSize: 13, lineHeight: 1.3 }}>{label}</div>
                <div className="text-neutral-400" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!isTester && (
        <Link
          href={`/oas/${oaId}/works/new`}
          className="inline-flex items-center justify-center rounded-xl bg-emerald-500 font-semibold transition-colors hover:bg-emerald-600"
          style={{
            gap:      6,
            padding:  sp ? "13px 22px" : "10px 22px",
            fontSize: 14,
            width:    sp ? "100%" : "auto",
            // globals.css の `a { color: var(--brand-dark) }` がTailwindのtext-whiteを
            // 上書きするため、インラインスタイルで確実に白を固定する（hover時も維持）
            color:    "#ffffff",
          }}
        >
          作品を作る
        </Link>
      )}
    </div>
  );
}
