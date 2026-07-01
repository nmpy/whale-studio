// src/__tests__/spreadsheet-import.test.ts
// スプレッドシート取り込みの純ロジック（parse/normalize/validate/preview）と apply のマッピング検証。
import { describe, it, expect, vi } from "vitest";
import { parseWorkbook } from "@/lib/spreadsheet-import/parse";
import { normalizeSheets } from "@/lib/spreadsheet-import/normalize";
import { validateImport } from "@/lib/spreadsheet-import/validate";
import { buildPreview } from "@/lib/spreadsheet-import/preview";
import { applyImport } from "@/lib/spreadsheet-import/apply";
import { checkImportFile, MAX_IMPORT_FILE_BYTES } from "@/lib/spreadsheet-import/file-guard";
import type { RawSheets, RawRow, ExistingData } from "@/lib/spreadsheet-import/types";

function emptyExisting(over: Partial<ExistingData> = {}): ExistingData {
  return {
    characterKeys: new Set(), phaseKeys: new Set(), messageKeys: new Set(),
    existingStartPhase: null, transitionKeys: new Set(), ...over,
  };
}
function row(r: number, cells: Record<string, string>): RawRow {
  return { _row: r, ...cells };
}
// 最小の正常データ（characters: chief / phases: intro(start) / messages: line, choice, input_wait）
function validRaw(): RawSheets {
  return {
    characters: [row(2, { character_key: "chief", name: "署長" })],
    phases: [
      row(2, { phase_key: "intro", name: "序章", is_start_phase: "TRUE", start_trigger: "はじめる" }),
      row(3, { phase_key: "room", name: "部屋" }),
      row(4, { phase_key: "ending", name: "終章" }),
    ],
    messages: [
      row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "line", character_key: "chief", content: "ようこそ" }),
      row(3, { message_key: "m2", phase_key: "intro", sort_order: "2", message_kind: "choice", content: "どうする？",
        choice_1_label: "左", choice_1_next_phase_key: "room", choice_2_label: "終わる", choice_2_next_phase_key: "ending" }),
      row(4, { message_key: "m3", phase_key: "room", sort_order: "1", message_kind: "input_wait", content: "合言葉は？", response_keyword: "くじら", next_phase_key: "ending" }),
    ],
  };
}

describe("checkImportFile（拡張子 / MIME / サイズ）", () => {
  it(".xlsx 以外は INVALID_FILE", () => {
    const r = checkImportFile(new File([new Uint8Array(10)], "data.csv"));
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
  });
  it("不正 MIME は INVALID_FILE", () => {
    const r = checkImportFile(new File([new Uint8Array(10)], "data.xlsx", { type: "image/png" }));
    expect(r).toMatchObject({ ok: false, code: "INVALID_FILE" });
  });
  it("上限超過は FILE_TOO_LARGE", () => {
    const r = checkImportFile(new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], "big.xlsx"));
    expect(r).toMatchObject({ ok: false, code: "FILE_TOO_LARGE" });
  });
  it("正常 .xlsx は ok", () => {
    expect(checkImportFile(new File([new Uint8Array(10)], "ok.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))).toEqual({ ok: true });
  });
});

describe("parse（xlsx ラウンドトリップ・日本語シート名）", () => {
  it("日本語シート名でも characters/phases/messages に正規化して読める", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const cs = wb.addWorksheet("キャラクター"); cs.addRow(["character_key", "name"]); cs.addRow(["chief", "署長"]);
    const ps = wb.addWorksheet("フェーズ");     ps.addRow(["phase_key", "name"]);     ps.addRow(["intro", "序章"]);
    const ms = wb.addWorksheet("メッセージ");   ms.addRow(["message_key", "phase_key", "sort_order", "message_kind", "content"]); ms.addRow(["m1", "intro", "1", "セリフ", "やあ"]);
    const buf = await wb.xlsx.writeBuffer();
    const raw = await parseWorkbook(buf as ArrayBuffer);
    expect(raw.characters?.length).toBe(1);
    expect(raw.characters?.[0].character_key).toBe("chief");
    expect(raw.phases?.[0].name).toBe("序章");
    expect(raw.messages?.[0].message_kind).toBe("セリフ");
  });
});

describe("normalize（日本語 message_kind / 真偽 / 数値）", () => {
  it("日本語種別→enum・TRUE→bool・数値化", () => {
    const n = normalizeSheets(validRaw());
    expect(n.messages[0].kind).toBe("line");
    const choiceRaw = normalizeSheets({ characters: null, phases: null, messages: [row(2, { message_kind: "選択肢", sort_order: "3" })] });
    expect(choiceRaw.messages[0].kind).toBe("choice");
    expect(choiceRaw.messages[0].sortOrder).toBe(3);
    expect(n.phases[0].isStartPhase).toBe(true);
  });
});

