// POST /api/oas/[id]/live/ticket-import
//   ESCAPE.ID 予約データ（xlsx/xlsm/csv/tsv）を取込み、1 行=1 チケット=1 LiveTeam を作成/更新し、
//   各 team に LiveTicketLinkToken を発行して LIFF URL を返す（apply 時のみ）。
//   Participant は作らない（LIFF 連携時に生成）。既存の参加者 CSV 取込（/live/import）とは完全に独立。
//
//   mode=preview: 件数・エラー・発行/skip 予定のみ返す（**URL / token を生成しない**）。
//   mode=apply:   対象 Session 単位の transaction 内で team upsert + token 発行（正本=live-ticket-mint）。
//
//   セキュリティ: token は hash のみ保存 / 平文 URL・メールは DB 非保存・ログ非出力 /
//                URL はレスポンス（と UI 生成 CSV）のみ / 他 OA・他 work・他 Session へ越境しない。

import { NextRequest } from "next/server";
import iconv from "iconv-lite";
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, unprocessable, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { resolveTicketExpiresAt } from "@/lib/live-ticket-link";
import { revokePriorValidTicketTokens, issueTicketLinkToken } from "@/lib/live-ticket-mint";
import {
  mapEscapeIdHeaders, extractTicketRow, normalizeTicketRow,
  type EscapeIdField, type TicketRowSpec, type TicketResultRow,
} from "@/lib/live-ticket-import";

export const dynamic = "force-dynamic";

// ── 入力上限（正式初期値） ─────────────────────────────
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 5000;                    // データ行（ヘッダー除く）
const MAX_COLS = 100;                     // 列数
const MAX_CELL = 10000;                   // 1 セル文字数

type Parsed = { headers: string[]; rows: Record<string, string>[]; sheetName: string | null; nonEmptySheets: number };

function decodeCsvBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString("utf-8");
  const asUtf8 = buf.toString("utf-8");
  const repl = (asUtf8.match(/�/g) ?? []).length;
  if (repl > 0 && repl / Math.max(asUtf8.length, 1) > 0.005) return iconv.decode(buf, "Shift_JIS");
  return asUtf8;
}

function parseCsv(buf: Buffer, filename: string): Parsed {
  const text = decodeCsvBuffer(buf);
  const delimiter = filename.toLowerCase().endsWith(".tsv")
    ? "\t"
    : (() => { const head = text.slice(0, 1024); return (head.match(/\t/g) ?? []).length > (head.match(/,/g) ?? []).length ? "\t" : ","; })();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, delimiter, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => String(h));
  if (headers.length > MAX_COLS) throw new Error("COL_LIMIT");
  const rows = (parsed.data as Record<string, string>[]).map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) o[h] = String(r[h] ?? "").slice(0, MAX_CELL);
    return o;
  });
  return { headers, rows, sheetName: null, nonEmptySheets: 1 };
}

function xlsxCellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("text" in o) return String(o.text ?? "");
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("result" in o) return xlsxCellToString(o.result);
    if ("hyperlink" in o) return String(o.hyperlink ?? "");
    if ("formula" in o) return "";
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** xlsx/xlsm を解析。**最初の表示シートのみ**を対象（暗黙のシート結合はしない）。 */
async function parseXlsx(buf: Buffer): Promise<Parsed> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets = wb.worksheets;
  const nonEmpty = sheets.filter((ws) => ws.rowCount > 1 || (ws.rowCount === 1 && ws.getRow(1).cellCount > 0));
  // 対象は「最初の表示シート」（hidden/veryHidden を避ける。無ければ先頭）。
  const target = sheets.find((ws) => ws.state === "visible") ?? sheets[0];
  if (!target) return { headers: [], rows: [], sheetName: null, nonEmptySheets: 0 };
  if (target.rowCount > MAX_ROWS + 1) throw new Error("ROW_LIMIT"); // zip-bomb / 巨大シート対策
  if (target.columnCount > MAX_COLS) throw new Error("COL_LIMIT");
  const headers: string[] = [];
  const headerByCol: Record<number, string> = {};
  target.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = xlsxCellToString(cell.value).trim().slice(0, MAX_CELL);
    if (key) { headers.push(key); headerByCol[col] = key; }
  });
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= target.rowCount; r++) {
    const row = target.getRow(r);
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (const [colStr, key] of Object.entries(headerByCol)) {
      const val = xlsxCellToString(row.getCell(Number(colStr)).value).trim().slice(0, MAX_CELL);
      obj[key] = val;
      if (val) hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }
  return { headers, rows, sheetName: String(target.name), nonEmptySheets: nonEmpty.length };
}

