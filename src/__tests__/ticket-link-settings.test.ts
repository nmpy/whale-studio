// src/__tests__/ticket-link-settings.test.ts
//
// チケット連携の作品設定（Work.liffHomeSettingsJson の ticket_link）の
// 読み取り・fail closed・サーバー側マージ・検証。

import { describe, it, expect } from "vitest";
import {
  readTicketLinkSettings,
  mergeTicketLinkSettings,
  validateTicketLinkSettingsPatch,
  resolveTicketTypeByKey,
  enabledTicketTypes,
  isManualInputAvailable,
  manualInputBlockReason,
  playerFacingStatusLabel,
  MAX_PARTICIPANT_COUNT,
  DEFAULT_REPORT_BUTTON_LABEL,
} from "@/lib/ticket-link/settings";

const type = (over: Record<string, unknown> = {}) => ({
  ticketTypeKey: "single",
  ticketTypeLabel: "1名チケット",
  participantCount: 1,
  enabled: true,
  sortOrder: 0,
  ...over,
});

describe("readTicketLinkSettings（後方互換 / fail closed）", () => {
  it("ticket_link が無い既存 JSON でも壊れず、既定は無効", () => {
    const s = readTicketLinkSettings({ title: "既存", home_menu_layout: "list" });
    expect(s.enabled).toBe(false);
    expect(s.manualInputEnabled).toBe(false);
    expect(s.ticketTypes).toEqual([]);
  });

  it("null / 非オブジェクトでも例外にならない", () => {
    expect(readTicketLinkSettings(null).enabled).toBe(false);
    expect(readTicketLinkSettings("broken").enabled).toBe(false);
    expect(readTicketLinkSettings({ ticket_link: "broken" }).enabled).toBe(false);
  });

  it("既定の報告ボタン文言を持つ", () => {
    expect(readTicketLinkSettings({}).reportButtonLabel).toBe(DEFAULT_REPORT_BUTTON_LABEL);
  });

  it("画像登録は設定値に関わらず常に無効（PR2 では公開しない）", () => {
    const s = readTicketLinkSettings({ ticket_link: { enabled: true, imageInputEnabled: true } });
    expect(s.imageInputEnabled).toBe(false);
  });

  it("ticketTypeKey が重複する設定は先勝ちで 1 件だけ採用する", () => {
    const s = readTicketLinkSettings({
      ticket_link: { ticketTypes: [type(), type({ ticketTypeLabel: "重複" })] },
    });
    expect(s.ticketTypes).toHaveLength(1);
    expect(s.ticketTypes[0].ticketTypeLabel).toBe("1名チケット");
  });

  it("キー空文字・人数不正の種別は捨てる", () => {
    const s = readTicketLinkSettings({
      ticket_link: {
        ticketTypes: [
          type({ ticketTypeKey: "  " }),
          type({ ticketTypeKey: "zero", participantCount: 0 }),
          type({ ticketTypeKey: "over", participantCount: MAX_PARTICIPANT_COUNT + 1 }),
          type({ ticketTypeKey: "ok" }),
        ],
      },
    });
    expect(s.ticketTypes.map((t) => t.ticketTypeKey)).toEqual(["ok"]);
  });

  it("sortOrder で並べ替える", () => {
    const s = readTicketLinkSettings({
      ticket_link: {
        ticketTypes: [
          type({ ticketTypeKey: "b", sortOrder: 2 }),
          type({ ticketTypeKey: "a", sortOrder: 1 }),
        ],
      },
    });
    expect(s.ticketTypes.map((t) => t.ticketTypeKey)).toEqual(["a", "b"]);
  });
});

describe("公開条件（fail closed）", () => {
  const base = { enabled: true, manualInputEnabled: true, ticketTypes: [type()] };

  it("全条件が揃ったときのみ公開する", () => {
    expect(isManualInputAvailable(readTicketLinkSettings({ ticket_link: base }))).toBe(true);
  });

  it("機能無効なら公開しない", () => {
    const s = readTicketLinkSettings({ ticket_link: { ...base, enabled: false } });
    expect(isManualInputAvailable(s)).toBe(false);
    expect(manualInputBlockReason(s)).toContain("チケット連携が無効");
  });

  it("手動入力無効なら公開しない", () => {
    const s = readTicketLinkSettings({ ticket_link: { ...base, manualInputEnabled: false } });
    expect(isManualInputAvailable(s)).toBe(false);
    expect(manualInputBlockReason(s)).toContain("手動入力が無効");
  });

  it("有効なチケット種別が 0 件なら公開しない", () => {
    const s = readTicketLinkSettings({ ticket_link: { ...base, ticketTypes: [type({ enabled: false })] } });
    expect(isManualInputAvailable(s)).toBe(false);
    expect(manualInputBlockReason(s)).toBe("チケット種別が設定されていないため、プレイヤーには公開されません。");
  });
});