describe("validate", () => {
  it("正常データはエラーなし", () => {
    expect(validateImport(validRaw(), normalizeSheets(validRaw()), emptyExisting())).toEqual([]);
  });
  it("必須シート不足", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases, messages: validRaw().messages };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "SHEET_MISSING" && e.message.includes("characters"))).toBe(true);
  });
  it("必須カラム不足", () => {
    const raw: RawSheets = { characters: [row(2, { name: "署長" })], phases: validRaw().phases, messages: validRaw().messages };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "COLUMN_MISSING" && e.column === "character_key")).toBe(true);
  });
  it("key 重複（character_key / phase_key / message_key）", () => {
    const raw = validRaw();
    raw.characters!.push(row(3, { character_key: "chief", name: "別" }));
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "DUPLICATE_KEY" && e.sheet === "characters")).toBe(true);
  });
  it("line は character_key と content 必須", () => {
    const raw: RawSheets = { characters: validRaw().characters, phases: validRaw().phases,
      messages: [row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "line" })] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.filter((e) => e.code === "REQUIRED" && (e.column === "character_key" || e.column === "content")).length).toBe(2);
  });
  it("narration / system は content 必須", () => {
    for (const k of ["narration", "system"]) {
      const raw: RawSheets = { characters: null, phases: validRaw().phases,
        messages: [row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: k })] };
      const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
      expect(errs.some((e) => e.code === "REQUIRED" && e.column === "content")).toBe(true);
    }
  });
  it("image は image_url 必須", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases,
      messages: [row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "image" })] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "REQUIRED" && e.column === "image_url")).toBe(true);
  });
  it("choice は片側欠けエラー / 1つ以上必須", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases,
      messages: [row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "choice", content: "?", choice_1_label: "左" })] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "CHOICE_PAIR")).toBe(true);
  });
  it("input_wait の必須3点 + 遷移先参照", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases,
      messages: [row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "input_wait", content: "?", response_keyword: "x", next_phase_key: "nope" })] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "REF_NOT_FOUND" && e.column === "next_phase_key")).toBe(true);
  });
  it("同一フェーズ内 response_keyword 重複", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases, messages: [
      row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "input_wait", content: "a", response_keyword: "x", next_phase_key: "room" }),
      row(3, { message_key: "m2", phase_key: "intro", sort_order: "2", message_kind: "input_wait", content: "b", response_keyword: "x", next_phase_key: "ending" }),
    ] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "DUP_RESPONSE_KEYWORD")).toBe(true);
  });
  it("delay_seconds 範囲 / sort_order 数値 / phase内 sort_order 重複", () => {
    const raw: RawSheets = { characters: null, phases: validRaw().phases, messages: [
      row(2, { message_key: "m1", phase_key: "intro", sort_order: "1", message_kind: "narration", content: "a", delay_seconds: "99" }),
      row(3, { message_key: "m2", phase_key: "intro", sort_order: "1", message_kind: "narration", content: "b" }),
    ] };
    const errs = validateImport(raw, normalizeSheets(raw), emptyExisting());
    expect(errs.some((e) => e.code === "DELAY_RANGE")).toBe(true);
    expect(errs.some((e) => e.code === "DUP_SORT_ORDER")).toBe(true);
  });
  it("start phase 複数 / DB既存 start との競合", () => {
    const raw = validRaw();
    raw.phases!.push(row(5, { phase_key: "room2", name: "部屋2", is_start_phase: "TRUE" }));
    expect(validateImport(raw, normalizeSheets(raw), emptyExisting()).some((e) => e.code === "START_PHASE_MULTIPLE")).toBe(true);

    const raw2 = validRaw(); // intro が start
    const existing = emptyExisting({ existingStartPhase: { phaseKey: "other_start" } });
    expect(validateImport(raw2, normalizeSheets(raw2), existing).some((e) => e.code === "START_PHASE_CONFLICT")).toBe(true);
    // 同じ phase_key を更新するなら競合なし
    const existingSame = emptyExisting({ existingStartPhase: { phaseKey: "intro" } });
    expect(validateImport(raw2, normalizeSheets(raw2), existingSame).some((e) => e.code === "START_PHASE_CONFLICT")).toBe(false);
  });
});

