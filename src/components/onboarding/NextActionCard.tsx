"use client";

import Link from "next/link";

interface Props {
  oaId:          string;
  workId:        string;
  hasCharacters: boolean;
  hasPhases:     boolean;
}

/**
 * NextActionCard — 作品ハブで初回セットアップ未完了のとき表示するクイックアクション
 * hasCharacters && hasPhases の両方が true なら null を返す。
 */
export function NextActionCard({ oaId, workId, hasCharacters, hasPhases }: Props) {
  if (hasCharacters && hasPhases) return null;

  const basePath = `/oas/${oaId}/works/${workId}`;

  return (
    <div
      className="rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm"
      style={{ padding: "14px 18px", marginBottom: 16 }}
    >
      <p className="font-semibold text-neutral-700" style={{ fontSize: 13, marginBottom: 4 }}>
        次にやること
      </p>
      <p className="text-neutral-500 leading-relaxed" style={{ fontSize: 12, marginBottom: 12 }}>
        この作品はまだ設定途中です。<br />
        まずはキャラクターとフェーズを作成すると、次の設定が進めやすくなります。
      </p>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {!hasCharacters && (
          <Link
            href={`${basePath}/characters/new`}
            className="inline-flex items-center rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors"
            style={{ gap: 6, padding: "7px 14px", fontSize: 12 }}
          >
            キャラクター作成
          </Link>
        )}
        {!hasPhases && (
          <Link
            href={`${basePath}/scenario`}
            className="inline-flex items-center rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold transition-colors"
            style={{ gap: 6, padding: "7px 14px", fontSize: 12 }}
          >
            フェーズ作成
          </Link>
        )}
      </div>
    </div>
  );
}