describe("resolveTicketTypeByKey（安定キー基準）", () => {
  const s = readTicketLinkSettings({
    ticket_link: {
      enabled: true, manualInputEnabled: true,
      ticketTypes: [
        type({ ticketTypeKey: "group4", ticketTypeLabel: "4名グループチケット", participantCount: 4 }),
        type({ ticketTypeKey: "disabled", ticketTypeLabel: "終了分", participantCount: 2, enabled: false }),
      ],
    },
  });

  it("キーで人数を解決する", () => {
    expect(resolveTicketTypeByKey(s, "group4")?.participantCount).toBe(4);
  });

  it("表示名では解決しない（ラベル変更に影響されない）", () => {
    expect(resolveTicketTypeByKey(s, "4名グループチケット")).toBeNull();
  });

  it("無効化された種別は解決しない（新規登録させない）", () => {
    expect(resolveTicketTypeByKey(s, "disabled")).toBeNull();
  });

  it("未知キー・空は null", () => {
    expect(resolveTicketTypeByKey(s, "nope")).toBeNull();
    expect(resolveTicketTypeByKey(s, "")).toBeNull();
    expect(resolveTicketTypeByKey(s, null)).toBeNull();
  });

  it("enabledTicketTypes は有効分のみ返す", () => {
    expect(enabledTicketTypes(s).map((t) => t.ticketTypeKey)).toEqual(["group4"]);
  });
});

describe("mergeTicketLinkSettings（サーバー側マージ）", () => {
  it("既存の他フィールドを保持する", () => {
    const merged = mergeTicketLinkSettings(
      { title: "ホーム", home_menu_layout: "list", survey_dummy: 1 },
      { enabled: true },
    );
    expect(merged.title).toBe("ホーム");
    expect(merged.home_menu_layout).toBe("list");
    expect(merged.survey_dummy).toBe(1);
  });

  it("未知フィールドを消さない", () => {
    const merged = mergeTicketLinkSettings({ unknown_future_key: { a: 1 } }, { enabled: true });
    expect(merged.unknown_future_key).toEqual({ a: 1 });
  });

  it("patch に無いチケット連携項目は現在値を維持する", () => {
    const first = mergeTicketLinkSettings({}, { enabled: true, reportButtonLabel: "報告" });
    const second = mergeTicketLinkSettings(first, { manualInputEnabled: true });
    const s = readTicketLinkSettings(second);
    expect(s.enabled).toBe(true);
    expect(s.manualInputEnabled).toBe(true);
    expect(s.reportButtonLabel).toBe("報告");
  });

  it("空文字ラベルは既定値へ戻す", () => {
    const merged = mergeTicketLinkSettings({}, { reportButtonLabel: "   " });
    expect(readTicketLinkSettings(merged).reportButtonLabel).toBe(DEFAULT_REPORT_BUTTON_LABEL);
  });

  it("壊れた既存 JSON でも落ちない", () => {
    expect(() => mergeTicketLinkSettings("broken", { enabled: true })).not.toThrow();
    expect(() => mergeTicketLinkSettings(null, { enabled: true })).not.toThrow();
  });
});

describe("validateTicketLinkSettingsPatch", () => {
  it("正常な設定はエラー無し", () => {
    expect(validateTicketLinkSettingsPatch({ ticketTypes: [type()] })).toEqual([]);
  });

  it("ticketTypeKey の重複を拒否する", () => {
    const errs = validateTicketLinkSettingsPatch({ ticketTypes: [type(), type()] });
    expect(errs.some((e) => e.message.includes("重複"))).toBe(true);
  });

  it("空キー・空ラベルを拒否する", () => {
    const errs = validateTicketLinkSettingsPatch({
      ticketTypes: [type({ ticketTypeKey: "  ", ticketTypeLabel: " " })],
    });
    expect(errs).toHaveLength(2);
  });

  it("参加人数の範囲外を拒否する", () => {
    const errs = validateTicketLinkSettingsPatch({
      ticketTypes: [type({ participantCount: MAX_PARTICIPANT_COUNT + 1 })],
    });
    expect(errs.some((e) => e.field.endsWith("participantCount"))).toBe(true);
  });

  it("ticketTypes 未指定なら検証対象外", () => {
    expect(validateTicketLinkSettingsPatch({ enabled: true })).toEqual([]);
  });
});

describe("playerFacingStatusLabel（DB enum を出さない）", () => {
  it("プレイヤー向け日本語へ変換する", () => {
    expect(playerFacingStatusLabel("PENDING_UZU_BOOKING")).toBe("運営確認待ち");
    expect(playerFacingStatusLabel("LINKED")).toBe("連携済み");
    expect(playerFacingStatusLabel("CONFLICT")).toBe("確認が必要です");
  });

  it("未知の値でも enum 名を露出しない", () => {
    expect(playerFacingStatusLabel("SOMETHING_NEW")).toBe("確認中");
  });
});
