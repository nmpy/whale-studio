// src/lib/ticket-link/settings.ts
//
// チケット連携の作品単位設定（Work.liffHomeSettingsJson の `ticket_link` キー）の
// 読み取り・検証・マージ。DOM / Prisma 非依存の純関数のみ。
//
// 後方互換の方針:
//   - 既存 JSON に `ticket_link` が無くても parse エラーにしない（既定は無効）。
//   - 未知フィールドがあっても既存設定を消さない（保存はサーバー側マージで行う）。
//   - 設定不備は **fail closed**（機能を公開しない）。
//
// 人数の扱い:
//   participantCount は設定値のみを正とする。ラベル文字列からの推測は一切行わない。

import type { TicketLinkSettings, TicketLinkTicketTypeSetting } from "@/types";

/** 1 チケットあたりの参加人数の上限（暴走した設定値を弾く）。 */
export const MAX_PARTICIPANT_COUNT = 20;
/** 1 作品あたりのチケット種別の上限。 */
export const MAX_TICKET_TYPES = 50;

export const DEFAULT_REPORT_BUTTON_LABEL = "報告する";
export const DEFAULT_REPORT_MESSAGE = "報告する";
export const DEFAULT_COMPLETION_MESSAGE =
  "チケット連携を受け付けました\n\n予約情報が運営システムへ取り込まれた後、連携状態が反映されます。";

/** 完全に無効な既定設定（`ticket_link` 未設定の既存作品はこれになる）。 */
export function defaultTicketLinkSettings(): TicketLinkSettings {
  return {
    enabled:             false,
    manualInputEnabled:  false,
    imageInputEnabled:   false,
    ticketTypes:         [],
    reportButtonEnabled: false,
    reportButtonLabel:   DEFAULT_REPORT_BUTTON_LABEL,
    reportMessage:       DEFAULT_REPORT_MESSAGE,
    completionMessage:   DEFAULT_COMPLETION_MESSAGE,
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}

/** チケット種別 1 件を安全に読む。壊れていれば null（その 1 件だけ捨てる）。 */
function parseTicketType(raw: unknown, index: number): TicketLinkTicketTypeSetting | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const key = typeof o.ticketTypeKey === "string" ? o.ticketTypeKey.trim() : "";
  if (key.length === 0) return null;

  const count = typeof o.participantCount === "number" ? Math.floor(o.participantCount) : NaN;
  if (!Number.isFinite(count) || count < 1 || count > MAX_PARTICIPANT_COUNT) return null;

  const label = typeof o.ticketTypeLabel === "string" ? o.ticketTypeLabel.trim() : "";

  return {
    ticketTypeKey:    key,
    ticketTypeLabel:  label.length > 0 ? label : key,
    participantCount: count,
    enabled:          bool(o.enabled),
    sortOrder:        typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder) ? o.sortOrder : index,
  };
}

/**
 * `Work.liffHomeSettingsJson` からチケット連携設定を読む。
 * 値が無い / 壊れている場合も例外を投げず、既定（無効）へフォールバックする。
 */
export function readTicketLinkSettings(homeSettingsJson: unknown): TicketLinkSettings {
  const base = defaultTicketLinkSettings();
  if (!homeSettingsJson || typeof homeSettingsJson !== "object") return base;

  const raw = (homeSettingsJson as Record<string, unknown>).ticket_link;
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;

  // ticketTypeKey の重複は先勝ちで捨てる（設定側の取りこぼしで人数解決が壊れないように）。
  const seen = new Set<string>();
  const types: TicketLinkTicketTypeSetting[] = [];
  if (Array.isArray(o.ticketTypes)) {
    o.ticketTypes.slice(0, MAX_TICKET_TYPES).forEach((t, i) => {
      const parsed = parseTicketType(t, i);
      if (!parsed) return;
      if (seen.has(parsed.ticketTypeKey)) return;
      seen.add(parsed.ticketTypeKey);
      types.push(parsed);
    });
  }
  types.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    enabled:             bool(o.enabled),
    manualInputEnabled:  bool(o.manualInputEnabled),
    // PR2 では画像経路を実装しないため、設定値に関わらず常に無効として返す。
    imageInputEnabled:   false,
    ticketTypes:         types,
    reportButtonEnabled: bool(o.reportButtonEnabled),
    reportButtonLabel:   str(o.reportButtonLabel, DEFAULT_REPORT_BUTTON_LABEL),
    reportMessage:       str(o.reportMessage, DEFAULT_REPORT_MESSAGE),
    completionMessage:   str(o.completionMessage, DEFAULT_COMPLETION_MESSAGE),
  };
}

/** 有効なチケット種別のみ（表示・選択の対象）。 */
export function enabledTicketTypes(s: TicketLinkSettings): TicketLinkTicketTypeSetting[] {
  return s.ticketTypes.filter((t) => t.enabled);
}

/**
 * 安定キーからチケット種別を解決する。
 * **無効化された種別は解決しない**（新規登録を止めるため）。ラベルからは引かない。
 */
export function resolveTicketTypeByKey(
  s: TicketLinkSettings,
  ticketTypeKey: string | null | undefined,
): TicketLinkTicketTypeSetting | null {
  const key = (ticketTypeKey ?? "").trim();
  if (key.length === 0) return null;
  return enabledTicketTypes(s).find((t) => t.ticketTypeKey === key) ?? null;
}

