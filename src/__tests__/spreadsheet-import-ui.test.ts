// src/__tests__/spreadsheet-import-ui.test.ts
// PR3: feature flag 判定・エラー文言マッピング・テンプレート生成の検証。
import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpreadsheetImportEnabled, formatImportError } from "@/lib/spreadsheet-import/ui-text";
import { buildTemplateWorkbook } from "@/lib/spreadsheet-import/template";
import { parseWorkbook } from "@/lib/spreadsheet-import/parse";
import { normalizeSheets } from "@/lib/spreadsheet-import/normalize";
import { validateImport } from "@/lib/spreadsheet-import/validate";
import type { ImportError, ExistingData } from "@/lib/spreadsheet-import/types";

afterEach(() => vi.unstubAllEnvs());

describe("isSpreadsheetImportEnabled", () => {
  it("'true' のときだけ有効", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "true");
    expect(isSpreadsheetImportEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "false");
    expect(isSpreadsheetImportEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT", "");
    expect(isSpreadsheetImportEnabled()).toBe(false);
  });
});

describe("formatImportError（シート/行/カラム/直し方）", () => {
  const e = (o: Partial<ImportError>): ImportError => ({ sheet: "messages", row: 8, code: "REQUIRED", message: "x", ...o });
  it("シート名(日本語)と行番号を前置", () => {
    expect(formatImportError(e({ code: "REQUIRED", message: "content は必須です", row: 12 }))).toBe("メッセージ シート 12行目：content は必須です");
  });
  it("REF_NOT_FOUND(phase_key) は確認先を追記", () => {
    const s = formatImportError(e({ code: "REF_NOT_FOUND", column: "phase_key", message: "phase_key「intro_2」が見つかりません", row: 8 }));
    expect(s).toContain("メッセージ シート 8行目：");
    expect(s).toContain("phases シートに該当のフェーズがあるか確認してください");
  });
  it("REF_NOT_FOUND(character_key) は characters を案内", () => {
    const s = formatImportError(e({ code: "REF_NOT_FOUND", column: "character_key", message: "character_key「x」が見つかりません" }));
    expect(s).toContain("characters シートに該当のキャラクターがあるか確認してください");
  });
  it("file / row=0 は行番号を出さない", () => {
    expect(formatImportError(e({ sheet: "file", row: 0, code: "PARSE_ERROR", message: "解析に失敗しました" }))).toBe("ファイル：解析に失敗しました");
  });
  it("未知 code は API message をそのまま使う", () => {
    expect(formatImportError(e({ code: "PARSE_ERROR" as ImportError["code"], message: "なにか", row: 3 }))).toBe("メッセージ シート 3行目：なにか");
  });
});

describe("buildTemplateWorkbook", () => {
  it("README + characters/phases/messages の4シート・ヘッダ・サンプル・プルダウンを含む", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const buf = await buildTemplateWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);

    for (const name of ["README", "characters", "phases", "messages"]) {
      expect(wb.getWorksheet(name), `sheet ${name}`).toBeTruthy();
    }
    // ヘッダ
    const msgHeaders = (wb.getWorksheet("messages")!.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
    expect(msgHeaders).toContain("message_key");
    expect(msgHeaders).toContain("message_kind");
    expect(msgHeaders).toContain("delay_seconds");
    const charHeaders = (wb.getWorksheet("characters")!.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
    expect(charHeaders).toContain("character_key");

    // サンプル行
    expect(String(wb.getWorksheet("characters")!.getCell("A2").value)).toBe("chief");

    // message_kind(D列) に list の dataValidation が入っている
    const dv = wb.getWorksheet("messages")!.getCell("D2").dataValidation;
    expect(dv?.type).toBe("list");
  });

  it("テンプレートのサンプルは PR2 の検証を通る（end-to-end）", async () => {
    const buf = await buildTemplateWorkbook();
    const raw = await parseWorkbook(buf as ArrayBuffer);
    const existing: ExistingData = {
      characterKeys: new Set(), phaseKeys: new Set(), messageKeys: new Set(),
      existingStartPhase: null, transitionKeys: new Set(),
    };
    const errors = validateImport(raw, normalizeSheets(raw), existing);
    expect(errors).toEqual([]);
  });
});
