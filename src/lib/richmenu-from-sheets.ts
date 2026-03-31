// src/lib/richmenu-from-sheets.ts
// Google Spreadsheet の RichMenus / RichMenuItems シートから
// LINE Messaging API の RichMenuConfig を生成するビルダー

import type { RichMenuConfig, RichMenuArea } from "./line-richmenu";
import { fetchSheetRows } from "./google-sheets-client";

// ────────────────────────────────────────────────
// シートデータ型
// ────────────────────────────────────────────────

export interface SpreadsheetRichMenu {
  richmenu_id:   string;
  work_id:       string;
  name:          string;
  template_type: string;
  chat_bar_text: string;
  is_default:    boolean;
  image_url:     string | null;
  note:          string | null;
  /** "start" | "playing" | "cleared" | "none"（常時） */
  visible_phase: string | null;
}

export interface SpreadsheetRichMenuItem {
  richmenu_id:  string;
  slot_no:      number;
  label:        string;
  /** "message" | "action"（→ postback）| "uri" */
  action_type:  "message" | "action" | "uri";
  action_value: string;
  is_active:    boolean;
}

// ────────────────────────────────────────────────
// テンプレート → 座標変換
// ────────────────────────────────────────────────

type Bounds = { x: number; y: number; width: number; height: number };

const LINE_W = 2500;

/**
 * template_type + slot_no → LINE 座標 bounds を計算する。
 *
 * template_type 対応表:
 *   "3col"       : 3 列均等
 *   "2col"       : 2 列均等
 *   "4grid"      : 2×2 グリッド（slot 1=左上, 2=右上, 3=左下, 4=右下）
 *   "6grid"      : 3×2 グリッド（左→右, 上→下）
 *   "2row"       : 2 行均等
 *   "3col-2row"  : 3 列 × 2 行（= 6grid と同じ）
 *   "fullscreen" : 全面 1 ボタン
 */
export function calcBounds(
  templateType: string,
  slotNo:       number,
  size:         "compact" | "full" = "compact",
): Bounds {
  const H = size === "full" ? 1686 : 843;
  const W = LINE_W;

  switch (templateType) {
    case "3col": {
      const sw  = Math.floor(W / 3);
      const col = (slotNo - 1) % 3;
      return {
        x:      col === 2 ? sw * 2 : sw * col,
        y:      0,
        width:  col === 2 ? W - sw * 2 : sw,
        height: H,
      };
    }
    case "2col": {
      const hw = Math.floor(W / 2);
      return {
        x:      slotNo === 1 ? 0 : hw,
        y:      0,
        width:  slotNo === 1 ? hw : W - hw,
        height: H,
      };
    }
    case "4grid": {
      const hw  = Math.floor(W / 2);
      const hh  = Math.floor(H / 2);
      const col = (slotNo - 1) % 2;        // 0 or 1
      const row = Math.floor((slotNo - 1) / 2); // 0 or 1
      return {
        x:      col === 0 ? 0 : hw,
        y:      row === 0 ? 0 : hh,
        width:  col === 0 ? hw : W - hw,
        height: row === 0 ? hh : H - hh,
      };
    }
    case "6grid":
    case "3col-2row": {
      const sw  = Math.floor(W / 3);
      const hh  = Math.floor(H / 2);
      const col = (slotNo - 1) % 3;
      const row = Math.floor((slotNo - 1) / 3);
      return {
        x:      col === 2 ? sw * 2 : sw * col,
        y:      row === 0 ? 0 : hh,
        width:  col === 2 ? W - sw * 2 : sw,
        height: row === 0 ? hh : H - hh,
      };
    }
    case "2row": {
      const hh = Math.floor(H / 2);
      return {
        x:      0,
        y:      slotNo === 1 ? 0 : hh,
        width:  W,
        height: slotNo === 1 ? hh : H - hh,
      };
    }
    case "fullscreen":
    case "1": {
      return { x: 0, y: 0, width: W, height: H };
    }
    default: {
      // 未知のテンプレートは全面フォールバック
      console.warn(`[richmenu-builder] 未知の template_type: "${templateType}" → 全面フォールバック`);
      return { x: 0, y: 0, width: W, height: H };
    }
  }
}

