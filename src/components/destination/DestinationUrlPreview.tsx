"use client";

// src/components/destination/DestinationUrlPreview.tsx
// フォーム入力値からリアルタイムで resolved URL を表示するプレビュー。
// 保存前に最終URLを確認できる。
//
// Phase 4.2c: UI を Phase 0 トークンに揃える。
// 成功: bg-brand-soft + border-brand/30 + text-brand-ink
// 警告: bg-warn-soft + border-warn/30 + text-warn
// resolveDestinationUrl 本体・警告条件・表示文言・空キー除外ロジックは完全維持。

import { resolveDestinationUrl } from "@/lib/destination-url-builder";
import type { DestinationType, LiffTargetType } from "@/types";

interface Props {
  workId: string;
  /** Work の公開URL用短縮ID。canonical `/w/{workPublicId}` を組むのに使う。 */
  workPublicId?: string | null;
  /** 対象 OA の Oa.liffId。null/未指定なら liff 型は「LIFF未設定」を表示する（env fallback しない）。 */
  liffId?: string | null;
  destinationType: DestinationType;
  liffTargetType?: LiffTargetType | null;
  urlOrPath?: string | null;
  queryParams: Record<string, string>;
}

export function DestinationUrlPreview({
  workId, workPublicId, liffId, destinationType, liffTargetType, urlOrPath, queryParams,
}: Props) {
  // 空キーを除外してURL生成
  const cleanParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (k.trim()) cleanParams[k.trim()] = v;
  }

  const resolved = resolveDestinationUrl({
    destinationType,
    liffTargetType,
    urlOrPath,
    queryParamsJson: cleanParams,
    workId,
    workPublicId,
  }, { liffId });

  if (!resolved) {
    const reason = destinationType === "liff"
      ? "このLINE公式アカウントにはLIFFが設定されていません。設定 → LIFF設定 から登録してください。"
      : destinationType === "internal_url"
      ? "パスを入力してください"
      : "URLを入力してください";

    return (
      <div className="mt-4 rounded-field border border-warn/30 bg-warn-soft p-3" role="status">
        <p className="mb-0.5 text-[12px] font-medium text-warn">生成されるURL</p>
        <p className="text-[12px] text-warn">{reason}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-field border border-brand/30 bg-brand-soft p-3" role="status">
      <p className="mb-1 text-[12px] font-medium text-brand-ink">生成されるURL</p>
      <code className="block break-all font-mono text-[11px] leading-relaxed text-brand-ink">
        {resolved}
      </code>
    </div>
  );
}
