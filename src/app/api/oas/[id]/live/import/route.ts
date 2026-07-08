// src/app/api/oas/[id]/live/import/route.ts
// POST /api/oas/:id/live/import
//   — CSV/TSV ファイルから participants を bulk 取込
//   — multipart/form-data 受信
//
// 認可: live admin 集合 (= authorizeLive write)
//
// クエリ:
//   ?mode=preview  → 解析結果のみ返却 (= DB 書き込みなし)
//   ?mode=apply    → 実行
//
// form-data フィールド:
//   file             : CSV/TSV ファイル本体 (= .csv / .tsv)
//   work_id          : 対象 Work id (= currentPhase 解決の対象 / セッション作成時の workId)
//   dedup            : "skip" | "overwrite" | "duplicate" (default: skip)
//   teaming          : "by_reservation" | "by_4" | "by_team_name_column" | "none" (default: by_reservation)
//   delimiter        : "auto" | "comma" | "tab" (default: auto / 拡張子 + 内容で推定)
//   column_mapping   : JSON string { "display_name": "氏名", ... } (任意)
//
// CSV 列マッピング既定 (ヘッダー文字列 → 内部 field):
//   "氏名" | "displayName" | "display_name" | "name"        → display_name
//   "メール" | "email"                                       → email (legacy memo として保存はしない)
//   "LINE ID" | "lineUserId" | "line_user_id"                → line_user_id
//   "予約番号" | "注文番号" | "reservationNumber"            → reservation_number
//   "参加日" | "date" | "scheduled_date"                     → __date  (= session 解決用)
//   "開始時間" | "time" | "start_time"                       → __time  (= session 解決用)
//   "チーム名" | "team" | "team_name"                        → team_name
//   "現在ステップ" | "current_step" | "phase"                → current_step (= phase.name と照合)
//   "メモ" | "memo" | "note"                                 → memo
//   "状態" | "status"                                        → status
//
// セッション解決ルール:
//   __date (YYYY-MM-DD or YYYY/MM/DD) + __time (HH:MM) を JST DateTime に正規化
//   → LiveSession.startsAt と分単位で比較。一致あれば既存セッション。なければ自動作成。
//
// dedup key:
//   reservation_number あり → (sessionId, reservationNumber, display_name)
//   reservation_number なし → email 列があれば (sessionId, email)  ※ email は participant に直接保存しないが
//                                                                   memo 内に "email: ..." として保持する選択肢を提供
//                                                                   今回は dedup key 用途で memo に格納
//
// 戻り値:
//   preview: { rows: [...], detected_columns: [...], warnings: [...] }
//   apply:   { created, skipped, overwritten, duplicated, errors: [...] }

import type { NextRequest } from "next/server";
import { z } from "zod";
import { Buffer } from "node:buffer";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { normalizeGroupType, type LiveTeamGroupType } from "@/lib/live-team";
import Papa from "papaparse";
import iconv from "iconv-lite";

export const dynamic = "force-dynamic";

const optionsSchema = z.object({
  mode:           z.enum(["preview", "apply"]).default("preview"),
  work_id:        z.string().uuid("work_id は uuid"),
  dedup:          z.enum(["skip", "overwrite", "duplicate"]).default("skip"),
  teaming:        z.enum(["by_reservation", "by_4", "by_team_name_column", "none"]).default("by_reservation"),
  delimiter:      z.enum(["auto", "comma", "tab"]).default("auto"),
  column_mapping: z.string().optional().nullable(),
});

type InternalField =
  | "display_name"
  | "email"
  | "line_user_id"
  | "reservation_number"
  | "__date"
  | "__time"
  | "team_name"
  | "current_step"
  | "memo"
  | "status"
  // PR2b-0b: LiveTeam（部屋/グループ/予約）レベルの項目
  | "reserved_at"
  | "purchaser_name"
  | "group_type"
  | "room_number"
  | "ticket_id";