function fileExt(name: string): "xlsx" | "csv" | "unsupported" {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) return "xlsx";
  if (n.endsWith(".csv") || n.endsWith(".tsv")) return "csv";
  return "unsupported";
}

/** Date を分単位に揃えて比較用文字列に。 */
function minuteKey(d: Date | null): string | null {
  if (!d) return null;
  return new Date(Math.floor(d.getTime() / 60000) * 60000).toISOString();
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;
  const oaId = params.id;

  try {
    const url = new URL(req.url);
    const form = await req.formData();
    const file = form.get("file");
    const mode = (form.get("mode") as string) || url.searchParams.get("mode") || "preview";
    const workId = String(form.get("work_id") ?? "");
    const sessionId = String(form.get("session_id") ?? "");
    const columnMappingRaw = form.get("column_mapping");
    let reissueIds: string[] = [];
    const reissueRaw = form.get("reissue_ticket_ids");
    if (typeof reissueRaw === "string" && reissueRaw) {
      try { const a = JSON.parse(reissueRaw); if (Array.isArray(a)) reissueIds = a.map(String); } catch { /* ignore */ }
    }

    if (mode !== "preview" && mode !== "apply") return badRequest("mode は preview / apply");
    if (!(file instanceof File)) return badRequest("file がありません");
    if (file.size > MAX_FILE_BYTES) return badRequest("ファイルサイズが大きすぎます（上限 10MB）");
    if (!workId) return badRequest("work_id は必須です");
    if (!sessionId) return badRequest("対象 Session を選択してください（session_id 必須）");

    // テナント境界: work / session が この OA・この work に属することを検証（client の sessionId を無条件に信用しない）。
    const work = await prisma.work.findFirst({ where: { id: workId, oaId }, select: { id: true } });
    if (!work) return badRequest("work_id が OA に紐付いていません");
    const session = await prisma.liveSession.findFirst({
      where:  { id: sessionId, oaId, workId },
      select: { id: true, name: true, status: true, startsAt: true },
    });
    if (!session) return notFound("対象 Session");
    if (session.status === "ended") return badRequest("終了した Session には取込めません");

    const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { liffId: true } });
    const liffId = getLiffIdForUrlGeneration(oa ?? undefined);

    // ── 解析 ──
    const ext = fileExt(file.name);
    if (ext === "unsupported") return badRequest("対応形式は xlsx / xlsm / csv / tsv です");
    const buf = Buffer.from(await file.arrayBuffer());
    let parsed: Parsed;
    try {
      parsed = ext === "xlsx" ? await parseXlsx(buf) : parseCsv(buf, file.name);
    } catch (e) {
      if (e instanceof Error && e.message === "ROW_LIMIT") return badRequest(`行数が上限（${MAX_ROWS}）を超えています。分割してください`);
      if (e instanceof Error && e.message === "COL_LIMIT") return badRequest(`列数が上限（${MAX_COLS}）を超えています`);
      return badRequest("ファイルを解析できませんでした（xlsx/csv 形式をご確認ください）");
    }
    if (parsed.rows.length === 0) return badRequest("データ行がありません");
    if (parsed.rows.length > MAX_ROWS) return badRequest(`行数が上限（${MAX_ROWS}）を超えています。分割してください`);

    const override = (() => {
      if (typeof columnMappingRaw !== "string" || !columnMappingRaw) return undefined;
      try { return JSON.parse(columnMappingRaw) as Partial<Record<string, EscapeIdField>>; } catch { return undefined; }
    })();
    const mapping = mapEscapeIdHeaders(parsed.headers, override);
    if (!mapping.ticket_id) return badRequest("システムチケットID の列を特定できませんでした（列マッピングで指定してください）");

    // 正規化 + ファイル内 ticketId 重複検出（最初の行のみ候補・2件目以降は重複エラー）。
    const specs: TicketRowSpec[] = parsed.rows.map((row, i) => normalizeTicketRow(extractTicketRow(row, mapping), i + 2));
    const firstRowByTicket = new Map<string, number>();
    for (const s of specs) {
      if (!s.valid) continue;
      const prev = firstRowByTicket.get(s.ticketId);
      if (prev != null) { s.valid = false; s.errors.push(`ファイル内でチケットIDが重複しています（先に行 ${prev}）`); }
      else firstRowByTicket.set(s.ticketId, s.rowIndex);
    }

    // 同一 OA・別 Session に同じ ticketId が既存 → 行エラー（自動移動/複製/上書きしない・他 OA は照会しない=境界維持）。
    const idsForCheck = specs.filter((s) => s.valid).map((s) => s.ticketId);
    if (idsForCheck.length > 0) {
      const otherSessionTeams = await prisma.liveTeam.findMany({
        where:  { oaId, ticketId: { in: idsForCheck }, liveSessionId: { not: sessionId } },
        select: { ticketId: true },
      });
      const otherSet = new Set(otherSessionTeams.map((t) => t.ticketId).filter(Boolean) as string[]);
      for (const s of specs) {
        if (s.valid && otherSet.has(s.ticketId)) { s.valid = false; s.errors.push("このチケットIDは別のSessionへ登録済みです"); }
      }
    }

    const validSpecs = specs.filter((s) => s.valid);
    const validTicketIds = validSpecs.map((s) => s.ticketId);

    const now = new Date();
    const existingValidTokens = validTicketIds.length === 0 ? [] : await prisma.liveTicketLinkToken.findMany({
      where:  { oaId, workId, reservationNumber: { in: validTicketIds }, revokedAt: null, expiresAt: { gt: now } },
      select: { reservationNumber: true },
    });
    const hasValidToken = new Set(existingValidTokens.map((t) => t.reservationNumber));
    const existingTeams = validTicketIds.length === 0 ? [] : await prisma.liveTeam.findMany({
      where:  { liveSessionId: sessionId, ticketId: { in: validTicketIds } },
      select: { ticketId: true },
    });
    const teamExists = new Set(existingTeams.map((t) => t.ticketId).filter(Boolean) as string[]);

    // 公演日時と選択 Session の日時が不一致な行（警告）。
    const sessionMinute = minuteKey(session.startsAt ?? null);
    const dateMismatch = (s: TicketRowSpec): boolean => !!(sessionMinute && s.reservedAt && minuteKey(s.reservedAt) !== sessionMinute);

    // ── preview: URL / token を生成しない ──
    if (mode === "preview") {
      let issue = 0, skip = 0;
      for (const s of validSpecs) {
        if (hasValidToken.has(s.ticketId) && !reissueIds.includes(s.ticketId)) skip++; else issue++;
      }
      const mismatchCount = validSpecs.filter(dateMismatch).length;
      return ok({
        mode: "preview",
        file: { name: file.name, format: ext, total_rows: parsed.rows.length, sheet_name: parsed.sheetName, non_empty_sheets: parsed.nonEmptySheets },
        mapping,
        session: { id: session.id, name: session.name, status: session.status, starts_at: session.startsAt?.toISOString() ?? null },
        oa_liff_configured: !!liffId,
        counts: {
          total: parsed.rows.length,
          valid: validSpecs.length,
          error: specs.length - validSpecs.length,
          teams_create: validSpecs.filter((s) => !teamExists.has(s.ticketId)).length,
          teams_update: validSpecs.filter((s) => teamExists.has(s.ticketId)).length,
          tokens_issue: issue,
          tokens_skip: skip,
          date_mismatch: mismatchCount,
        },
        warnings: {
          multi_sheet: parsed.nonEmptySheets > 1 ? `非空シートが ${parsed.nonEmptySheets} 枚あります。最初の表示シート「${parsed.sheetName}」のみ処理します。` : null,
          date_mismatch: mismatchCount > 0 ? `${mismatchCount} 行の公演日時が選択 Session の日時と一致しません。` : null,
        },
        // per-row: 行番号 / ticketId / 元のチケット種別 / plan / エラー理由（URL・メールは含めない）。
        rows: specs.map((s) => ({
          rowIndex: s.rowIndex,
          ticketId: s.ticketId,
          ticketType: s.ticketType,
          groupType: s.groupType,
          plan: !s.valid ? "error" : (hasValidToken.has(s.ticketId) && !reissueIds.includes(s.ticketId) ? "skip" : "issue"),
          dateMismatch: s.valid ? dateMismatch(s) : false,
          error: s.errors.join(" / "),
          warnings: s.warnings,
        })),
      });
    }

    // ── apply: liffId 必須 ──
    if (!liffId) return unprocessable("このアカウントの LIFF が未設定です（先に LIFF 設定が必要）", "LIFF_NOT_CONFIGURED");

    const results: TicketResultRow[] = [];
    const base = (s: TicketRowSpec, extra: Partial<TicketResultRow>): TicketResultRow => ({
      showDate: s.showDate, showTime: s.showTime, purchasedAt: s.purchasedAt, ticketType: s.ticketType,
      userName: s.purchaserName ?? "", email: s.email, ticketId: s.ticketId,
      url: null, expiresAt: null, result: "issued", error: "", ...extra,
    });
    // validation error 行は DB 処理前に除外（他の valid 行の取込を妨げない）。
    for (const s of specs.filter((x) => !x.valid)) results.push(base(s, { result: "failed", error: s.errors.join(" / ") }));

    const expiresAt = resolveTicketExpiresAt({ startsAt: session.startsAt ?? null, now });
    let created = 0, updated = 0, issued = 0, skipped = 0, reissued = 0, applyFailed = 0;

    try {
      const txRows: TicketResultRow[] = [];
      // 対象 Session 単位で valid 行を 1 transaction。予期しない DB エラーで全件 rollback。
      await prisma.$transaction(async (tx) => {
        for (const s of validSpecs) {
          const existing = await tx.liveTeam.findFirst({ where: { liveSessionId: sessionId, ticketId: s.ticketId }, select: { id: true } });
          const teamData = { reservationNumber: s.reservationNumber, ticketId: s.ticketId, groupType: s.groupType, purchaserName: s.purchaserName, reservedAt: s.reservedAt };
          let teamId: string;
          if (existing) { await tx.liveTeam.update({ where: { id: existing.id }, data: teamData }); teamId = existing.id; updated++; }
          else { const t = await tx.liveTeam.create({ data: { oaId, liveSessionId: sessionId, name: s.teamName, ...teamData }, select: { id: true } }); teamId = t.id; created++; }

          const reissue = reissueIds.includes(s.ticketId);
          if (hasValidToken.has(s.ticketId) && !reissue) {
            skipped++;
            txRows.push(base(s, { result: "skipped", error: "発行済み（URL は再取得不可・再発行が必要）" }));
            continue;
          }
          if (reissue) await revokePriorValidTicketTokens(tx, { oaId, workId, reservationNumber: s.reservationNumber, now });
          const minted = await issueTicketLinkToken(tx, {
            oaId, workId, reservationNumber: s.reservationNumber, ticketId: s.ticketId, liffId, expiresAt,
            liveSessionId: sessionId, teamId,
          });
          if (reissue) reissued++; else issued++;
          txRows.push(base(s, { result: "issued", url: minted.url, expiresAt: expiresAt.toISOString() }));
        }
      });
      results.push(...txRows);
    } catch {
      // 予期しない DB エラー → この Session の valid 行は全件 rollback。PII/token を漏らさない。
      created = 0; updated = 0; issued = 0; skipped = 0; reissued = 0;
      applyFailed = validSpecs.length;
      for (const s of validSpecs) results.push(base(s, { result: "failed", error: "取込処理でエラーが発生しました（この公演の取込はロールバックされました）" }));
    }

    results.sort((a, b) => (specs.find((s) => s.ticketId === a.ticketId)?.rowIndex ?? 0) - (specs.find((s) => s.ticketId === b.ticketId)?.rowIndex ?? 0));

    return ok({
      mode: "apply",
      session: { id: session.id, name: session.name },
      counts: {
        total: parsed.rows.length,
        valid: validSpecs.length,
        created, updated, issued, skipped, reissued,
        validationFailed: specs.length - validSpecs.length,
        applyFailed,
      },
      // url/email はここ（と UI 生成 CSV）のみ・DB 非保存・ログ非出力。
      rows: results,
    });
  } catch (err) {
    return serverError(err);
  }
}
