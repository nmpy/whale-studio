// src/lib/owner-error-log/service.ts
// /admin/error-log ページ用の集約サービス（サーバー専用）。
//   - アカウント一覧（フィルタ用）・フィルタ正規化・グローバルページネーション・サマリーをまとめる。
//   - 取得失敗（例: migration 未適用でテーブル不在）でも 500 にせず failed=true を返し、UI はエラー状態を出す。

import { prisma } from "@/lib/prisma";
import { parseFilters } from "./filters";
import { queryErrorLogPage } from "./query";
import { toErrorLogItem } from "./normalize";
import { getErrorLogSummary, EMPTY_SUMMARY, type ErrorLogSummary } from "./summary";
import type { OwnerErrorLogFilters, OwnerErrorLogItem } from "./types";

/** 1 ページの表示件数（アクション列付きの密なログ表に適した値）。 */
export const ERROR_LOG_PAGE_SIZE = 25;

/** CSV の最大出力件数（無制限取得によるタイムアウト/メモリを避ける）。 */
export const ERROR_LOG_CSV_CAP = 5000;

export interface ErrorLogView {
  items: OwnerErrorLogItem[];
  total: number;
  page: number;
  pageCount: number;
  filters: OwnerErrorLogFilters;
  summary: ErrorLogSummary;
  accounts: { id: string; name: string }[];
  /** true = データ取得に失敗（テーブル未作成等）。UI はエラー状態を表示。 */
  failed: boolean;
}

export async function getErrorLogView(
  sp: Record<string, string | string[] | undefined>,
  now: Date,
): Promise<ErrorLogView> {
  const oas = await prisma.oa.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } });
  const validOaIds = new Set(oas.map((o) => o.id));
  const oaName = new Map(oas.map((o) => [o.id, o.title]));
  const accounts = oas.map((o) => ({ id: o.id, name: o.title }));
  const filters = parseFilters(sp, validOaIds);
  const size = ERROR_LOG_PAGE_SIZE;

  try {
    const [firstPage, summary] = await Promise.all([
      queryErrorLogPage(filters, now, size, (filters.page - 1) * size),
      getErrorLogSummary(now),
    ]);

    let { rows, total } = firstPage;
    const pageCount = Math.max(1, Math.ceil(total / size));
    let page = filters.page;
    // 範囲外ページは最後のページへ補正して再取得。
    if (page > pageCount) {
      page = pageCount;
      rows = (await queryErrorLogPage({ ...filters, page }, now, size, (page - 1) * size)).rows;
    }

    const items = rows.map((r) => toErrorLogItem(r, oaName.get(r.oaId) ?? "不明なアカウント"));
    return { items, total, page, pageCount, filters: { ...filters, page }, summary, accounts, failed: false };
  } catch (err) {
    console.error("[error-log] getErrorLogView failed", err);
    return {
      items: [], total: 0, page: 1, pageCount: 1,
      filters: { ...filters, page: 1 }, summary: EMPTY_SUMMARY, accounts, failed: true,
    };
  }
}