const DEFAULT_HEADER_MAP: Record<string, InternalField> = {};
const HEADER_PATTERNS: Array<[RegExp, InternalField]> = [
  [/^(氏名|お名前|名前|displayName|display_name|name)$/i,                "display_name"],
  [/^(メール|メールアドレス|email|e-?mail)$/i,                            "email"],
  [/^(LINE\s*ID|lineUserId|line_user_id|line)$/i,                         "line_user_id"],
  [/^(予約番号|注文番号|reservationNumber|reservation_number|order_id)$/i, "reservation_number"],
  // PR2b-0b: team レベルの列（表記ゆれ吸収）。※ anchored なので team_name の "グループ" とは衝突しない。
  [/^(公演予約日時|予約日時|開始日時|reserved_at|reservedAt)$/i,            "reserved_at"],
  [/^(購入者名|購入者|代表者名|purchaser_name|purchaser|purchaserName)$/i,  "purchaser_name"],
  [/^(グループ種別|人数|部屋種別|group_type|groupType)$/i,                  "group_type"],
  [/^(部屋番号|部屋|room_number|room|roomNumber)$/i,                       "room_number"],
  [/^(チケットID|チケットid|チケット番号|ticket_id|ticketId|ticket)$/i,     "ticket_id"],
  [/^(参加日|公演日|date|scheduled_date|参加日付)$/i,                       "__date"],
  [/^(開始時間|公演時間|time|start_time|時間)$/i,                          "__time"],
  [/^(チーム|チーム名|team|team_name|グループ)$/i,                          "team_name"],
  [/^(現在ステップ|現在フェーズ|フェーズ|current_step|step|phase)$/i,       "current_step"],
  [/^(メモ|備考|memo|note|notes)$/i,                                       "memo"],
  [/^(状態|ステータス|status)$/i,                                          "status"],
];

function autoDetectField(header: string): InternalField | null {
  const h = header.trim();
  for (const [re, field] of HEADER_PATTERNS) {
    if (re.test(h)) return field;
  }
  return null;
}

/**
 * バイナリ → 文字列に decode。UTF-8 BOM / Shift_JIS を判定する。
 * 単純な判定:
 *   - 先頭 3 byte が EF BB BF → UTF-8 BOM。BOM を剥がして UTF-8 として返す。
 *   - そうでない場合は、まず UTF-8 として decode を試みて、置換文字 () が多ければ Shift_JIS。
 */
function decodeBuffer(buf: Buffer): { text: string; encoding: "utf-8" | "shift_jis" } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString("utf-8"), encoding: "utf-8" };
  }
  const asUtf8 = buf.toString("utf-8");
  // 置換文字 が一定割合以上含まれていたら Shift_JIS と推定
  const replCount = (asUtf8.match(/�/g) ?? []).length;
  if (replCount > 0 && replCount / asUtf8.length > 0.005) {
    return { text: iconv.decode(buf, "Shift_JIS"), encoding: "shift_jis" };
  }
  return { text: asUtf8, encoding: "utf-8" };
}

