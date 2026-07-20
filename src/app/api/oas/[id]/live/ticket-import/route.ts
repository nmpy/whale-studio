// POST /api/oas/[id]/live/ticket-import
//   ESCAPE.ID 予約データ（xlsx/xlsm/csv/tsv）を取込み、1 行=1 チケット=1 LiveTeam を作成/更新し、
//   各 team に LiveTicketLinkToken を発行して LIFF URL を返す（apply 時のみ）。
//   Participant は作らない（LIFF 連携時に生成）。既存の参加者 CSV 取込（/live/import）とは完全に独立。
//
//   mode=preview: 件数・エラー・発行/skip 予定のみ返す（**URL / token を生成しない**）。
//   mode=apply:   対象 Session 単位の transaction 内で team upsert + token 発行し、URL を返す。
//
//   セキュリティ: token は hash のみ保存 / 平文 URL・メールは DB 非保存・ログ非出力 /
//                URL はレスポンス（と UI 生成 CSV）のみ / 他 OA・他 work へ越境しない。

import { NextRequest } from "next/server";
import iconv from "iconv-lite";
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, unprocessable, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { generateTicketToken, hashTicketToken, resolveTicketExpiresAt, buildTicketLiffUrl } from "@/lib/live-ticket-link";
import {
  mapEscapeIdHeaders, extractTicketRow, normalizeTicketRow,
  type EscapeIdField, type TicketRowSpec, type TicketResultRow,
} from "@/lib/live-ticket-import";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 2000;                  // 1 取込あたりの上限（transaction 有界化）
const MAX_CELL = 2000;                  // 1 セル長上限（巨大セル対策）

// ── ファイル解析（この route 専用・既存 import には非依存） ─────────────
function decodeCsvBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf-8");
  }
  const asUtf8 = buf.toString("utf-8");
  const repl = (asUtf8.match(/�/g) ?? []).length;
  if (repl > 0 && repl / Math.max(asUtf8.length, 1) > 0.005) return iconv.decode(buf, "Shift_JIS");
  return asUtf8;
}

function parseCsv(buf: Buffer, filename: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = decodeCsvBuffer(buf);
  const delimiter = filename.toLowerCase().endsWith(".tsv")
    ? "\t"
    : (() => { const head = text.slice(0, 1024); return (head.match(/\t/g) ?? []).length > (head.match(/,/g) ?? []).length ? "\t" : ","; })();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, delimiter, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => String(h));
  const rows = (parsed.data as Record<string, string>[]).map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) o[h] = String(r[h] ?? "").slice(0, MAX_CELL);
    return o;
  });
  return { headers, rows };
}

/** Excel セル値を素朴な文字列へ（数式は結果・リッチテキスト対応）。 */
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

async function parseXlsx(buf: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  if (ws.rowCount > MAX_ROWS + 1) throw new Error("ROW_LIMIT"); // zip-bomb / 巨大シート対策
  const headers: string[] = [];
  const headerByCol: Record<number, string> = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = xlsxCellToString(cell.value).trim().slice(0, MAX_CELL);
    if (key) { headers.push(key); headerByCol[col] = key; }
  });
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (const [colStr, key] of Object.entries(headerByCol)) {
      const val = xlsxCellToString(row.getCell(Number(colStr)).value).trim().slice(0, MAX_CELL);
      obj[key] = val;
      if (val) hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }
  return { headers, rows };
}

function fileExt(name: string): "xlsx" | "csv" | "unsupported" {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) return "xlsx";
  if (n.endsWith(".csv") || n.endsWith(".tsv")) return "csv";
  return "unsupported";
}

