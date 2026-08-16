// src/__tests__/broadcast-rich-content.test.ts
//
// 配信メッセージの content layer（テキスト / 画像 / Flex）。
// 最優先は **Production に存在する既存 text 配信の後方互換**。
// 送信基盤（CAS / retry key / 409 / retry 分類 / 集計 / cron worker）は
// このレイヤーの変更で影響を受けないことも併せて固定する。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBroadcastContent, toLineMessages,
  isSendableImageUrl, isBroadcastFlexContainer,
  BROADCAST_TEXT_MAX, BROADCAST_MEDIA_URL_MAX, BROADCAST_ALT_TEXT_MAX,
  BROADCAST_FLEX_BUBBLE_MAX_BYTES, BROADCAST_FLEX_CAROUSEL_MAX_BYTES,
} from "@/lib/broadcast/content";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const readCode = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

/**
 * Production に実在する形式そのまま（2026-08-16 時点の 2 件を read-only で確認した実データ形状）。
 * キーは kind / text のみ。version フィールドは存在しない。
 */
const LEGACY_PRODUCTION_FIXTURES = [
  { kind: "text", text: "【Whale Studio 配信E2E】\n配信メッセージ機能の本番動作確認です。\n返信は不要です。" },
  { kind: "text", text: "【Whale Studio Cron E2E】\nバックグラウンド配信処理の本番動作確認です。\n返信は不要です。" },
];

const bubble = { type: "bubble" as const, body: { type: "box", layout: "vertical", contents: [] } };
const carousel = { type: "carousel" as const, contents: [bubble, bubble] };