function detectDelimiter(filename: string, content: string, override: "auto" | "comma" | "tab"): "," | "\t" {
  if (override === "comma") return ",";
  if (override === "tab")   return "\t";
  if (filename.toLowerCase().endsWith(".tsv")) return "\t";
  // 先頭 1KB のタブ vs カンマで多い方
  const head = content.slice(0, 1024);
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function normalizeDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr) return null;
  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const m = dateStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  // HH:MM (24h) or HH時MM分
  let hh = "00";
  let mi = "00";
  if (timeStr) {
    const tm = timeStr.match(/^(\d{1,2})[:時](\d{1,2})/);
    if (tm) {
      hh = tm[1].padStart(2, "0");
      mi = tm[2].padStart(2, "0");
    }
  }
  // JST として ISO 文字列化 (+09:00) → Date
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+09:00`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** 単一列の「公演予約日時」を JST の Date に。空欄は null（"YYYY-MM-DD HH:mm" / ISO / 日付のみ 可）。 */
function parseReservedAt(input: string): Date | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(/[ T]+/);
  return normalizeDateTime(parts[0], parts[1] ?? "");
}

type ParsedRow = {
  raw:               Record<string, string>;
  display_name:      string | null;
  email:             string | null;
  line_user_id:      string | null;
  reservation_number: string | null;
  date:              string | null;
  time:              string | null;
  team_name:         string | null;
  current_step:      string | null;
  memo:              string | null;
  status:            string | null;
  scheduledAt:       Date | null;
  // PR2b-0b: team レベル項目
  reservedAt:        Date | null;
  purchaser_name:    string | null;
  group_type:        LiveTeamGroupType | null;
  room_number:       string | null;
  ticket_id:         string | null;
  warnings:          string[];
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("multipart/form-data の読み込みに失敗しました");
  }

  // ── options parse ─────────────────────────────────────────────────────
  const rawOptions: Record<string, string> = {};
  for (const key of ["mode", "work_id", "dedup", "teaming", "delimiter", "column_mapping"]) {
    const v = form.get(key);
    if (typeof v === "string") rawOptions[key] = v;
  }
  // クエリでも mode を受け付け
  const url = new URL(req.url);
  const qMode = url.searchParams.get("mode");
  if (qMode && !rawOptions.mode) rawOptions.mode = qMode;

  let options: z.infer<typeof optionsSchema>;
  try {
    options = optionsSchema.parse(rawOptions);
  } catch (err) {
    return badRequest(err instanceof z.ZodError ? err.errors[0]?.message ?? "options invalid" : "options invalid");
  }

  // ── work 検証 ─────────────────────────────────────────────────────────
  const work = await prisma.work.findFirst({
    where:  { id: options.work_id, oaId: params.id },
    select: { id: true, title: true, phases: { select: { id: true, name: true } } },
  });
  if (!work) return notFound("Work");

  // current_step 解決用 (= phase name → phase id)
  const phaseNameToId = new Map<string, string>();
  for (const ph of work.phases) phaseNameToId.set(ph.name.trim().toLowerCase(), ph.id);

  // ── ファイル取得 + decode ─────────────────────────────────────────────
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("file が必要です");
  if (file.size > 5 * 1024 * 1024) return badRequest("ファイルサイズは 5MB 以内にしてください");

  const buf = Buffer.from(await file.arrayBuffer());

  // Phase 2-H では .xlsx import は同 PR に含めない (= xlsx パッケージの
  // 既知 high severity 脆弱性 / 修正未提供のため別 PR で代替ライブラリ検討)。
  // ここでは CSV/TSV のみを処理する。.xlsx は明示的に拒否する。
  if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xlsm")) {
    return badRequest("Excel(.xlsx)インポートは別フェーズで対応予定です。CSV / TSV をご利用ください。");
  }

  let inputHeaders: string[] = [];
  let parsedData: Record<string, string>[] = [];
  let fileFormat: "csv" | "tsv" = "csv";
  let detectedEncoding: "utf-8" | "shift_jis" | "n/a" = "n/a";
  let detectedDelimiter: "comma" | "tab" | "n/a" = "n/a";

  {
    const decoded = decodeBuffer(buf);
    const delim = detectDelimiter(file.name, decoded.text, options.delimiter);
    detectedEncoding = decoded.encoding;
    detectedDelimiter = delim === "\t" ? "tab" : "comma";
    fileFormat = delim === "\t" ? "tsv" : "csv";

    const parsed = Papa.parse<Record<string, string>>(decoded.text, {
      header:           true,
      delimiter:        delim,
      skipEmptyLines:   true,
      transformHeader:  (h) => h.trim(),
    });

    if (parsed.errors.length > 0) {
      const msg = parsed.errors.slice(0, 3).map((e) => `${e.row ?? "?"}: ${e.message}`).join(" / ");
      return badRequest(`CSV 解析エラー: ${msg}`);
    }

    inputHeaders = parsed.meta.fields ?? [];
    parsedData = (parsed.data ?? []) as Record<string, string>[];
  }

  // ── 列マッピング解決 ─────────────────────────────────────────────────
  const headerFields: Record<string, InternalField | null> = {};

  // 任意上書き: form の column_mapping (= { "<header>": "<field>" })
  let userMapping: Record<string, InternalField> = {};
  if (options.column_mapping) {
    try {
      const parsedMap = JSON.parse(options.column_mapping);
      if (parsedMap && typeof parsedMap === "object") {
        userMapping = parsedMap as Record<string, InternalField>;
      }
    } catch {
      return badRequest("column_mapping の JSON が不正です");
    }
  }
  for (const h of inputHeaders) {
    headerFields[h] = userMapping[h] ?? autoDetectField(h);
  }

  const fieldToHeader = new Map<InternalField, string>();
  for (const [h, f] of Object.entries(headerFields)) {
    if (f && !fieldToHeader.has(f)) fieldToHeader.set(f, h);
  }

  // ── 各行を ParsedRow に変換 ──────────────────────────────────────────
  const rows: ParsedRow[] = parsedData.map((raw) => {
    const get = (f: InternalField): string | null => {
      const h = fieldToHeader.get(f);
      if (!h) return null;
      const v = raw[h];
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };
    const date = get("__date");
    const time = get("__time");
    const scheduledAt = date ? normalizeDateTime(date, time ?? "") : null;
    const warnings: string[] = [];
    const cs = get("current_step");
    if (cs && !phaseNameToId.has(cs.trim().toLowerCase())) {
      warnings.push(`current_step "${cs}" は選択中作品のフェーズに一致しません(legacy 文字列として保存)`);
    }
    if (date && !scheduledAt) {
      warnings.push(`参加日 "${date}" / 開始時間 "${time ?? ""}" のパースに失敗`);
    }
    // PR2b-0b: team レベル項目のパース + 表記ゆれ吸収
    const rawGroup = get("group_type");
    const group_type = normalizeGroupType(rawGroup);
    if (rawGroup && !group_type) {
      warnings.push(`グループ種別 "${rawGroup}" は 2人/4人 として解釈できません(未設定として扱います)`);
    }
    const rawReserved = get("reserved_at");
    const reservedAt = rawReserved ? parseReservedAt(rawReserved) : null;
    if (rawReserved && !reservedAt) {
      warnings.push(`公演予約日時 "${rawReserved}" のパースに失敗`);
    }
    return {
      raw,
      display_name:       get("display_name"),
      email:              get("email"),
      line_user_id:       get("line_user_id"),
      reservation_number: get("reservation_number"),
      date,
      time,
      team_name:          get("team_name"),
      current_step:       get("current_step"),
      memo:               get("memo"),
      status:             get("status"),
      scheduledAt,
      reservedAt,
      purchaser_name:     get("purchaser_name"),
      group_type,
      room_number:        get("room_number"),
      ticket_id:          get("ticket_id"),
      warnings,
    };
  });

  // 必須チェック: display_name は最低限欲しい
  const fileWarnings: string[] = [];
  const noNameRows = rows.filter((r) => !r.display_name).length;
  if (noNameRows > 0) fileWarnings.push(`display_name が空の行が ${noNameRows} 件あります(スキップされます)`);
  if (!fieldToHeader.get("display_name")) fileWarnings.push("display_name にマップされた列がありません");

  // ── preview モード ───────────────────────────────────────────────────
  if (options.mode === "preview") {
    return ok({
      mode:               "preview",
      file_format:        fileFormat,
      encoding:           detectedEncoding,
      delimiter:          detectedDelimiter,
      detected_columns:   Object.entries(headerFields).map(([h, f]) => ({ header: h, mapped_field: f })),
      preview_rows:       rows.slice(0, 20).map((r) => ({
        raw:                r.raw,
        display_name:       r.display_name,
        reservation_number: r.reservation_number,
        date:               r.date,
        time:               r.time,
        scheduled_at:       r.scheduledAt,
        team_name:          r.team_name,
        current_step:       r.current_step,
        memo:               r.memo,
        // PR2b-0b: team レベル項目
        reserved_at:        r.reservedAt,
        purchaser_name:     r.purchaser_name,
        group_type:         r.group_type,
        room_number:        r.room_number,
        ticket_id:          r.ticket_id,
        warnings:           r.warnings,
      })),
      total_rows:         rows.length,
      file_warnings:      fileWarnings,
      work:               { id: work.id, title: work.title, phase_count: work.phases.length },
    });
  }

  // ── apply モード ─────────────────────────────────────────────────────
  // 1. scheduledAt → セッション解決 (= 既存 LiveSession.startsAt と分単位一致 / なければ作成)
  const sessionByMinuteKey = new Map<string, string>(); // "yyyy-mm-ddThh:mm" → sessionId
  const existingSessions = await prisma.liveSession.findMany({
    where:  { oaId: params.id, workId: options.work_id },
    select: { id: true, startsAt: true },
  });
  for (const s of existingSessions) {
    if (!s.startsAt) continue;
    const k = minuteKey(s.startsAt);
    if (!sessionByMinuteKey.has(k)) sessionByMinuteKey.set(k, s.id);
  }

  // 2. チーム解決用のヘルパー
  let teamsCreated = 0; // PR2b-0b: 取込で新規作成した LiveTeam 数
  const teamCacheBySession = new Map<string, LiveTeamCache>();
  type LiveTeamCache = {
    byName: Map<string, string>;            // teamName → teamId
    byReservation: Map<string, string>;     // reservationNumber → teamId
    nextAutoIndex: number;                  // by_4 自動採番カウンタ
    autoBucket: { teamId: string; count: number } | null;
  };

  // PR2b-0b: 行から LiveTeam の予約/部屋情報を組み立てる（team 新規作成時に反映。既存 team は変更しない）。
  const teamFieldsFromRow = (row: ParsedRow) => ({
    reservedAt:    row.reservedAt,
    purchaserName: row.purchaser_name,
    groupType:     row.group_type,
    roomNumber:    row.room_number,
    ticketId:      row.ticket_id,
    ...(row.memo ? { memo: row.memo } : {}),
  });

  const createSessionFor = async (dt: Date): Promise<string> => {
    const k = minuteKey(dt);
    const cached = sessionByMinuteKey.get(k);
    if (cached) return cached;
    const name = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}回`;
    const created = await prisma.liveSession.create({
      data: { oaId: params.id, workId: options.work_id, name, startsAt: dt },
      select: { id: true },
    });
    sessionByMinuteKey.set(k, created.id);
    return created.id;
  };

  const ensureTeamCache = async (sessionId: string): Promise<LiveTeamCache> => {
    let cache = teamCacheBySession.get(sessionId);
    if (cache) return cache;
    const teams = await prisma.liveTeam.findMany({
      where:  { liveSessionId: sessionId },
      select: { id: true, name: true, reservationNumber: true },
    });
    cache = {
      byName: new Map(),
      byReservation: new Map(),
      nextAutoIndex: 1,
      autoBucket: null,
    };
    for (const t of teams) {
      cache.byName.set(t.name, t.id);
      if (t.reservationNumber) cache.byReservation.set(t.reservationNumber, t.id);
    }
    teamCacheBySession.set(sessionId, cache);
    return cache;
  };

  const resolveTeamId = async (sessionId: string, row: ParsedRow): Promise<string | null> => {
    if (options.teaming === "none") return null;
    const cache = await ensureTeamCache(sessionId);
    if (options.teaming === "by_team_name_column") {
      if (!row.team_name) return null;
      const cached = cache.byName.get(row.team_name);
      if (cached) return cached;
      const created = await prisma.liveTeam.create({
        data: { oaId: params.id, liveSessionId: sessionId, name: row.team_name, ...teamFieldsFromRow(row) },
        select: { id: true },
      });
      teamsCreated += 1;
      cache.byName.set(row.team_name, created.id);
      return created.id;
    }
    if (options.teaming === "by_reservation") {
      if (!row.reservation_number) return null;
      const cached = cache.byReservation.get(row.reservation_number);
      if (cached) return cached;
      const name = `予約 ${row.reservation_number}`;
      const created = await prisma.liveTeam.create({
        data: {
          oaId:              params.id,
          liveSessionId:     sessionId,
          name,
          reservationNumber: row.reservation_number,
          ...teamFieldsFromRow(row),
        },
        select: { id: true },
      });
      teamsCreated += 1;
      cache.byReservation.set(row.reservation_number, created.id);
      cache.byName.set(name, created.id);
      return created.id;
    }
    if (options.teaming === "by_4") {
      // 4 人ずつ詰める
      if (!cache.autoBucket || cache.autoBucket.count >= 4) {
        const name = `チーム ${cache.nextAutoIndex}`;
        const created = await prisma.liveTeam.create({
          data: { oaId: params.id, liveSessionId: sessionId, name },
          select: { id: true },
        });
        teamsCreated += 1;
        cache.autoBucket = { teamId: created.id, count: 0 };
        cache.nextAutoIndex += 1;
        cache.byName.set(name, created.id);
      }
      cache.autoBucket.count += 1;
      return cache.autoBucket.teamId;
    }
    return null;
  };

  // 3. 行ごとに処理
  let created = 0;
  let skipped = 0;
  let overwritten = 0;
  let duplicated = 0;
  const errors: { row_index: number; message: string }[] = [];

  try {
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const hasName = !!r.display_name;
      const hasTeamInfo = !!(
        r.reservation_number || r.team_name || r.ticket_id ||
        r.purchaser_name || r.room_number || r.group_type || r.reservedAt
      );
      // 氏名も team 情報も無い空行はスキップ
      if (!hasName && !hasTeamInfo) { skipped += 1; continue; }

      // session 解決（team/participant いずれも session が必要）
      let sessionId: string;
      if (r.scheduledAt) {
        sessionId = await createSessionFor(r.scheduledAt);
      } else {
        // scheduledAt 無しのデータは「workId 紐付けの未スケジュール回」を 1 つ作る
        // = 既存の workId 紐付き / startsAt=null セッションを再利用
        const fallback = await prisma.liveSession.findFirst({
          where:  { oaId: params.id, workId: options.work_id, startsAt: null },
          select: { id: true },
        });
        if (fallback) {
          sessionId = fallback.id;
        } else {
          const f = await prisma.liveSession.create({
            data: { oaId: params.id, workId: options.work_id, name: `${work.title} (未スケジュール)` },
            select: { id: true },
          });
          sessionId = f.id;
        }
      }

      // チーム解決 + 予約/部屋情報の反映（PR2b-0b）。
      // 予約名簿（氏名なし・予約/部屋情報のみ）でも team を作れるよう、氏名の有無に依らず解決する。
      // ただし by_4/none は氏名なし行では team 化しない（グループ同定ができないため）。
      let teamId: string | null = null;
      if (hasName || options.teaming === "by_reservation" || options.teaming === "by_team_name_column") {
        teamId = await resolveTeamId(sessionId, r);
      }

      // 参加者行の作成は氏名が必須（team は上で作成/補完済み）。
      if (!r.display_name) { skipped += 1; continue; }

      // dedup 判定
      let existing: { id: string } | null = null;
      if (r.reservation_number) {
        existing = await prisma.liveParticipant.findFirst({
          where: {
            liveSessionId:     sessionId,
            reservationNumber: r.reservation_number,
            displayName:       r.display_name,
          },
          select: { id: true },
        });
      } else if (r.email) {
        existing = await prisma.liveParticipant.findFirst({
          where: {
            liveSessionId: sessionId,
            displayName:   r.display_name,
            memo:          { contains: `email: ${r.email}` },
          },
          select: { id: true },
        });
      }

      if (existing && options.dedup === "skip") {
        skipped += 1;
        continue;
      }

      // current_step 解決
      const phaseId = r.current_step ? (phaseNameToId.get(r.current_step.trim().toLowerCase()) ?? null) : null;
      const currentStepFallback = phaseId ? null : (r.current_step ?? null);

      // status 正規化 (= enum)
      const status = (() => {
        const allowed = new Set(["waiting", "active", "stuck", "completed", "dropped"]);
        if (r.status && allowed.has(r.status.toLowerCase())) return r.status.toLowerCase() as "waiting" | "active" | "stuck" | "completed" | "dropped";
        return undefined;
      })();

      // memo に email を保持 (= legacy 互換 / 検索可能化)
      const memoParts: string[] = [];
      if (r.memo) memoParts.push(r.memo);
      if (r.email) memoParts.push(`email: ${r.email}`);
      const memo = memoParts.length > 0 ? memoParts.join("\n") : null;

      const data = {
        oaId:               params.id,
        liveSessionId:      sessionId,
        teamId,
        displayName:        r.display_name,
        lineUserId:         r.line_user_id,
        reservationNumber:  r.reservation_number,
        currentPhaseId:     phaseId,
        currentStep:        currentStepFallback,
        memo,
        ...(status ? { status } : {}),
      };

      if (existing && options.dedup === "overwrite") {
        await prisma.liveParticipant.update({ where: { id: existing.id }, data });
        overwritten += 1;
        continue;
      }

      // duplicate or no existing → 新規作成
      await prisma.liveParticipant.create({ data });
      if (existing && options.dedup === "duplicate") {
        duplicated += 1;
      } else {
        created += 1;
      }
    }
  } catch (err) {
    return serverError(err);
  }

  return ok({
    mode:         "apply",
    file_format:  fileFormat,
    encoding:     detectedEncoding,
    delimiter:    detectedDelimiter,
    created,
    skipped,
    overwritten,
    duplicated,
    teams_created: teamsCreated,
    errors,
    file_warnings: fileWarnings,
  });
}

function minuteKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