// ── ハンドラ ───────────────────────────────────────────────
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
    if (file.size > MAX_FILE_BYTES) return badRequest("ファイルサイズが大きすぎます（上限 5MB）");
    if (!workId) return badRequest("work_id は必須です");
    if (!sessionId) return badRequest("対象 Session を選択してください（session_id 必須）");

    // テナント境界: work / session が この OA・この work に属することを検証。
    const work = await prisma.work.findFirst({ where: { id: workId, oaId }, select: { id: true } });
    if (!work) return badRequest("work_id が OA に紐付いていません");
    const session = await prisma.liveSession.findFirst({
      where:  { id: sessionId, oaId, workId },
      select: { id: true, name: true, status: true, startsAt: true },
    });
    if (!session) return notFound("対象 Session");

    // mint に必要な OA の liffId（未設定なら全行発行不可）。
    const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { liffId: true } });
    const liffId = getLiffIdForUrlGeneration(oa ?? undefined);

    // 解析（xlsx/csv）。
    const ext = fileExt(file.name);
    if (ext === "unsupported") return badRequest("対応形式は xlsx / xlsm / csv / tsv です");
    const buf = Buffer.from(await file.arrayBuffer());
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    try {
      parsed = ext === "xlsx" ? await parseXlsx(buf) : parseCsv(buf, file.name);
    } catch (e) {
      if (e instanceof Error && e.message === "ROW_LIMIT") return badRequest(`行数が上限（${MAX_ROWS}）を超えています。分割してください`);
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

    // 行を正規化 + ファイル内 ticketId 重複を検出。
    const specs: TicketRowSpec[] = parsed.rows.map((row, i) => normalizeTicketRow(extractTicketRow(row, mapping), i + 2));
    const seen = new Set<string>();
    for (const s of specs) {
      if (!s.valid) continue;
      if (seen.has(s.ticketId)) { s.valid = false; s.errors.push("ファイル内でチケットIDが重複しています"); }
      else seen.add(s.ticketId);
    }
    const validSpecs = specs.filter((s) => s.valid);
    const validTicketIds = validSpecs.map((s) => s.ticketId);

    // 既存 token（有効）・既存 team を把握（preview/apply 共通の判定材料）。
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

    // ── preview: URL / token を生成しない ──
    if (mode === "preview") {
      let issue = 0, skip = 0;
      for (const s of validSpecs) {
        const reissue = reissueIds.includes(s.ticketId);
        if (hasValidToken.has(s.ticketId) && !reissue) skip++; else issue++;
      }
      return ok({
        mode: "preview",
        file: { name: file.name, format: ext, total_rows: parsed.rows.length },
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
        },
        // per-row は最小限（PII/URL を含めない: ticketId / groupType / plan / error のみ）。
        rows: specs.map((s) => ({
          rowIndex: s.rowIndex,
          ticketId: s.ticketId,
          groupType: s.groupType,
          teamName: s.teamName,
          plan: !s.valid ? "error" : (hasValidToken.has(s.ticketId) && !reissueIds.includes(s.ticketId) ? "skip" : "issue"),
          error: s.errors.join(" / "),
          warnings: s.warnings,
        })),
      });
    }

    // ── apply: liffId 必須 ──
    if (!liffId) return unprocessable("このアカウントの LIFF が未設定です（先に LIFF 設定が必要）", "LIFF_NOT_CONFIGURED");

    // 対象 Session 単位の transaction（Session→Team→Token を atomic に）。
    const results: TicketResultRow[] = [];
    const base = (s: TicketRowSpec, extra: Partial<TicketResultRow>): TicketResultRow => ({
      showDate: s.showDate, showTime: s.showTime, purchasedAt: s.purchasedAt, ticketType: s.ticketType,
      userName: s.purchaserName ?? "", email: s.email, ticketId: s.ticketId,
      url: null, expiresAt: null, result: "issued", error: "", ...extra,
    });
    // 無効行は失敗として先に結果へ。
    for (const s of specs.filter((x) => !x.valid)) {
      results.push(base(s, { result: "failed", error: s.errors.join(" / ") }));
    }

    const expiresAt = resolveTicketExpiresAt({ startsAt: session.startsAt ?? null, now });

    await prisma.$transaction(async (tx) => {
      for (const s of validSpecs) {
        // team upsert（(sessionId, ticketId) 論理キー）。
        const existing = await tx.liveTeam.findFirst({
          where: { liveSessionId: sessionId, ticketId: s.ticketId }, select: { id: true },
        });
        let teamId: string;
        const teamData = {
          reservationNumber: s.reservationNumber,
          ticketId: s.ticketId,
          groupType: s.groupType,
          purchaserName: s.purchaserName,
          reservedAt: s.reservedAt,
        };
        if (existing) {
          await tx.liveTeam.update({ where: { id: existing.id }, data: teamData });
          teamId = existing.id;
        } else {
          const createdTeam = await tx.liveTeam.create({
            data: { oaId, liveSessionId: sessionId, name: s.teamName, ...teamData },
            select: { id: true },
          });
          teamId = createdTeam.id;
        }

        // token: 発行/skip/再発行。
        const reissue = reissueIds.includes(s.ticketId);
        if (hasValidToken.has(s.ticketId) && !reissue) {
          results.push(base(s, { result: "skipped", error: "発行済み（URL は再取得不可・再発行が必要）" }));
          continue;
        }
        if (reissue) {
          // 明示再発行: 有効な旧 token を revoke してから新規発行。
          await tx.liveTicketLinkToken.updateMany({
            where: { oaId, workId, reservationNumber: s.ticketId, revokedAt: null, expiresAt: { gt: now } },
            data:  { revokedAt: now },
          });
        }
        const token = generateTicketToken();
        const tokenHash = hashTicketToken(token);
        await tx.liveTicketLinkToken.create({
          data: {
            oaId, workId, reservationNumber: s.reservationNumber, ticketId: s.ticketId,
            tokenHash, expiresAt, liveSessionId: sessionId, teamId,
          },
          select: { id: true },
        });
        results.push(base(s, { result: "issued", url: buildTicketLiffUrl(liffId, token), expiresAt: expiresAt.toISOString() }));
      }
    });

    // 元の行順に整列。
    results.sort((a, b) => {
      const ai = specs.find((s) => s.ticketId === a.ticketId)?.rowIndex ?? 0;
      const bi = specs.find((s) => s.ticketId === b.ticketId)?.rowIndex ?? 0;
      return ai - bi;
    });

    return ok({
      mode: "apply",
      session: { id: session.id, name: session.name },
      counts: {
        issued:  results.filter((r) => r.result === "issued").length,
        skipped: results.filter((r) => r.result === "skipped").length,
        failed:  results.filter((r) => r.result === "failed").length,
      },
      // rows は認証済み管理者にのみ返る。url/email はここ（と UI 生成 CSV）のみ・DB 非保存。
      rows: results,
    });
  } catch (err) {
    // serverError は汎用文言のみ（email/token/URL を漏らさない）。
    return serverError(err);
  }
}
