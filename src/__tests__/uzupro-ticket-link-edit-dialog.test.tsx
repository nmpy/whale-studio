// @vitest-environment jsdom
// src/__tests__/uzupro-ticket-link-edit-dialog.test.tsx
//
// 「内容を修正」ダイアログの UI 挙動（PR-C）。
//   - 予約番号は現在値で prefill しない
//   - 人数は入力させず、チケット種別から決まる
//   - 人数が変わったらコードネームを全クリアし、全員分を再入力させる
//   - 保存中の二重送信防止 / 成功後の refresh

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: toast.showToast }) }));

vi.mock("@/lib/api-client", () => ({ getAuthHeaders: () => ({}) }));

import { TicketLinkEditDialog } from "@/app/oas/[id]/works/[workId]/uzu-pro/ticket-links/_edit-dialog";
import type { TicketLinkAdminRow } from "@/lib/uzupro/ticket-link-view";

const TICKET_TYPES = [
  { ticketTypeKey: "solo", ticketTypeLabel: "1名チケット", participantCount: 1, enabled: true, sortOrder: 0 },
  { ticketTypeKey: "quad", ticketTypeLabel: "4名グループ", participantCount: 4, enabled: true, sortOrder: 1 },
  { ticketTypeKey: "solo2", ticketTypeLabel: "1名チケット(別)", participantCount: 1, enabled: true, sortOrder: 2 },
];

const ROW: TicketLinkAdminRow = {
  id: "tl-old",
  status: "PENDING_UZU_BOOKING",
  statusLabel: "UZU Pro 照合待ち",
  ticketType: "1名チケット",
  ticketTypeKey: "solo",
  participantCount: 1,
  reservationNumber: "123-456",
  normalizedReservationNumber: "123-456",
  reservationNumberRaw: "123-456",
  reservationNumberDiffers: false,
  codeNames: ["アリス"],
  source: "LIFF_MANUAL",
  confirmedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  uzuSyncedAt: null,
};

function setup(over: Partial<React.ComponentProps<typeof TicketLinkEditDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <TicketLinkEditDialog oaId="oa-1" workId="w-1" row={ROW} ticketTypes={TICKET_TYPES} onClose={onClose} {...over} />,
  );
  return { onClose };
}

const rnInput = () => screen.getByLabelText("予約番号") as HTMLInputElement;
const typeSelect = () => screen.getByLabelText("チケット種別") as HTMLSelectElement;
const codeInputs = () =>
  screen.getAllByPlaceholderText(/人目$/) as HTMLInputElement[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: "replaced" } }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("初期表示", () => {
  it("予約番号は現在値で prefill されない（必ず再入力）", () => {
    setup();
    expect(rnInput().value).toBe("");
    expect(rnInput().placeholder).toBe("123-456");
  });

  it("現在の内容は read-only summary として表示される", () => {
    setup();
    expect(screen.getByText("現在の予約番号")).toBeTruthy();
    expect(screen.getByText("現在のチケット種別")).toBeTruthy();
    expect(screen.getByText("現在の人数")).toBeTruthy();
    expect(screen.getByText("現在のコードネーム")).toBeTruthy();
  });

  it("現在のチケット種別が初期選択され、人数は read-only 表示になる", () => {
    setup();
    expect(typeSelect().value).toBe("solo");
    expect(screen.getByLabelText("修正後の人数").textContent).toBe("1 名");
    // 人数の自由入力欄は無い
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("人数が一致する場合は既存コードネームを初期値として維持する", () => {
    setup();
    expect(codeInputs()).toHaveLength(1);
    expect(codeInputs()[0].value).toBe("アリス");
  });
});

describe("チケット種別の変更", () => {
  it("人数が変わったらコードネームを全クリアし、新しい人数分を表示する", () => {
    setup();
    fireEvent.change(typeSelect(), { target: { value: "quad" } });

    const inputs = codeInputs();
    expect(inputs).toHaveLength(4);
    // 旧 1 名分を 1 人目へ流用しない
    expect(inputs.map((i) => i.value)).toEqual(["", "", "", ""]);
    expect(screen.getByText(/人数が変更されたため/)).toBeTruthy();
  });

  it("人数が同じなら既存コードネームを維持する", () => {
    setup();
    fireEvent.change(typeSelect(), { target: { value: "solo2" } });
    expect(codeInputs()).toHaveLength(1);
    expect(codeInputs()[0].value).toBe("アリス");
  });
});

describe("送信", () => {
  it("編集内容のみを POST する（oaId / lineUserId 等を送らない）", async () => {
    setup();
    fireEvent.change(rnInput(), { target: { value: "999888" } });
    fireEvent.click(screen.getByText("修正内容を保存"));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/uzu-pro/ticket-links/tl-old/replace");
    expect(JSON.parse(init.body)).toEqual({
      ticketTypeKey: "solo",
      reservationNumber: "999-888", // 表示整形済みの値
      codeNames: ["アリス"],
    });
  });

  it("成功したら Toast を出し、閉じて一覧を更新する", async () => {
    const { onClose } = setup();
    fireEvent.change(rnInput(), { target: { value: "999888" } });
    fireEvent.click(screen.getByText("修正内容を保存"));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(toast.showToast).toHaveBeenCalledWith(expect.stringContaining("修正しました"));
    expect(onClose).toHaveBeenCalled();
  });

  it("no_change は成功扱いにせず、閉じずに案内する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: "no_change" } }) })));
    const { onClose } = setup();
    fireEvent.click(screen.getByText("修正内容を保存"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("変更内容がありません"));
    expect(onClose).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it("サーバーのエラーメッセージをそのまま表示する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: "この予約番号はすでに別の有効な連携で使用されています" } }),
    })));
    setup();
    fireEvent.click(screen.getByText("修正内容を保存"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("すでに別の有効な連携で使用されています"),
    );
  });

  it("保存中は二重送信できない", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolve = r; })));
    setup();

    fireEvent.click(screen.getByText("修正内容を保存"));
    await waitFor(() => expect(screen.getByText("保存しています…")).toBeTruthy());

    fireEvent.click(screen.getByText("保存しています…"));
    fireEvent.click(screen.getByText("保存しています…"));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

    resolve({ ok: true, json: async () => ({ data: { status: "replaced" } }) });
  });

  it("overlay クリックでは閉じない（入力内容を失わせない）", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
