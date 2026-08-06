/**
 * src/__tests__/ticket-link-liff-ui.test.ts
 *
 * LIFF「チケット連携」画面のデザイン更新に伴う **純ロジック / class 断片** の検証。
 * DOM を使う画面遷移テストは ticket-link-liff-flow.test.tsx（jsdom）が担当する。
 *
 * ここで守りたいこと:
 *   - 進行表示が実フロー（入力 → 確認 → コードネーム → 最終確認）と一致していること
 *   - 手動入力の検証が既存の予約番号ルールをそのまま使っていること
 *   - 確認 / 完了カードの項目と並びがデザインどおりであること
 *   - チケット種別と participantCount の対応が設定読み込みで保たれていること
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TICKET_LINK_COPY,
  TICKET_LINK_STEP_TOTAL,
  ticketLinkStepPosition,
  ticketLinkStepIndicator,
  validateManualStep,
  ticketReviewRows,
  finalReviewRows,
  completionRows,
} from "@/components/liff/ticket-link/flow";
import {
  TL_INPUT, TL_INPUT_ERROR, TL_SELECT, TL_READONLY_FIELD, TL_CTA_PRIMARY, TL_CTA_NEUTRAL,
  TL_CTA_DISABLED, TL_TEXT_BUTTON, TL_CARD_ROW_VALUE, TL_STATUS_BADGE,
} from "@/components/liff/ticket-link/styles";
import { readTicketLinkSettings, enabledTicketTypes, resolveTicketTypeByKey } from "@/lib/ticket-link/settings";
import { PERFORMANCE_DATETIME_PENDING, playerFacingStatusLabel } from "@/lib/ticket-link/settings";

describe("進行表示", () => {
  it("入口(choice)と完了(done)には出さない", () => {
    expect(ticketLinkStepPosition("choice")).toBeNull();
    expect(ticketLinkStepPosition("done")).toBeNull();
    expect(ticketLinkStepIndicator("choice")).toBeNull();
    expect(ticketLinkStepIndicator("done")).toBeNull();
  });

  it("入力 → 確認 → コードネーム → 最終確認 の 4 ステップに連番を振る", () => {
    expect(ticketLinkStepIndicator("manual")).toBe("1 / 4");
    expect(ticketLinkStepIndicator("review")).toBe("2 / 4");
    expect(ticketLinkStepIndicator("codeNames")).toBe("3 / 4");
    expect(ticketLinkStepIndicator("final")).toBe("4 / 4");
  });

  it("総数は実フローの画面数と一致し、番号が飛ばない", () => {
    const positions = (["manual", "review", "codeNames", "final"] as const).map(ticketLinkStepPosition);
    expect(positions).toEqual([1, 2, 3, 4]);
    expect(TICKET_LINK_STEP_TOTAL).toBe(positions.length);
  });
});

describe("手動入力の検証（既存の予約番号ルールを流用する）", () => {
  const base = {
    ticketTypeKey: "solo",
    purchaserName: "なみぽよ",
    reservationNumber: "123-456",
    reservationNumberError: null as string | null,
  };

  it("チケット種別が未選択なら進めない", () => {
    const r = validateManualStep({ ...base, ticketTypeKey: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("ticketType");
      expect(r.formError).toBe(TICKET_LINK_COPY.errorTicketTypeRequired);
    }
  });

  it("お名前が未入力（空白のみを含む）なら進めない", () => {
    for (const name of ["", "   ", "　"]) {
      const r = validateManualStep({ ...base, purchaserName: name });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe("purchaserName");
    }
  });

  it("予約番号のエラーが残っている間は進めない", () => {
    const r = validateManualStep({ ...base, reservationNumberError: "予約番号には数字とハイフンのみ入力できます。" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("reservationNumber");
  });

  it("桁数不足・形式違いは既存の文言でエラーになる", () => {
    const r = validateManualStep({ ...base, reservationNumber: "12345" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("reservationNumber");
      expect(r.reservationNumberError).toBe("予約番号は数字6桁で入力してください。");
    }
  });

  it("全角数字・異体ハイフン・空白区切りは既存の正規化で 123-456 になる", () => {
    for (const raw of ["123456", "123-456", "123 456", "１２３－４５６", "123ー456"]) {
      const r = validateManualStep({ ...base, reservationNumber: raw });
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(r.normalizedReservationNumber).toBe("123-456");
    }
  });

  it("数字以外を含む入力は黙って捨てず拒否する", () => {
    const r = validateManualStep({ ...base, reservationNumber: "abc123def456" });
    expect(r.ok).toBe(false);
  });
});

describe("確認 / 完了カードの項目", () => {
  const source = {
    workTitle: "OPERATION ; BELKISSH",
    performanceDateTimeText: PERFORMANCE_DATETIME_PENDING,
    ticketTypeLabel: "1名様貸切チケット",
    purchaserName: "なみぽよ",
    reservationNumber: "123-456",
    codeNames: ["アルファ"],
  };

  it("チケット情報の確認は 対象公演 / 日時 / チケット種別 / お名前 / 予約番号 の順", () => {
    expect(ticketReviewRows(source).map((r) => r.label)).toEqual([
      "対象公演", "日時", "チケット種別", "お名前", "予約番号",
    ]);
  });

  it("日時は運営照合前の固定文言をそのまま出す（推測値を出さない）", () => {
    const row = ticketReviewRows(source).find((r) => r.label === "日時");
    expect(row?.value).toBe("運営確認後に反映されます");
  });

  it("最終確認はコードネームを加えた 6 項目", () => {
    const rows = finalReviewRows(source);
    expect(rows.map((r) => r.label)).toEqual([
      "対象公演", "日時", "チケット種別", "お名前", "予約番号", "コードネーム",
    ]);
    expect(rows.at(-1)?.value).toBe("アルファ");
  });

  it("完了画面は個人名を再表示しない", () => {
    const rows = completionRows({ workTitle: source.workTitle, reservationNumber: "123-456" });
    expect(rows.map((r) => r.label)).toEqual(["対象公演", "予約番号"]);
    expect(JSON.stringify(rows)).not.toContain("なみぽよ");
  });

  it("未入力値は空文字ではなく — を出す", () => {
    const rows = ticketReviewRows({ ...source, ticketTypeLabel: null, purchaserName: "  " });
    expect(rows.find((r) => r.label === "チケット種別")?.value).toBe("—");
    expect(rows.find((r) => r.label === "お名前")?.value).toBe("—");
  });
});

describe("文言", () => {
  it("未提供の画像経路は「準備中」と明示する", () => {
    expect(TICKET_LINK_COPY.choiceImageLabel).toContain("準備中");
  });

  it("完了画面の既定ステータスはサーバーの表示文言と一致する", () => {
    expect(TICKET_LINK_COPY.defaultStatusLabel).toBe(playerFacingStatusLabel("PENDING_UZU_BOOKING"));
    expect(TICKET_LINK_COPY.defaultStatusLabel).toBe("運営確認待ち");
  });

  it("送信中の文言は登録処理中であることを示す", () => {
    expect(TICKET_LINK_COPY.submitting).toBe("登録しています…");
  });
});

describe("class 断片（デザイン要件）", () => {
  it("入力欄は Tailwind ではなく専用 class を使う（globals.css の unlayered な form 規則に負けないため）", () => {
    // globals.css の `input[type="text"], select, textarea {}` は unlayered で、
    // Tailwind の @layer utilities を常に上書きしてしまう。実際の見た目は
    // liff-font.css の `.liff-font .liff-tl-input` が持つ。
    expect(TL_INPUT).toBe("liff-tl-input");
    expect(TL_SELECT).toContain("liff-tl-input");
    expect(TL_INPUT_ERROR).toBe("liff-tl-input--error");
    expect(TL_INPUT).not.toContain("border-[");
    expect(TL_INPUT).not.toContain("rounded-[");
  });

  it("liff-font.css に箱型入力の実装がある（高さ 50px / 角丸 8px / エラー枠 / フォーカスリング）", () => {
    const css = readFileSync(
      new URL("../app/liff/liff-font.css", import.meta.url),
      "utf8",
    );
    const scoped = css.slice(css.indexOf(".liff-font .liff-tl-input"));
    expect(scoped).toContain("min-height: 50px");
    expect(scoped).toContain("border-radius: 8px");
    expect(scoped).toContain("--liff-ui-input-box-border");
    // エラー時は赤枠、フォーカス時はリングを出す（outline は消すが視覚指標は残す）
    expect(scoped).toContain(".liff-font .liff-tl-input--error");
    expect(scoped).toContain("--liff-danger");
    expect(scoped).toMatch(/\.liff-font \.liff-tl-input:focus[\s\S]*box-shadow: 0 0 0 3px/);
  });

  it("編集不可欄は input ではないので Tailwind で足りる", () => {
    expect(TL_READONLY_FIELD).toContain("min-h-[50px]");
    expect(TL_READONLY_FIELD).toContain("rounded-[8px]");
    expect(TL_READONLY_FIELD).toContain("--liff-ui-input-box-border");
  });

  it("編集不可欄は disabled ではなく薄いグレー背景で示す", () => {
    expect(TL_READONLY_FIELD).toContain("--liff-ui-disabled-bg");
    expect(TL_READONLY_FIELD).not.toContain("opacity-");
  });

  it("メイン CTA はブランドグリーン・高さ 52px・角丸 8px", () => {
    expect(TL_CTA_PRIMARY).toContain("--liff-line-green");
    expect(TL_CTA_PRIMARY).toContain("min-h-[52px]");
    expect(TL_CTA_PRIMARY).toContain("rounded-[8px]");
    expect(TL_CTA_PRIMARY).toContain("text-white");
  });

  it("閉じるボタンは白背景 + 薄いボーダー + 濃い文字", () => {
    expect(TL_CTA_NEUTRAL).toContain("--liff-surface");
    expect(TL_CTA_NEUTRAL).toContain("--liff-ui-input-box-border");
    expect(TL_CTA_NEUTRAL).toContain("--liff-primary-text");
  });

  it("無効ボタンは hover / active 表現を持たない", () => {
    expect(TL_CTA_DISABLED).toContain("cursor-not-allowed");
    expect(TL_CTA_DISABLED).toContain("--liff-ui-disabled-text");
    expect(TL_CTA_DISABLED).not.toContain("hover:");
    expect(TL_CTA_DISABLED).not.toContain("active:");
  });

  it("テキストボタンのタップ領域は 44px 以上", () => {
    expect(TL_TEXT_BUTTON).toContain("min-h-[44px]");
  });

  it("フォーカスリングを消していない", () => {
    for (const c of [TL_CTA_PRIMARY, TL_CTA_NEUTRAL, TL_TEXT_BUTTON]) {
      expect(c).toMatch(/focus(-visible)?:ring-2/);
    }
    // 入力欄のフォーカスリングは liff-font.css 側（上のテストで検証済み）。
  });

  it("カードの値は折り返し、横スクロールを発生させない", () => {
    expect(TL_CARD_ROW_VALUE).toContain("break-words");
    expect(TL_CARD_ROW_VALUE).toContain("[overflow-wrap:anywhere]");
    expect(TL_CARD_ROW_VALUE).toContain("min-w-0");
  });

  it("ステータスバッジは色だけでなく背景・枠線・文字色の 3 点で示す", () => {
    expect(TL_STATUS_BADGE).toContain("--liff-ui-warning-bg");
    expect(TL_STATUS_BADGE).toContain("--liff-ui-warning-text");
    expect(TL_STATUS_BADGE).toContain("--liff-ui-warning-border");
    expect(TL_STATUS_BADGE).toContain("inline-flex"); // 横幅は内容に合わせる
  });
});

describe("チケット種別と participantCount の対応（デザイン変更で壊さない）", () => {
  // OPERATION ; BELKISSH の運用設定と同じ形。値は Work.liffHomeSettingsJson に入る。
  const homeSettings = {
    ticket_link: {
      enabled: true,
      manualInputEnabled: true,
      ticketTypes: [
        { ticketTypeKey: "private_1", ticketTypeLabel: "1名様貸切チケット", participantCount: 1, enabled: true, sortOrder: 0 },
        { ticketTypeKey: "private_2", ticketTypeLabel: "2名様貸切チケット", participantCount: 2, enabled: true, sortOrder: 1 },
        { ticketTypeKey: "private_3", ticketTypeLabel: "3名様貸切チケット", participantCount: 3, enabled: true, sortOrder: 2 },
        { ticketTypeKey: "private_4", ticketTypeLabel: "4名様貸切チケット", participantCount: 4, enabled: true, sortOrder: 3 },
      ],
    },
  };

  it("表示名 → participantCount が 1〜4 で維持される", () => {
    const s = readTicketLinkSettings(homeSettings);
    expect(enabledTicketTypes(s).map((t) => [t.ticketTypeLabel, t.participantCount])).toEqual([
      ["1名様貸切チケット", 1],
      ["2名様貸切チケット", 2],
      ["3名様貸切チケット", 3],
      ["4名様貸切チケット", 4],
    ]);
  });

  it("解決は表示名ではなく安定キーで行う", () => {
    const s = readTicketLinkSettings(homeSettings);
    expect(resolveTicketTypeByKey(s, "private_3")?.participantCount).toBe(3);
    // 表示名では引けない（デザイン変更でラベルを触っても内部値がズレない保証）
    expect(resolveTicketTypeByKey(s, "3名様貸切チケット")).toBeNull();
  });
});
