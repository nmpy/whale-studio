// src/__tests__/ticket-link-reservation-number-exposure.test.ts
//
// 予約番号の露出範囲を固定する。
//
// 方針:
//   - **管理画面（for ウズプロ）だけ**フル値を返してよい（ESCAPE.ID / UZU Pro CMS との照合キー）。
//   - **プレイヤー向け（LIFF）は従来どおりマスク**（maskReservationNumber）。
//   - ログ / URL クエリ / エラーメッセージにフル値を載せない。
//
// PR-A（管理画面の追加）でこの境界が崩れていないことを、ソースを走査して機械的に確認する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { maskReservationNumber } from "@/lib/ticket-link/reservation-number";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("マスク関数そのもの（既存仕様・変更していない）", () => {
  it("先頭グループだけ残して伏せる", () => {
    expect(maskReservationNumber("123-456")).toBe("123-***");
    expect(maskReservationNumber("123-789")).toBe("123-***");
  });

  it("先頭グループが同じ別予約は、プレイヤー画面では同一表示になる", () => {
    // 実機で「同じに見えた」原因を明示的に固定しておく。
    expect(maskReservationNumber("123-456")).toBe(maskReservationNumber("123-789"));
  });

  it("値が無いときは —", () => {
    expect(maskReservationNumber(null)).toBe("—");
    expect(maskReservationNumber("")).toBe("—");
  });
});

describe("LIFF（プレイヤー向け）API はマスクのまま", () => {
  const configRoute = read("../app/api/liff/works/[workId]/ticket-link/config/route.ts");

  it("config API は reservationNumberMasked を返す", () => {
    expect(configRoute).toContain("reservationNumberMasked");
    expect(configRoute).toContain("maskReservationNumber");
  });

  it("config API のレスポンスに normalizedReservationNumber を素で載せていない", () => {
    // select では取得するが、レスポンス組み立てでは mask を通す。
    expect(configRoute).not.toMatch(/reservationNumber:\s*l\.normalizedReservationNumber/);
  });
});

describe("外部連携 API の露出範囲は据え置き", () => {
  it("UZU Pro CMS 向け差分取得は従来どおり正規化済み予約番号を返す（既存仕様・今回変更なし）", () => {
    const route = read("../app/api/external/v2/uzu-pro/ticket-links/route.ts");
    // 認証済みの CMS 連携用途。PR-A で新たに公開範囲を広げていないことの確認。
    expect(route).toContain("normalizedReservationNumber");
  });
});

describe("管理画面 View Model（for ウズプロ）", () => {
  const view = read("../lib/uzupro/ticket-link-view.ts");

  it("フル値を返す（照合キーとして必要）", () => {
    expect(view).toContain("reservationNumber: r.normalizedReservationNumber");
  });

  it("マスク関数を import も呼び出しもしていない（管理画面ではマスクしない）", () => {
    // コメント内の言及は許容し、実際の import / 呼び出しだけを禁止する。
    expect(view).not.toMatch(/import[^;]*maskReservationNumber/);
    expect(view).not.toMatch(/maskReservationNumber\s*\(/);
  });

  it("LINE UID / 表示名を select していない", () => {
    expect(view).not.toMatch(/lineUserId:\s*true/);
    expect(view).not.toMatch(/lineDisplayName:\s*true/);
  });

  it("書き込み系 prisma 呼び出しを含まない（read-only）", () => {
    for (const m of ["ticketLink.update", "ticketLink.create", "ticketLink.delete", "ticketLink.upsert"]) {
      expect(view).not.toContain(m);
    }
  });

  it("予約番号をログへ出していない", () => {
    expect(view).not.toMatch(/console\.(log|info|warn|error)/);
  });
});

describe("解除処理（PR-B）の情報露出", () => {
  const revoke = read("../lib/uzupro/ticket-link-revoke.ts");
  const route = read("../app/api/oas/[id]/works/[workId]/uzu-pro/ticket-links/[ticketLinkId]/revoke/route.ts");

  it("解除ロジックは予約番号 / LINE UID を select しない", () => {
    expect(revoke).not.toMatch(/normalizedReservationNumber:\s*true/);
    expect(revoke).not.toMatch(/lineUserId:\s*true/);
    expect(revoke).not.toMatch(/lineDisplayName:\s*true/);
  });

  it("物理削除しない（delete を含まない）", () => {
    for (const src of [revoke, route]) {
      expect(src).not.toMatch(/ticketLink\.delete/);
      expect(src).not.toMatch(/deleteMany/);
    }
  });

  it("console へ出力しない", () => {
    for (const src of [revoke, route]) {
      expect(src).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});

describe("管理画面 UI", () => {
  const page = read("../app/oas/[id]/works/[workId]/uzu-pro/ticket-links/page.tsx");
  const filters = read("../app/oas/[id]/works/[workId]/uzu-pro/ticket-links/_filters.tsx");
  const table = read("../app/oas/[id]/works/[workId]/uzu-pro/ticket-links/_table.tsx");

  it("ページは for ウズプロ権限と OA スコープを server 側で検証する", () => {
    expect(page).toContain("canAccessUzuPro");
    expect(page).toMatch(/findFirst\(\{\s*where:\s*\{\s*id:\s*params\.workId,\s*oaId:\s*params\.id/);
    expect(page).toContain("notFound()");
  });

  it("承認 / 任意の状態変更は持たない（解除のみ・PR-B）", () => {
    for (const src of [page, filters, table]) {
      expect(src).not.toContain("approve");
      // 一覧・フィルタ自体は書き込みしない
      expect(src).not.toMatch(/method:\s*["'](PATCH|PUT|DELETE)["']/);
    }
    // 解除ダイアログだけが POST する（DELETE は使わない = 物理削除しない）
    const dialog = read("../app/oas/[id]/works/[workId]/uzu-pro/ticket-links/_revoke-dialog.tsx");
    expect(dialog).toMatch(/method:\s*"POST"/);
    expect(dialog).not.toMatch(/method:\s*"DELETE"/);
  });

  it("REVOKED 行には解除導線を出さない（履歴として閲覧は維持）", () => {
    expect(table).toMatch(/r\.status === "REVOKED"/);
  });

  it("解除ダイアログは予約番号を URL / ログへ出さない", () => {
    const dialog = read("../app/oas/[id]/works/[workId]/uzu-pro/ticket-links/_revoke-dialog.tsx");
    // URL に載るのは ticketLink の id のみ
    expect(dialog).toMatch(/ticket-links\/\$\{encodeURIComponent\(row\.id\)\}\/revoke/);
    expect(dialog).not.toMatch(/console\.(log|info|warn|error)/);
    expect(dialog).not.toMatch(/reservationNumber[^}]*(\?|&)/); // query string へ載せない
  });

  it("URL クエリに予約番号の行データを埋め込まない（検索語のみ）", () => {
    // ページャは status/rn/cn/tt/page のみを引き継ぐ。
    expect(page).toMatch(/for \(const k of \["status", "rn", "cn", "tt"\]\)/);
  });

  it("console へ出力しない", () => {
    for (const src of [page, filters, table]) {
      expect(src).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});
