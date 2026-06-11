// src/__tests__/is-edit-screen.test.ts
// 「アカウント設定」共通導線の表示可否を決める編集画面判定（AppShell から利用）。
import { describe, it, expect } from "vitest";
import { isEditScreen } from "@/lib/is-edit-screen";

describe("isEditScreen", () => {
  it("非編集（閲覧・管理・一覧・ハブ）画面は false → アカウント設定導線を出す", () => {
    const nonEdit = [
      "/oas/oa-123456/works/work-abc",                          // 作品ハブ
      "/oas/oa-123456/works",                                   // 作品一覧
      "/oas/oa-123456",                                         // OA トップ
      "/oas/oa-123456/works/work-abc/messages",                 // メッセージ一覧
      "/oas/oa-123456/works/work-abc/scenario",                 // シナリオ
      "/oas/oa-123456/works/work-abc/audience",                 // 分析
      "/oas/oa-123456/works/work-abc/characters",               // キャラクター一覧
      "/oas/oa-123456/works/work-abc/liff",                     // LIFF 一覧
      "/oas/oa-123456/works/work-abc/locations",                // ロケーション一覧
      "/oas/oa-123456/settings",                                // 設定ハブ
      "/oas/oa-123456/settings/members",                        // 設定サブページ
    ];
    for (const p of nonEdit) expect(isEditScreen(p)).toBe(false);
  });

  it("編集（フォーム）画面は true → アカウント設定導線を出さない", () => {
    const edit = [
      "/oas/oa-123456/works/new",                               // 作品新規
      "/oas/oa-123456/works/work-abc/edit",                     // 作品情報編集
      "/oas/oa-123456/works/work-abc/messages/new",             // メッセージ新規
      "/oas/oa-123456/works/work-abc/messages/msg-xyz",         // メッセージ編集
      "/oas/oa-123456/works/work-abc/characters/char-xyz",      // キャラクター編集
      "/oas/oa-123456/works/work-abc/liff/block-xyz",           // LIFF ブロック編集
      "/oas/oa-123456/works/work-abc/locations/loc-xyz",        // ロケーション編集
      "/oas/oa-123456/global-commands/cmd-xyz/edit",            // グローバルコマンド編集
      "/oas/oa-123456/works/work-abc/messages/msg-xyz/",        // 末尾スラッシュ
    ];
    for (const p of edit) expect(isEditScreen(p)).toBe(true);
  });

  it("null / undefined は false（非編集扱い）", () => {
    expect(isEditScreen(null)).toBe(false);
    expect(isEditScreen(undefined)).toBe(false);
    expect(isEditScreen("")).toBe(false);
  });

  it("コレクション一覧（末尾が collection 名）は編集扱いしない", () => {
    // /liff（一覧）は編集ではない。/liff/[id]（個別）のみ編集。
    expect(isEditScreen("/oas/oa-123456/settings/liff")).toBe(false);
    expect(isEditScreen("/oas/oa-123456/settings/liff/block-1")).toBe(true);
  });

  it("将来の設定編集フォームも末尾 new/edit/create で自動的に編集扱い（導線非表示）", () => {
    expect(isEditScreen("/oas/oa-123456/settings")).toBe(false);            // 設定ハブ → 表示
    expect(isEditScreen("/oas/oa-123456/settings/edit")).toBe(true);        // 設定編集 → 非表示
    expect(isEditScreen("/oas/oa-123456/settings/profile/edit")).toBe(true);
    expect(isEditScreen("/oas/oa-123456/settings/members/new")).toBe(true);
  });
});