describe("preview（create/update 集計）", () => {
  it("既存 key は update・新規は create", () => {
    const n = normalizeSheets(validRaw());
    const existing = emptyExisting({ characterKeys: new Set(["chief"]), phaseKeys: new Set(["intro"]) });
    const { summary } = buildPreview(n, existing);
    expect(summary.characters).toEqual({ create: 0, update: 1 });
    expect(summary.phases).toEqual({ create: 2, update: 1 });        // room/ending=create, intro=update
    expect(summary.messages.create).toBe(3);
    expect(summary.transitions.create).toBe(1);                       // input_wait 1件
  });
});

// ── apply（mock tx でマッピング検証）──
function makeTx() {
  const calls: Record<string, unknown[]> = { charUpsert: [], phaseUpsert: [], msgUpsert: [], tCreate: [], tUpdate: [] };
  const tx = {
    character: { upsert: vi.fn((a) => { calls.charUpsert.push(a); return Promise.resolve({}); }),
                 findMany: vi.fn(() => Promise.resolve([{ id: "char-chief", characterKey: "chief" }])) },
    phase: { upsert: vi.fn((a) => { calls.phaseUpsert.push(a); return Promise.resolve({}); }),
             findMany: vi.fn(() => Promise.resolve([
               { id: "p-intro", phaseKey: "intro" }, { id: "p-room", phaseKey: "room" }, { id: "p-ending", phaseKey: "ending" },
             ])) },
    message: { upsert: vi.fn((a) => { calls.msgUpsert.push(a); return Promise.resolve({}); }) },
    transition: { findFirst: vi.fn(() => Promise.resolve(null)),
                  create: vi.fn((a) => { calls.tCreate.push(a); return Promise.resolve({}); }),
                  update: vi.fn((a) => { calls.tUpdate.push(a); return Promise.resolve({}); }) },
  };
  return { tx, calls };
}

describe("apply（マッピング・冪等・削除なし）", () => {
  it("choice→quickReplies(JSON・phase遷移)・input_wait→Transition・delete系は呼ばない", async () => {
    const { tx, calls } = makeTx();
    await applyImport(tx as never, "work-1", normalizeSheets(validRaw()));

    // choice メッセージの quickReplies が phase 遷移 QR
    const choiceUpsert = calls.msgUpsert.find((c: any) => c.where.workId_messageKey.messageKey === "m2") as any;
    const qr = JSON.parse(choiceUpsert.create.quickReplies);
    expect(qr[0]).toMatchObject({ label: "左", action: "text", target_type: "phase", target_phase_id: "p-room", enabled: true });

    // input_wait → transition create（condition=response_keyword, to=ending）
    expect(calls.tCreate.length).toBe(1);
    expect((calls.tCreate[0] as any).data).toMatchObject({ workId: "work-1", fromPhaseId: "p-room", toPhaseId: "p-ending", condition: "くじら", label: "くじら" });

    // line の characterId 解決
    const lineUpsert = calls.msgUpsert.find((c: any) => c.where.workId_messageKey.messageKey === "m1") as any;
    expect(lineUpsert.create.characterId).toBe("char-chief");
    expect(lineUpsert.create.kind).toBe("normal");

    // 削除系メソッドは存在しない＝呼べない（upsert/create/update のみ）
    expect((tx as any).message.delete).toBeUndefined();
    expect((tx as any).phase.deleteMany).toBeUndefined();
  });

  it("既存フェーズ更新時 phaseType を保持（is_start_phase 空なら update に phaseType を入れない）", async () => {
    const { tx, calls } = makeTx();
    const raw: RawSheets = { characters: null, phases: [row(2, { phase_key: "ending", name: "終章" })], messages: null };
    await applyImport(tx as never, "work-1", normalizeSheets(raw));
    const up = calls.phaseUpsert.find((c: any) => c.where.workId_phaseKey.phaseKey === "ending") as any;
    expect(up.update.phaseType).toBeUndefined();        // 既存 ending を normal に戻さない
    expect(up.create.phaseType).toBe("normal");
  });

  it("is_start_phase=true は update でも phaseType=start にする", async () => {
    const { tx, calls } = makeTx();
    const raw: RawSheets = { characters: null, phases: [row(2, { phase_key: "intro", name: "序章", is_start_phase: "TRUE" })], messages: null };
    await applyImport(tx as never, "work-1", normalizeSheets(raw));
    const up = calls.phaseUpsert.find((c: any) => c.where.workId_phaseKey.phaseKey === "intro") as any;
    expect(up.update.phaseType).toBe("start");
  });
});
