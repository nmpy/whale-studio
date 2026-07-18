// src/lib/owner-error-log/csv.ts
// エラーログ CSV の組み立て。UTF-8 BOM + CRLF・既存 csvCell（インジェクション/quote 対策済み）を再利用。
//   - 現在のフィルタ一致行のみ（route 側で取得）。生 LINE userId / 秘匿情報は View Model 時点で除去済み。

import { csvCell } from "@/lib/location-log";
import { formatDateTime } from "@/lib/format-datetime";
import { TYPE_LABEL } from "./normalize";
import type { OwnerErrorLogItem } from "./types";

const CSV_COLUMNS = ["日時", "アカウント", "種別", "内容", "プレイヤー", "詳細", "状態", "解決日時", "解決者"] as const;

/**
 * items を CSV 文字列へ。resolvedByName は `${source}:${sourceId}` → 解決者表示名（生 userId は渡さない）。
 */
export function buildErrorLogCsv(items: OwnerErrorLogItem[], resolvedByName: Map<string, string>): string {
  const header = CSV_COLUMNS.join(",");
  const lines = items.map((it) => {
    const key = `${it.source}:${it.sourceId}`;
    return [
      formatDateTime(it.occurredAt),
      it.accountName,
      TYPE_LABEL[it.type],
      it.title,
      it.player ?? "",
      it.detail ?? "",
      it.isResolved ? "解決済み" : "未解決",
      it.resolvedAt ? formatDateTime(it.resolvedAt) : "",
      it.isResolved ? (resolvedByName.get(key) ?? "オーナー") : "",
    ].map(csvCell).join(",");
  });
  return "﻿" + [header, ...lines].join("\r\n");
}

/** JST の実行日で `whale-studio-error-log-YYYY-MM-DD.csv`。 */
export function errorLogCsvFileName(now: Date): string {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  return `whale-studio-error-log-${ymd}.csv`;
}
