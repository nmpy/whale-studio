// src/__tests__/broadcast-naming-separation.test.ts
//
// 「応答メッセージ」と「配信メッセージ」が管理画面上で **別項目** として見えることを固定する。
// 誤配信防止の要なので、曖昧な「メッセージ」単独表記に戻ったら落ちるようにしておく。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorkSidebarSections } from "@/app/oas/[id]/_lib/work-sidebar-nav";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 行コメントを除いたソース。「コメントで言及しているだけ」を導線と誤検出しないため。 */
const readCode = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("作品サイドバー — 既存メッセージ機能のラベル", () => {
  const items = buildWorkSidebarSections({ oaId: "oa1", workId: "w1", isTester: false }).flatMap((s) => s.items);

  it("既存メッセージ機能の入口は「応答メッセージ」と表示される", () => {
    const item = items.find((i) => i.key === "messages");
    expect(item?.label).toBe("応答メッセージ");
  });

  it("曖昧な「メッセージ」単独ラベルが残っていない", () => {
    expect(items.some((i) => i.label === "メッセージ")).toBe(false);
  });

  it("ラベル変更で route は変わっていない（既存 URL 互換）", () => {
    const item = items.find((i) => i.key === "messages");
    expect(item?.href).toBe("/oas/oa1/works/w1/messages");
    expect(item?.activeSegments).toEqual(["/messages"]);
  });
});

describe("作品トップ — 応答メッセージの導線", () => {
  const src = read("src/app/oas/[id]/works/[workId]/page.tsx");

  it("機能カード・クイック導線が「応答メッセージ」表記になっている", () => {
    expect(src).toContain('label: "応答メッセージを追加"');
    expect(src).toContain('label: "応答メッセージ", sub:');
  });

  it("既存 route（/messages）は変更されていない", () => {
    expect(src).toContain("`${basePath}/messages`");
  });
});

describe("OA 設定ハブ — 配信メッセージは別項目", () => {
  const src = read("src/app/oas/[id]/settings/page.tsx");

  it("「配信メッセージ」が独立した項目として存在する", () => {
    expect(src).toContain('key: "broadcasts"');
    expect(src).toContain('title: "配信メッセージ"');
  });

  it("配信メッセージの入口は応答メッセージの route を指していない", () => {
    // broadcasts の key から作られる href は /oas/:id/broadcasts であり /messages を含まない
    expect(src).not.toContain('key: "works/messages"');
    // 配信メッセージの key は broadcasts であり、応答メッセージの route を指さない
    const broadcastLine = src.split("\n").find((l) => l.includes('key: "broadcasts"'))!;
    expect(broadcastLine).not.toContain("messages/");
  });
});

describe("配信メッセージ画面 — 応答メッセージとの取り違え防止表示", () => {
  const src = read("src/app/oas/[id]/broadcasts/_components.tsx");

  it("画面上部に「配信メッセージ」と、応答メッセージとは別機能である旨を常時出す", () => {
    expect(src).toContain("配信メッセージ");
    expect(src).toContain("「応答メッセージ」とは別の機能です");
  });

  it("確認モーダルに応答メッセージへ影響しない旨と取消不可を明記する", () => {
    expect(src).toContain("「応答メッセージ」の設定には影響しません");
    expect(src).toContain("月間メッセージ通数を消費します");
    expect(src).toContain("送信後に取り消すことはできません");
  });
});

describe("配信画面と応答メッセージ画面の相互導線が無いこと", () => {
  it("配信メッセージ画面から応答メッセージを編集する導線を持たない", () => {
    for (const f of [
      "src/app/oas/[id]/broadcasts/page.tsx",
      "src/app/oas/[id]/broadcasts/new/page.tsx",
      "src/app/oas/[id]/broadcasts/[broadcastId]/page.tsx",
    ]) {
      // 実際のリンク/遷移先として応答メッセージの route を持たない（コメントでの言及は除く）
      expect(readCode(f)).not.toContain("/messages");
    }
  });

  it("応答メッセージ画面に一斉配信の導線を追加していない", () => {
    for (const f of [
      "src/app/oas/[id]/works/[workId]/messages/page.tsx",
      "src/app/oas/[id]/works/[workId]/page.tsx",
    ]) {
      const src = readCode(f);
      expect(src).not.toContain("/broadcasts");
      expect(src).not.toContain("一斉配信");
    }
  });
});


describe("配信詳細 UI — 再送ボタンの条件（J）", () => {
  const src = read("src/app/oas/[id]/broadcasts/[broadcastId]/page.tsx");

  it("再送ボタンは retryable_failure_count > 0 のときだけ出す（failure_count では判断しない）", () => {
    expect(src).toContain("row.retryable_failure_count > 0 && (");
    // failure_count だけを根拠にした活性条件が残っていないこと
    expect(src).not.toContain("row.failure_count > 0 && (\n                  <button");
  });

  it("再送可能 / 再送不可の内訳を表示する", () => {
    expect(src).toContain("再送可能");
    expect(src).toContain("再送不可");
    expect(src).toContain("row.non_retryable_failure_count");
  });

  it("再送対象が timeout / 5xx かつ 24 時間以内であることを利用者に説明する", () => {
    expect(src).toContain("5xx");
    expect(src).toContain("24時間");
    expect(src).toContain("4xx");
  });
});