// ────────────────────────────────────────────────
// アイテム → LINE Area 変換
// ────────────────────────────────────────────────

function itemToArea(
  item:         SpreadsheetRichMenuItem,
  templateType: string,
  size:         "compact" | "full",
): RichMenuArea {
  const bounds = calcBounds(templateType, item.slot_no, size);

  switch (item.action_type) {
    case "message":
      return {
        bounds,
        action: { type: "message", label: item.label, text: item.action_value },
      };
    case "action":
      // スプレッドシートの "action" = LINE postback
      return {
        bounds,
        action: {
          type:        "postback",
          label:       item.label,
          data:        item.action_value,
          displayText: item.label,
        },
      };
    case "uri":
      return {
        bounds,
        action: { type: "uri", label: item.label, uri: item.action_value },
      };
    default:
      throw new Error(`未知の action_type: "${item.action_type}" (slot_no: ${item.slot_no})`);
  }
}

// ────────────────────────────────────────────────
// メニュー + アイテム → LINE RichMenuConfig
// ────────────────────────────────────────────────

export function buildRichMenuConfig(
  menu:  SpreadsheetRichMenu,
  items: SpreadsheetRichMenuItem[],
  size:  "compact" | "full" = "compact",
): RichMenuConfig {
  const H = size === "full" ? 1686 : 843;
  const activeItems = items
    .filter((it) => it.is_active)
    .sort((a, b) => a.slot_no - b.slot_no);

  if (activeItems.length === 0) {
    throw new Error(`RichMenu "${menu.richmenu_id}" にアクティブなアイテムがありません`);
  }

  return {
    size:        { width: LINE_W, height: H },
    selected:    menu.is_default,
    name:        menu.name,
    chatBarText: menu.chat_bar_text,
    areas:       activeItems.map((item) => itemToArea(item, menu.template_type, size)),
  };
}

// ────────────────────────────────────────────────
// Google Sheets データ読み込み
// ────────────────────────────────────────────────

export async function loadRichMenusFromSheets(
  spreadsheetId: string,
  workId?:       string,
): Promise<SpreadsheetRichMenu[]> {
  const rows = await fetchSheetRows(spreadsheetId, "RichMenus");

  return rows
    .filter((r) => r["richmenu_id"] != null)
    .filter((r) => !workId || r["work_id"] === workId)
    .map((r) => ({
      richmenu_id:   String(r["richmenu_id"]),
      work_id:       String(r["work_id"] ?? ""),
      name:          String(r["name"] ?? ""),
      template_type: String(r["template_type"] ?? "4grid"),
      chat_bar_text: String(r["chat_bar_text"] ?? "メニュー"),
      is_default:    Boolean(r["is_default"]),
      image_url:     r["image_url"] && r["image_url"] !== "https://..." ? String(r["image_url"]) : null,
      note:          r["note"] ? String(r["note"]) : null,
      visible_phase: r["visible_phase"] ? String(r["visible_phase"]) : null,
    }));
}

export async function loadRichMenuItemsFromSheets(
  spreadsheetId: string,
  richMenuId:    string,
): Promise<SpreadsheetRichMenuItem[]> {
  const rows = await fetchSheetRows(spreadsheetId, "RichMenuItems");

  return rows
    .filter((r) => r["richmenu_id"] === richMenuId)
    .map((r) => ({
      richmenu_id:  String(r["richmenu_id"]),
      slot_no:      Number(r["slot_no"]),
      label:        String(r["label"] ?? ""),
      action_type:  (String(r["action_type"] ?? "message")) as "message" | "action" | "uri",
      action_value: String(r["action_value"] ?? ""),
      is_active:    r["is_active"] !== false && r["is_active"] !== "false" && r["is_active"] !== "FALSE",
    }));
}