// ══════════════════════════════════════════════════════════════════
describe("A/B. legacy text の後方互換（最優先）", () => {
  it.each(LEGACY_PRODUCTION_FIXTURES)("Production の既存 contentJson がそのまま parse できる", (fx) => {
    const c = parseBroadcastContent(fx);
    expect(c).toEqual({ kind: "text", text: fx.text });
  });

  it.each(LEGACY_PRODUCTION_FIXTURES)("legacy text が今までと同じ LINE message になる", (fx) => {
    const c = parseBroadcastContent(fx)!;
    expect(toLineMessages(c)).toEqual([{ type: "text", text: fx.text }]);
  });

  it("legacy データは version フィールドを持たない（追加していない）", () => {
    for (const fx of LEGACY_PRODUCTION_FIXTURES) expect(Object.keys(fx).sort()).toEqual(["kind", "text"]);
    // parse 結果にも version を足さない（保存時に既存レコード形状を変えないため）
    expect(Object.keys(parseBroadcastContent(LEGACY_PRODUCTION_FIXTURES[0])!).sort()).toEqual(["kind", "text"]);
  });

  it("text の既存ルール（空文字 / 上限）は変わっていない", () => {
    expect(parseBroadcastContent({ kind: "text", text: "" })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "   " })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "a".repeat(BROADCAST_TEXT_MAX) })).not.toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "a".repeat(BROADCAST_TEXT_MAX + 1) })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: 123 })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("C–F. 画像", () => {
  const valid = {
    kind: "image",
    originalContentUrl: "https://example.com/original.jpg",
    previewImageUrl:    "https://example.com/preview.jpg",
  };

  it("C. https の original / preview が揃っていれば valid", () => {
    expect(parseBroadcastContent(valid)).toEqual(valid);
  });

  it("D. http は拒否する（LINE は HTTPS のみ）", () => {
    expect(parseBroadcastContent({ ...valid, originalContentUrl: "http://example.com/a.jpg" })).toBeNull();
    expect(parseBroadcastContent({ ...valid, previewImageUrl: "http://example.com/a.jpg" })).toBeNull();
  });

  it("E. 不正な URL を拒否する", () => {
    for (const bad of ["", "   ", "not a url", "/relative/path.jpg", "example.com/a.jpg"]) {
      expect(parseBroadcastContent({ ...valid, originalContentUrl: bad })).toBeNull();
    }
  });

  it("E2. 危険な scheme を拒否する（許可リスト方式）", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
      "ftp://example.com/a.jpg",
    ]) {
      expect(isSendableImageUrl(bad)).toBe(false);
      expect(parseBroadcastContent({ ...valid, originalContentUrl: bad })).toBeNull();
    }
  });

  it("E3. URL に資格情報が埋まっているものを拒否する", () => {
    expect(isSendableImageUrl("https://user:pass@example.com/a.jpg")).toBe(false);
  });

  it("E4. URL 長の上限（LINE 仕様 2000 文字）", () => {
    const base = "https://example.com/";
    const ok = base + "a".repeat(BROADCAST_MEDIA_URL_MAX - base.length);
    expect(ok.length).toBe(BROADCAST_MEDIA_URL_MAX);
    expect(isSendableImageUrl(ok)).toBe(true);
    expect(isSendableImageUrl(ok + "a")).toBe(false);
  });

  it("F. preview 欠落を拒否する（original で勝手に補完しない）", () => {
    expect(parseBroadcastContent({ kind: "image", originalContentUrl: valid.originalContentUrl })).toBeNull();
    expect(parseBroadcastContent({ kind: "image", previewImageUrl: valid.previewImageUrl })).toBeNull();
    // 補完したら preview 1MB 上限に違反しうるので、成功ケースでも original を preview に流用しない
    const c = parseBroadcastContent(valid)!;
    expect(c.kind === "image" && c.previewImageUrl).toBe(valid.previewImageUrl);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("G–L. Flex", () => {
  const valid = { kind: "flex", altText: "お知らせ", contents: bubble };

  it("G. bubble が valid", () => {
    expect(parseBroadcastContent(valid)).toEqual(valid);
  });

  it("H. carousel が valid", () => {
    expect(parseBroadcastContent({ ...valid, contents: carousel })).toEqual({ ...valid, contents: carousel });
  });

  it("I. contents がオブジェクトでないものを拒否する", () => {
    for (const bad of ["{\"type\":\"bubble\"}", 123, null, undefined, [bubble], true]) {
      expect(parseBroadcastContent({ ...valid, contents: bad })).toBeNull();
    }
  });

  it("J. 最上位 type が bubble / carousel 以外なら拒否する", () => {
    for (const t of ["box", "flex", "text", "image", "Bubble", "", undefined]) {
      expect(parseBroadcastContent({ ...valid, contents: { type: t } })).toBeNull();
    }
  });

  it("J2. type:flex を丸ごと貼られても拒否する（type は Whale が付与する）", () => {
    const whole = { type: "flex", altText: "x", contents: bubble };
    expect(isBroadcastFlexContainer(whole)).toBe(false);
    expect(parseBroadcastContent({ kind: "flex", altText: "x", contents: whole })).toBeNull();
  });

  it("K. altText 必須", () => {
    expect(parseBroadcastContent({ kind: "flex", contents: bubble })).toBeNull();
    expect(parseBroadcastContent({ ...valid, altText: "" })).toBeNull();
    expect(parseBroadcastContent({ ...valid, altText: "   " })).toBeNull();
    expect(parseBroadcastContent({ ...valid, altText: 1 })).toBeNull();
  });

  it("L. altText は LINE 公式上限 1500 文字", () => {
    expect(BROADCAST_ALT_TEXT_MAX).toBe(1500);
    expect(parseBroadcastContent({ ...valid, altText: "あ".repeat(1500) })).not.toBeNull();
    expect(parseBroadcastContent({ ...valid, altText: "あ".repeat(1501) })).toBeNull();
  });

  it("L2. LINE 公式のコンテナサイズ上限（bubble 30KB / carousel 50KB）を超えたら拒否する", () => {
    expect(BROADCAST_FLEX_BUBBLE_MAX_BYTES).toBe(30 * 1024);
    expect(BROADCAST_FLEX_CAROUSEL_MAX_BYTES).toBe(50 * 1024);
    const fat = (type: string, bytes: number) => ({ type, pad: "a".repeat(bytes) });
    expect(isBroadcastFlexContainer(fat("bubble", 40 * 1024))).toBe(false);
    expect(isBroadcastFlexContainer(fat("carousel", 40 * 1024))).toBe(true);
    expect(isBroadcastFlexContainer(fat("carousel", 60 * 1024))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("M. 未知 kind / 壊れたデータ", () => {
  it("未知の kind は必ず reject する", () => {
    for (const k of ["video", "audio", "sticker", "template", "TEXT", "", null, undefined, 1]) {
      expect(parseBroadcastContent({ kind: k, text: "x" })).toBeNull();
    }
  });

  it("そもそもオブジェクトでないものを reject する", () => {
    for (const bad of [null, undefined, "text", 1, true, [], ["a"]]) {
      expect(parseBroadcastContent(bad)).toBeNull();
    }
  });

  it("JSON として妥当でも kind 検証を通らなければ送らない", () => {
    // 「JSON.parse できた = valid」にしていないことの確認
    const parsed = JSON.parse('{"kind":"image","originalContentUrl":"http://x/a.jpg","previewImageUrl":"http://x/b.jpg"}');
    expect(parsed).toBeTruthy();
    expect(parseBroadcastContent(parsed)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("N–Q. toLineMessages", () => {
  it("N. text", () => {
    expect(toLineMessages({ kind: "text", text: "hello" })).toEqual([{ type: "text", text: "hello" }]);
  });

  it("O. image", () => {
    expect(toLineMessages({
      kind: "image", originalContentUrl: "https://e.com/o.jpg", previewImageUrl: "https://e.com/p.jpg",
    })).toEqual([{ type: "image", originalContentUrl: "https://e.com/o.jpg", previewImageUrl: "https://e.com/p.jpg" }]);
  });

  it("P. flex（type は Whale 側が付与する）", () => {
    const msgs = toLineMessages({ kind: "flex", altText: "alt", contents: bubble });
    expect(msgs).toEqual([{ type: "flex", altText: "alt", contents: bubble }]);
    expect(msgs[0].type).toBe("flex");
  });

  it("Q. どの形式でも messages.length は必ず 1", () => {
    const contents = [
      { kind: "text", text: "a" },
      { kind: "image", originalContentUrl: "https://e.com/o.jpg", previewImageUrl: "https://e.com/p.jpg" },
      { kind: "flex", altText: "a", contents: carousel },
    ] as const;
    for (const c of contents) expect(toLineMessages(c)).toHaveLength(1);
  });

  it("Q2. LINE に送らない内部フィールドを混ぜない", () => {
    const msg = toLineMessages({ kind: "flex", altText: "a", contents: bubble })[0];
    expect(Object.keys(msg).sort()).toEqual(["altText", "contents", "type"]);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("送信基盤を変更していないこと", () => {
  it("processor.ts は今までどおり parse → toLineMessages を通すだけ", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    expect(src).toContain("parseBroadcastContent");
    expect(src).toContain("toLineMessages");
    // 形式ごとの分岐を送信基盤へ持ち込んでいない
    expect(src).not.toContain('"image"');
    expect(src).not.toContain('"flex"');
    expect(src).not.toContain("originalContentUrl");
    expect(src).not.toContain("altText");
  });

  it("CAS / retry key / retry 分類 / chunk size は content 層と無関係のまま", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    expect(src).toContain("BROADCAST_CHUNK_SIZE = 50");
    expect(src).toContain("retryKey");
    expect(src).toContain('status: "pending"'); // 宛先単位 CAS
    expect(src).toContain("isRetryableFailure");
  });

  it("cron worker は content 形式を知らない", () => {
    const src = readCode("src/lib/broadcast/worker.ts");
    for (const t of ["image", "flex", "altText", "originalContentUrl", "toLineMessages", "parseBroadcastContent"]) {
      expect(src).not.toContain(t);
    }
    expect(src).not.toContain('from "./content"');
  });

  it("audience / service（snapshot・CAS）も content を知らない", () => {
    for (const f of ["src/lib/broadcast/audience.ts", "src/lib/broadcast/service.ts"]) {
      const src = readCode(f);
      for (const t of ["originalContentUrl", "altText", "toLineMessages"]) expect(src).not.toContain(t);
    }
  });

  it("lib/line.ts（LINE transport）を変更していない", () => {
    const src = readCode("src/lib/line.ts");
    expect(src).toContain("X-Line-Retry-Key");
    expect(src).toContain("LINE_PUSH_URL");
    // 配信専用の validate は broadcast 側に置き、transport には持ち込まない
    expect(src).not.toContain("validate/push");
  });

  it("応答メッセージ側の payload contract を触っていない", () => {
    const src = readCode("src/lib/broadcast/content.ts");
    // 応答メッセージ側のモジュール・概念を持ち込まない（配信専用に閉じる）
    for (const t of ["@/lib/message", "@/lib/line", "@/lib/flex", "webhook", "replyToken", "quickReply", "sender", "prisma"]) {
      expect(src).not.toContain(t);
    }
    // import 自体を持たない純粋モジュールであること
    expect(src).not.toMatch(/^import /m);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("schema / migration", () => {
  it("contentJson は JSONB のままで、migration を追加していない", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain('contentJson     Json      @map("content_json") @db.JsonB');
    // rich content のために Broadcast へ列を足していない
    expect(schema).not.toContain("contentKind");
    expect(schema).not.toContain("contentVersion");
  });
});