/** 手動登録をプレイヤーへ公開してよいか（fail closed）。 */
export function isManualInputAvailable(s: TicketLinkSettings): boolean {
  return s.enabled && s.manualInputEnabled && enabledTicketTypes(s).length > 0;
}

/** 管理画面向け: 公開されない理由（無ければ null）。 */
export function manualInputBlockReason(s: TicketLinkSettings): string | null {
  if (!s.enabled) return "チケット連携が無効のため、プレイヤーには公開されません。";
  if (!s.manualInputEnabled) return "手動入力が無効のため、プレイヤーには公開されません。";
  if (enabledTicketTypes(s).length === 0) {
    return "チケット種別が設定されていないため、プレイヤーには公開されません。";
  }
  return null;
}

// ─── 保存（サーバー側マージ） ────────────────────────────────────────────────

export type SettingsValidationError = { field: string; message: string };

export interface TicketLinkSettingsPatch {
  enabled?:             boolean;
  manualInputEnabled?:  boolean;
  ticketTypes?:         TicketLinkTicketTypeSetting[];
  reportButtonEnabled?: boolean;
  reportButtonLabel?:   string;
  reportMessage?:       string;
  completionMessage?:   string;
}

/** 保存前のサーバー側検証。クライアント検証だけに依存しない。 */
export function validateTicketLinkSettingsPatch(patch: TicketLinkSettingsPatch): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  const types = patch.ticketTypes;
  if (!types) return errors;

  if (types.length > MAX_TICKET_TYPES) {
    errors.push({ field: "ticketTypes", message: `チケット種別は${MAX_TICKET_TYPES}件までです。` });
  }

  const seen = new Set<string>();
  types.forEach((t, i) => {
    const key = (t.ticketTypeKey ?? "").trim();
    if (key.length === 0) {
      errors.push({ field: `ticketTypes[${i}].ticketTypeKey`, message: "キーを入力してください。" });
    } else if (seen.has(key)) {
      errors.push({ field: `ticketTypes[${i}].ticketTypeKey`, message: "キーが重複しています。" });
    } else {
      seen.add(key);
    }

    if ((t.ticketTypeLabel ?? "").trim().length === 0) {
      errors.push({ field: `ticketTypes[${i}].ticketTypeLabel`, message: "表示名を入力してください。" });
    }

    const c = t.participantCount;
    if (!Number.isInteger(c) || c < 1 || c > MAX_PARTICIPANT_COUNT) {
      errors.push({
        field: `ticketTypes[${i}].participantCount`,
        message: `参加人数は1〜${MAX_PARTICIPANT_COUNT}の整数で入力してください。`,
      });
    }
  });

  return errors;
}

/**
 * 既存の `liffHomeSettingsJson` を保ったまま `ticket_link` 部分だけを差し替える。
 * survey 等の既存フィールドや未知フィールドは触らない（クライアントの全体上書きを避ける）。
 */
export function mergeTicketLinkSettings(
  currentHomeSettingsJson: unknown,
  patch: TicketLinkSettingsPatch,
): Record<string, unknown> {
  const base =
    currentHomeSettingsJson && typeof currentHomeSettingsJson === "object" && !Array.isArray(currentHomeSettingsJson)
      ? { ...(currentHomeSettingsJson as Record<string, unknown>) }
      : {};

  const current = readTicketLinkSettings(base);

  const nextTypes = (patch.ticketTypes ?? current.ticketTypes).map((t, i) => ({
    ticketTypeKey:    (t.ticketTypeKey ?? "").trim(),
    ticketTypeLabel:  (t.ticketTypeLabel ?? "").trim(),
    participantCount: Math.floor(t.participantCount),
    enabled:          t.enabled === true,
    sortOrder:        Number.isFinite(t.sortOrder) ? t.sortOrder : i,
  }));

  base.ticket_link = {
    enabled:             patch.enabled ?? current.enabled,
    manualInputEnabled:  patch.manualInputEnabled ?? current.manualInputEnabled,
    // 将来用フィールド。PR2 では UI から有効化させない。
    imageInputEnabled:   false,
    ticketTypes:         nextTypes,
    reportButtonEnabled: patch.reportButtonEnabled ?? current.reportButtonEnabled,
    reportButtonLabel:   (patch.reportButtonLabel ?? current.reportButtonLabel).trim() || DEFAULT_REPORT_BUTTON_LABEL,
    reportMessage:       (patch.reportMessage ?? current.reportMessage).trim() || DEFAULT_REPORT_MESSAGE,
    completionMessage:   (patch.completionMessage ?? current.completionMessage).trim() || DEFAULT_COMPLETION_MESSAGE,
  };

  return base;
}

// ─── プレイヤー向け表示 ──────────────────────────────────────────────────────

/** DB enum をそのまま出さず、プレイヤー向けの日本語表示にする。 */
export function playerFacingStatusLabel(status: string): string {
  switch (status) {
    case "PENDING_UZU_BOOKING": return "運営確認待ち";
    case "LINKED":              return "連携済み";
    case "CONFLICT":            return "確認が必要です";
    case "REVOKED":             return "無効";
    default:                    return "確認中";
  }
}

/**
 * PR2 時点の公演日時表示。
 * Whale Studio に正式な公演日時の候補が存在しないため、推測値を出さず固定文言にする
 * （PR3 の CMS 照合後に実際の日時が反映される）。
 */
export const PERFORMANCE_DATETIME_PENDING = "運営確認後に反映されます";
