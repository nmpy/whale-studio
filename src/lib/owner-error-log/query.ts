// src/lib/owner-error-log/query.ts
// 3 テーブル横断の正確なグローバルページネーション。
//   - 3 種の失敗ログを共通列へ正規化した UNION ALL を作り、error_log_resolutions を
//     (source, source_id) で LEFT JOIN。フィルタ・並び順・LIMIT/OFFSET は SQL 側で適用する
//     （テーブル別ページング → 単純結合ではページ境界が壊れるため）。
//   - フィルタ値は Prisma.sql / パラメータバインドのみ（文字列連結しない）。
//   - 表示に不要な JSON カラム（raw_event / payload_json / metadata_json）は SELECT しない。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OwnerErrorLogFilters } from "./types";
import { SOURCE_BY_TYPE, type RawErrorLogRow } from "./normalize";
import { periodStartUTC } from "./period";

/** 3 ソースを共通列へ正規化した UNION（resolution 非依存・失敗のみ）。 */
const UNION_SQL = Prisma.sql`
  SELECT 'beacon_event'::text AS source, bel.id AS source_id, bel.created_at AS occurred_at,
         bel.oa_id AS oa_id, bel.line_user_id AS line_user_id, bel.action_status AS cause_code,
         bel.error_message AS detail, bel.is_redelivery AS is_redelivery
    FROM beacon_event_logs bel
   WHERE bel.action_status = 'failed'
  UNION ALL
  SELECT 'checkin_attempt'::text, ca.id, ca.created_at, w.oa_id, ca.line_user_id, ca.status,
         ca.failure_reason, false
    FROM checkin_attempts ca
    JOIN works w ON w.id = ca.work_id
   WHERE ca.status <> 'success'
  UNION ALL
  SELECT 'scheduled_line_message'::text, slm.id, slm.updated_at, slm.oa_id, slm.line_user_id, 'failed',
         slm.last_error, false
    FROM scheduled_line_messages slm
   WHERE slm.status = 'failed'
`;

/** フィルタ → WHERE 断片（パラメータバインド）。 */
function whereSql(filters: OwnerErrorLogFilters, now: Date): Prisma.Sql {
  const conds: Prisma.Sql[] = [];
  if (filters.status === "unresolved") conds.push(Prisma.sql`r.source IS NULL`);
  else if (filters.status === "resolved") conds.push(Prisma.sql`r.source IS NOT NULL`);
  if (filters.type !== "all") conds.push(Prisma.sql`u.source = ${SOURCE_BY_TYPE[filters.type]}`);
  if (filters.oaId) conds.push(Prisma.sql`u.oa_id = ${filters.oaId}`);
  const start = periodStartUTC(filters.period, now);
  if (start) conds.push(Prisma.sql`u.occurred_at >= ${start}`);
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ` AND `)}` : Prisma.empty;
}

interface DbRow {
  source: string;
  source_id: string;
  occurred_at: Date;
  oa_id: string;
  line_user_id: string | null;
  cause_code: string | null;
  detail: string | null;
  is_redelivery: boolean;
  resolved_at: Date | null;
}

function mapRow(x: DbRow): RawErrorLogRow {
  return {
    source: x.source as RawErrorLogRow["source"],
    sourceId: x.source_id,
    occurredAt: x.occurred_at,
    oaId: x.oa_id,
    lineUserId: x.line_user_id ?? null,
    causeCode: x.cause_code ?? null,
    detail: x.detail ?? null,
    isRedelivery: !!x.is_redelivery,
    resolvedAt: x.resolved_at ?? null,
  };
}

export interface ErrorLogPage {
  rows: RawErrorLogRow[];
  total: number;
}

/** 1 ページ分（limit/offset）＋総件数。 */
export async function queryErrorLogPage(
  filters: OwnerErrorLogFilters, now: Date, limit: number, offset: number,
): Promise<ErrorLogPage> {
  const where = whereSql(filters, now);
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<DbRow[]>(Prisma.sql`
      SELECT u.source, u.source_id, u.occurred_at, u.oa_id, u.line_user_id, u.cause_code, u.detail, u.is_redelivery,
             r.resolved_at
        FROM ( ${UNION_SQL} ) u
        LEFT JOIN error_log_resolutions r ON r.source = u.source AND r.source_id = u.source_id
        ${where}
       ORDER BY u.occurred_at DESC, u.source ASC, u.source_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
        FROM ( ${UNION_SQL} ) u
        LEFT JOIN error_log_resolutions r ON r.source = u.source AND r.source_id = u.source_id
        ${where}
    `),
  ]);
  return { rows: rows.map(mapRow), total: Number(countRows[0]?.count ?? 0) };
}

/** フィルタ一致の全件（CSV 用・上限付き）。 */
export async function queryErrorLogAll(
  filters: OwnerErrorLogFilters, now: Date, cap: number,
): Promise<RawErrorLogRow[]> {
  const where = whereSql(filters, now);
  const rows = await prisma.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT u.source, u.source_id, u.occurred_at, u.oa_id, u.line_user_id, u.cause_code, u.detail, u.is_redelivery,
           r.resolved_at
      FROM ( ${UNION_SQL} ) u
      LEFT JOIN error_log_resolutions r ON r.source = u.source AND r.source_id = u.source_id
      ${where}
     ORDER BY u.occurred_at DESC, u.source ASC, u.source_id ASC
     LIMIT ${cap}
  `);
  return rows.map(mapRow);
}

/** 未解決の総件数（全期間・全種別・全アカウント）。サマリー用。 */
export async function countUnresolvedAll(): Promise<number> {
  const countRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
      FROM ( ${UNION_SQL} ) u
      LEFT JOIN error_log_resolutions r ON r.source = u.source AND r.source_id = u.source_id
     WHERE r.source IS NULL
  `);
  return Number(countRows[0]?.count ?? 0);
}
