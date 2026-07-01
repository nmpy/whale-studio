// src/lib/spreadsheet-import/template.ts
// 取り込み用 .xlsx テンプレートを生成する（README + characters/phases/messages の4シート）。
// 1行目=ヘッダ・2行目以降=サンプル行。message_kind / TRUE-FALSE は固定リスト、
// phase_key / character_key 系はクロスシート範囲リストの dataValidation を付与する（行2〜200）。
// server 専用（exceljs を動的 import）。

export const TEMPLATE_FILENAME = "spreadsheet-import-template.xlsx";

export const CHARACTER_HEADERS = ["character_key", "name", "icon_image_url", "display_order"] as const;
export const PHASE_HEADERS = ["phase_key", "name", "display_order", "is_start_phase", "start_trigger", "summary", "is_active"] as const;
export const MESSAGE_HEADERS = [
  "message_key", "phase_key", "sort_order", "message_kind", "character_key", "content", "image_url",
  "choice_1_label", "choice_1_next_phase_key", "choice_2_label", "choice_2_next_phase_key",
  "choice_3_label", "choice_3_next_phase_key", "choice_4_label", "choice_4_next_phase_key",
  "response_keyword", "next_phase_key", "delay_seconds",
] as const;

const KIND_LIST = '"セリフ,ナレーション,システム,画像,選択肢,入力待ち"';
const BOOL_LIST = '"TRUE,FALSE"';
const PHASE_REF = "=phases!$A$2:$A$200";
const CHAR_REF = "=characters!$A$2:$A$200";
const VALIDATION_LAST_ROW = 200;

/** 指定列(1始まり)の row 2..200 に list 型 dataValidation を付与。 */
function applyListValidation(ws: import("exceljs").Worksheet, col: number, formula: string): void {
  for (let r = 2; r <= VALIDATION_LAST_ROW; r++) {
    ws.getCell(r, col).dataValidation = { type: "list", allowBlank: true, formulae: [formula] };
  }
}

export async function buildTemplateWorkbook(): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // ── README ──
  const readme = wb.addWorksheet("README");
  readme.getColumn(1).width = 100;
  const lines: string[] = [
    "スプレッドシート取り込みテンプレート",
    "",
    "このファイルでキャラクター・フェーズ・メッセージを一括登録できます。",
    "characters / phases / messages の3シートに入力してアップロードしてください。",
    "サンプル行が入っています。サンプル行は削除・編集して使ってください。",
    "",
    "■ 共通の注意",
    "・取り込みは「追加・更新」のみです。シートに無い既存データは削除されません。",
    "・画像はURL指定のみ対応です（画像ファイルのアップロードは対象外）。",
    "・開始フェーズを変更する場合は、既存の開始フェーズと競合しないようにしてください。",
    "・*_key（character_key / phase_key / message_key）は管理用の安定キーです。英数字・アンダースコア推奨。変更すると別データ扱いになります。",
    "・数式セルは基本的に入力値として利用しないでください。内部的にはシートに保存されている計算結果が取得できる場合のみその結果を読み取りますが、計算結果キャッシュがない数式セルは空欄として扱われる場合があります。テンプレートでは固定値またはプルダウン選択値の利用を推奨します。",
    "",
    "■ characters シート",
    "・character_key: 管理用キー。例 chief",
    "・name: 表示名。例 長官",
    "・icon_image_url: 任意。アイコン画像URL",
    "・display_order: 任意。表示順（数値）",
    "",
    "■ phases シート",
    "・phase_key: 管理用キー。例 intro",
    "・name: フェーズ名。例 導入",
    "・display_order: 任意。表示順（数値）",
    "・is_start_phase: 開始フェーズなら TRUE（開始フェーズは1つだけ）",
    "・start_trigger: 開始キーワード（任意）",
    "・summary: 途中からはじめる時に使うあらすじ（任意）",
    "・is_active: TRUE/FALSE。未入力なら TRUE 扱い",
    "",
    "■ messages シート",
    "・message_key: 管理用キー。例 intro_001",
    "・phase_key: 所属フェーズのキー",
    "・sort_order: 同じフェーズ内の送信順（数値）",
    "・message_kind: メッセージ種別（セリフ / ナレーション / システム / 画像 / 選択肢 / 入力待ち）",
    "・character_key: セリフの場合に使用",
    "・content: 本文",
    "・image_url: 画像メッセージ用URL",
    "・choice_n_label / choice_n_next_phase_key: 選択肢の文言と遷移先（必ずセットで入力）",
    "・response_keyword: 入力待ちでユーザーが送るキーワード",
    "・next_phase_key: 入力待ちで遷移するフェーズ",
    "・delay_seconds: 送信待機秒数（0〜30）",
    "",
    "■ message_kind ごとの必須項目",
    "・セリフ: character_key, content",
    "・ナレーション: content",
    "・システム: content",
    "・画像: image_url（content は任意）",
    "・選択肢: content と、1つ以上の choice_n_label + choice_n_next_phase_key",
    "・入力待ち: content, response_keyword, next_phase_key",
  ];
  lines.forEach((t) => readme.addRow([t]));
  readme.getRow(1).font = { bold: true, size: 14 };

  // ── characters ──
  const cs = wb.addWorksheet("characters");
  cs.addRow([...CHARACTER_HEADERS]);
  cs.addRow(["chief", "長官", "", ""]);
  cs.addRow(["system", "システム", "", ""]);

  // ── phases ──
  const ps = wb.addWorksheet("phases");
  ps.addRow([...PHASE_HEADERS]);
  ps.addRow(["intro", "導入", 1, "TRUE", "はじめる", "", "TRUE"]);
  ps.addRow(["room_left", "左の部屋", 2, "FALSE", "", "", "TRUE"]);
  ps.addRow(["room_right", "右の部屋", 3, "FALSE", "", "", "TRUE"]);
  applyListValidation(ps, 4, BOOL_LIST); // is_start_phase
  applyListValidation(ps, 7, BOOL_LIST); // is_active

  // ── messages ──
  const ms = wb.addWorksheet("messages");
  ms.addRow([...MESSAGE_HEADERS]);
  const blanks = (n: number) => Array(n).fill("");
  ms.addRow(["intro_001", "intro", 1, "ナレーション", "", "あなたは薄暗い部屋で目を覚ました。", ...blanks(12)]);
  ms.addRow(["intro_002", "intro", 2, "セリフ", "chief", "ようやく目が覚めたか。", ...blanks(12)]);
  ms.addRow(["intro_003", "intro", 3, "選択肢", "", "どちらへ進みますか？", "",
    "左へ進む", "room_left", "右へ進む", "room_right", "", "", "", "", "", "", ""]);
  ms.addRow(["room_left_001", "room_left", 1, "入力待ち", "", "合言葉を入力してください。", "",
    "", "", "", "", "", "", "", "", "OPEN", "room_right", ""]);
  applyListValidation(ms, 4, KIND_LIST);   // message_kind
  applyListValidation(ms, 2, PHASE_REF);   // phase_key
  applyListValidation(ms, 5, CHAR_REF);    // character_key
  applyListValidation(ms, 9, PHASE_REF);   // choice_1_next_phase_key
  applyListValidation(ms, 11, PHASE_REF);  // choice_2_next_phase_key
  applyListValidation(ms, 13, PHASE_REF);  // choice_3_next_phase_key
  applyListValidation(ms, 15, PHASE_REF);  // choice_4_next_phase_key
  applyListValidation(ms, 17, PHASE_REF);  // next_phase_key

  // ヘッダ行を太字に。
  for (const ws of [cs, ps, ms]) ws.getRow(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
}
