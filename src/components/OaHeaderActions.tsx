"use client";

// src/components/OaHeaderActions.tsx
// OA 単位の共通ヘッダーアクション（「プラン」「設定」）。
// 作品リスト / 作品詳細など OA 配下の画面ヘッダー右上に並べて、プラン確認・OA 設定への
// 導線を統一する。既存の buttonClass(ghost/md) を再利用し、画面間で見た目・並びを揃える。
//
// - プラン: /pricing（buildPricingUrl）。OA 単位の情報なので oaId を引き回す。
//           遷移先 /pricing は usageType による出し分け・現在プラン/β版表示を持つ。
// - 設定 : /oas/[oaId]/settings（OA 設定ハブ。「作品設定」ではなく OA 設定）。
//
// 権限: リンク先（/settings, /pricing）の既存ガードを尊重し、ここでは表示制御のみ。
//   showSettings で 設定 リンクの表示可否を呼び出し側から制御できる（既存の tester 非表示を踏襲）。
//   親要素が flex コンテナ（flex flex-wrap items-center gap-2 等）を用意する前提でフラグメントを返す。

import Link from "next/link";
import { buttonClass } from "@/components/shared";
import { buildPricingUrl } from "@/lib/pricing-url";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { getDevToken } from "@/lib/api-client";

export function OaHeaderActions({
  oaId,
  planName,
  source = "header",
  showSettings = true,
}: {
  oaId: string;
  /** 現在プラン名（tracking / buildPricingUrl の from 用。任意）。 */
  planName?: string;
  /** 流入元ラベル（tracking 用）。 */
  source?: string;
  /** 「設定」リンクを表示するか（既存の tester 非表示などを踏襲）。 */
  showSettings?: boolean;
}) {
  return (
    <>
      <Link
        href={buildPricingUrl({ source, from: planName, to: "editor", oaId })}
        onClick={() =>
          trackBillingEvent("pricing_click_from_header", getDevToken(), source, {
            from: planName,
            to:   "editor",
          })
        }
        className={buttonClass({ variant: "ghost", size: "md" })}
      >
        プラン
      </Link>
      {showSettings && (
        <Link
          href={`/oas/${oaId}/settings`}
          className={buttonClass({ variant: "ghost", size: "md" })}
        >
          設定
        </Link>
      )}
    </>
  );
}
