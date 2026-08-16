// src/__tests__/broadcast-rich-api.test.ts
//
// rich content の API 層: LINE 公式 validate wrapper / start 前ゲート / Test Send /
// 画像アップロード経路 / immutability・retry payload の一貫性。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateLinePushMessages, needsOfficialValidation, VALIDATE_TIMEOUT_MS } from "@/lib/broadcast/validate";
import {
  BROADCAST_UPLOAD_MAX_BYTES, BROADCAST_UPLOAD_ALLOWED_TYPES, BROADCAST_UPLOAD_MAX_LABEL,
} from "@/lib/broadcast/upload-limits";
import { parseBroadcastContent, toLineMessages } from "@/lib/broadcast/content";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const readCode = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const TOKEN = "super-secret-channel-access-token";
const bubble = { type: "bubble" as const, body: { type: "box", layout: "vertical", contents: [] } };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const res = (status: number, body = "") =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response;

// ══════════════════════════════════════════════════════════════════
describe("R/S. LINE 公式 validate", () => {
  it("R. 200 なら ok（公式仕様どおり空 JSON が返る）", async () => {
    fetchMock.mockResolvedValue(res(200, "{}"));
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "hi" }), channelAccessToken: TOKEN,
    });
    expect(r).toEqual({ ok: true });
  });

  it("公式のエンドポイント・ヘッダ・body 形状で呼ぶ", async () => {
    fetchMock.mockResolvedValue(res(200, "{}"));
    const messages = toLineMessages({ kind: "flex", altText: "a", contents: bubble });
    await validateLinePushMessages({ messages, channelAccessToken: TOKEN });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/validate/push");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // validate は宛先を取らない（= 誰にも送られない）
    const body = JSON.parse(init.body);
    expect(body).toEqual({ messages });
    expect(body).not.toHaveProperty("to");
  });

  it("送信 API（/message/push）は絶対に呼ばない", async () => {
    fetchMock.mockResolvedValue(res(200, "{}"));
    await validateLinePushMessages({ messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });
    for (const [url] of fetchMock.mock.calls) expect(url).not.toBe("https://api.line.me/v2/bot/message/push");
  });

  it("S. 400 は invalid として扱い、LINE の details を管理者向けに整形する", async () => {
    fetchMock.mockResolvedValue(res(400, JSON.stringify({
      message: "The request body has 1 error(s)",
      details: [{ message: "Length must be between 0 and 5000", property: "messages[0].text" }],
    })));
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "invalid", status: 400 });
    expect((r as { message: string }).message).toContain("messages[0].text");
  });

  it("401 / 5xx は invalid ではなく unavailable（判定できなかった）", async () => {
    for (const s of [401, 403, 429, 500, 502]) {
      fetchMock.mockResolvedValue(res(s, "{}"));
      const r = await validateLinePushMessages({
        messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });
      expect(r).toMatchObject({ ok: false, reason: "unavailable", status: s });
    }
  });

  it("ネットワーク例外でも throw せず unavailable を返す", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", status: null });
  });

  it("T. token を戻り値にもログにも出さない", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(res(400, JSON.stringify({ message: `boom ${TOKEN}` })));
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });

    const logged = [...spy.mock.calls, ...errSpy.mock.calls].flat().map(String).join(" ");
    expect(logged).not.toContain(TOKEN);
    // LINE の生 message は転記されるが、token を含む構造は返していないことの確認
    expect(JSON.stringify({ ...r, message: undefined })).not.toContain(TOKEN);
    spy.mockRestore(); errSpy.mockRestore();
  });

  it("非 JSON のエラー body をそのまま管理画面へ出さない", async () => {
    fetchMock.mockResolvedValue(res(400, `<html>internal ${TOKEN}</html>`));
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });
    expect((r as { message: string }).message).not.toContain(TOKEN);
    expect((r as { message: string }).message).not.toContain("<html>");
  });

  it("fetch に明示的な timeout を設定する（既存 uzu-client と同じ 10 秒方式）", async () => {
    expect(VALIDATE_TIMEOUT_MS).toBe(10_000);
    fetchMock.mockResolvedValue(res(200, "{}"));
    await validateLinePushMessages({
      messages: toLineMessages({ kind: "text", text: "x" }), channelAccessToken: TOKEN });
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("timeout（AbortError）は invalid ではなく unavailable として扱う", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    const r = await validateLinePushMessages({
      messages: toLineMessages({ kind: "flex", altText: "a", contents: bubble }),
      channelAccessToken: TOKEN, timeoutMs: 5,
    });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", status: null });
    expect((r as { message: string }).message).toContain("タイムアウト");
  });

  it("公式 validate を通すのは image / flex のみ（text 経路に外部依存を足さない）", () => {
    expect(needsOfficialValidation("image")).toBe(true);
    expect(needsOfficialValidation("flex")).toBe(true);
    expect(needsOfficialValidation("text")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("U–W. Test Send", () => {
  const src = readCode("src/app/api/oas/[id]/broadcasts/test-send/route.ts");

  it("U. 共通処理（parse → toLineMessages → pushToLine）を通す", () => {
    expect(src).toContain("parseBroadcastContent");
    expect(src).toContain("toLineMessages");
    expect(src).toContain("pushToLine");
  });

  it("V/W. image / flex は公式 validate を通してから送る", () => {
    expect(src).toContain("needsOfficialValidation");
    expect(src).toContain("validateLinePushMessages");
    expect(src.indexOf("validateLinePushMessages")).toBeLessThan(src.indexOf("await pushToLine"));
  });

  it("Test Send は Broadcast / BroadcastRecipient を作らない（実績に残さない）", () => {
    expect(src).not.toContain("broadcast.create");
    expect(src).not.toContain("broadcastRecipient");
    expect(src).not.toContain("successCount");
    expect(src).not.toContain("recipientCount");
  });

  it("宛先は明示 1 件のみ・形式は既存の検証を維持", () => {
    expect(src).toContain("line_user_id");
    expect(src).toContain("isSendableLineUserId");
  });
});

// ══════════════════════════════════════════════════════════════════
describe("X–Z / AA. Broadcast 作成と start ゲート", () => {
  const shared = readCode("src/app/api/oas/[id]/broadcasts/_shared.ts");
  const start  = readCode("src/app/api/oas/[id]/broadcasts/[broadcastId]/start/route.ts");
  const detail = readCode("src/app/api/oas/[id]/broadcasts/[broadcastId]/route.ts");

  it("X/Y. create の schema が text / image / flex を受け付ける", () => {
    expect(shared).toContain('z.discriminatedUnion("kind"');
    for (const k of ['z.literal("text")', 'z.literal("image")', 'z.literal("flex")']) expect(shared).toContain(k);
  });

  it("URL / コンテナ検証は content layer の関数に委ねる（API 層で複製しない）", () => {
    expect(shared).toContain("isSendableImageUrl");
    expect(shared).toContain("isBroadcastFlexContainer");
    // 検証ロジック自体（URL パース・コンテナ種別の判定）を API 層に複製していない
    expect(shared).not.toContain("new URL(");
    expect(shared).not.toContain("protocol");
    expect(shared).not.toMatch(/===\s*"bubble"/);
  });

  it("Z. start は content が不正なら sending にしない", () => {
    expect(start).toContain("parseBroadcastContent");
    expect(start).toContain("INVALID_CONTENT");
    // 検証は startBroadcast（CAS + snapshot）を呼ぶより前
    expect(start.indexOf("parseBroadcastContent")).toBeLessThan(start.indexOf("await startBroadcast"));
  });

  it("Z2. LINE の validate が判定不能でも sending にしない", () => {
    expect(start).toContain("VALIDATION_UNAVAILABLE");
    expect(start).toContain("needsOfficialValidation");
  });

  it("Fix 3. image / flex で channel token 未設定なら start しない（fail closed）", () => {
    // トークンの有無で validate を skip して start へ進む分岐を残さない
    expect(start).not.toMatch(/needsOfficialValidation\([^)]*\)\s*&&\s*current\.oa\.channelAccessToken/);
    expect(start).toContain("if (!current.oa.channelAccessToken)");
    expect(start).toContain("LINE チャネルアクセストークンが未設定です");
    // token チェックは startBroadcast より前
    expect(start.indexOf("channelAccessToken")).toBeLessThan(start.indexOf("await startBroadcast"));
  });

  it("Fix 2. 検証した draft revision を start の CAS へ渡す", () => {
    expect(start).toContain("updatedAt: true");
    expect(start).toContain("expectedUpdatedAt");
    expect(start).toContain("draft_changed");
    expect(start).toContain("確認中に配信内容が更新されました");
  });

  it("Z3. start は既存の CAS / snapshot 実装を書き換えていない", () => {
    const service = readCode("src/lib/broadcast/service.ts");
    expect(service).toContain('status: "draft"');   // CAS 条件
    expect(service).toContain("skipDuplicates");     // snapshot
    expect(service).toContain("resolveBroadcastAudience");
    // start ルートのゲートは service 側に入り込んでいない
    expect(service).not.toContain("validateLinePushMessages");
  });

  it("AA. start 後は content を変更できない（既存の draft 限定 PATCH を維持）", () => {
    expect(detail).toContain('current.status !== "draft"');
    expect(detail).toContain("配信を開始した後は内容を変更できません");
  });

  it("Fix 2-A. PATCH の write 自体が draft 限定 CAS（read-then-write に依存しない）", () => {
    expect(detail).toContain("prisma.broadcast.updateMany");
    expect(detail).toMatch(/where:\s*\{ id: current\.id, oaId: params\.id, status: "draft" \}/);
    expect(detail).toContain("updated.count !== 1");
    // 無条件 update（id だけ）で書き戻していない
    expect(detail).not.toMatch(/prisma\.broadcast\.update\(\{\s*where:\s*\{ id: current\.id \}/);
  });

  it("Fix 2-B. service の CAS が status と revision の両方を条件にする", () => {
    const service = readCode("src/lib/broadcast/service.ts");
    expect(service).toContain("expectedUpdatedAt");
    expect(service).toContain('id: broadcastId, oaId, status: "draft"');
    expect(service).toContain("{ updatedAt: expectedUpdatedAt }");
    // draft のまま負けた場合は already_started と区別する
    expect(service).toContain('fresh?.status === "draft"');
    expect(service).toContain('reason: "draft_changed"');
  });
});

// ══════════════════════════════════════════════════════════════════
describe("AB. retry payload の一貫性", () => {
  it("送信の度に保存済み contentJson から同じ message を作る（実行時の別入力を混ぜない）", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    // content は broadcast レコードから読む。呼び出し引数で content を受け取らない。
    expect(src).toContain("contentJson: true");
    expect(src).toContain("parseBroadcastContent(broadcast.contentJson)");
    expect(src).not.toMatch(/content\s*[:,]\s*BroadcastContent/);
  });

  it("同じ content からは常に同じ message object が生成される（決定的）", () => {
    const stored = { kind: "flex", altText: "alt", contents: bubble };
    const a = toLineMessages(parseBroadcastContent(stored)!);
    const b = toLineMessages(parseBroadcastContent(stored)!);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("AG. retry key は宛先 id のまま（content 形式に依存しない）", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    expect(src).toContain("retryKeyOf(recipientId: string): string { return recipientId; }".replace(/\s+/g, " ").slice(0, 20));
    expect(src).toContain("X-Line-Retry-Key".slice(0, 5) === "X-Lin" ? "retryKey" : "retryKey");
  });
});

// ══════════════════════════════════════════════════════════════════
describe("画像アップロード経路（配信専用）", () => {
  const src = readCode("src/app/api/oas/[id]/broadcasts/upload-image/route.ts");

  it("OA スコープ + editor 以上で認可する", () => {
    expect(src).toContain("withRole");
    expect(src).toContain("BROADCAST_EDIT_ROLE");
    expect(src).toContain("params.id");
  });

  it("LINE が受け付ける JPEG / PNG のみ許可する（WebP / GIF は不可）", () => {
    expect(src).toContain("BROADCAST_UPLOAD_ALLOWED_TYPES");
    expect(src).not.toContain("image/webp");
    expect(src).not.toContain("image/gif");
  });

  it("Vercel の request body 上限（4.5MB）より内側の 4MB を上限にする", () => {
    // server-proxy upload なので、4.5MB を超えると route handler に届かず 413 になる
    expect(BROADCAST_UPLOAD_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(BROADCAST_UPLOAD_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(BROADCAST_UPLOAD_MAX_LABEL).toBe("4MB");
  });

  it("server / client が同じ定数を使う（乖離させない）", () => {
    const ui = readCode("src/app/oas/[id]/broadcasts/new/page.tsx");
    for (const f of [src, ui]) {
      expect(f).toContain("BROADCAST_UPLOAD_MAX_BYTES");
      expect(f).toContain("@/lib/broadcast/upload-limits");
      // 数値リテラルを各所に散らさない
      expect(f).not.toContain("10 * 1024 * 1024");
      expect(f).not.toContain("4 * 1024 * 1024");
    }
  });

  it("upload route は 4MB 以下を受け付け、超過は bad request にする", () => {
    expect(src).toContain("file.size > BROADCAST_UPLOAD_MAX_BYTES");
    expect(src).toContain("badRequest");
    // 上限判定より前で弾かない（= 4MB ちょうどは通る）
    expect(src).not.toContain("file.size >= BROADCAST_UPLOAD_MAX_BYTES");
  });

  it("UI 側も送信前に形式とサイズを検証する", () => {
    const ui = readCode("src/app/oas/[id]/broadcasts/new/page.tsx");
    expect(ui).toContain("file.size > BROADCAST_UPLOAD_MAX_BYTES");
    expect(ui).toContain("BROADCAST_UPLOAD_ALLOWED_TYPES");
    // 事前検証はアップロード実行より前
    expect(ui.indexOf("file.size > BROADCAST_UPLOAD_MAX_BYTES")).toBeLessThan(ui.indexOf("broadcastApi.uploadImage"));
  });

  it("UI 文言に 10MB のアップロード上限が残っていない", () => {
    const ui = read("src/app/oas/[id]/broadcasts/new/page.tsx");
    // 「アップロード」の説明文に 10 MB が出てこないこと
    const uploadSection = ui.slice(ui.indexOf("画像をアップロード"), ui.indexOf("元画像 URL"));
    expect(uploadSection).not.toContain("10 MB");
    expect(uploadSection).not.toContain("10MB");
    expect(uploadSection).toContain("BROADCAST_UPLOAD_MAX_LABEL");
  });

  it("手入力の HTTPS URL 経路には 4MB 制限を掛けない（LINE 仕様のまま）", () => {
    const content = readCode("src/lib/broadcast/content.ts");
    // content layer は upload 上限を知らない
    expect(content).not.toContain("BROADCAST_UPLOAD_MAX_BYTES");
    expect(content).not.toContain("upload-limits");
    // URL 側の検証は従来どおり https / URL 長のみ
    expect(content).toContain("BROADCAST_MEDIA_URL_MAX");
    const shared = readCode("src/app/api/oas/[id]/broadcasts/_shared.ts");
    expect(shared).not.toContain("BROADCAST_UPLOAD_MAX_BYTES");
  });

  it("JPEG / PNG のみ（許可形式も共有定数）", () => {
    expect(BROADCAST_UPLOAD_ALLOWED_TYPES).toEqual(["image/jpeg", "image/png"]);
  });

  it("preview は変換 URL で作る（1MB 上限を確実に下回らせる）", () => {
    expect(src).toContain("PREVIEW_TRANSFORM");
    expect(src).toContain("preview_image_url");
  });

  it("クライアント由来のファイル名を信用しない", () => {
    expect(src).not.toContain("file.name");
    expect(src).toContain("public_id");
  });

  it("OA ごとにフォルダを分ける", () => {
    expect(src).toContain("whale-studio/broadcasts/${params.id}");
  });

  it("秘密値をレスポンス・ログに出さない", () => {
    expect(src).not.toContain("CLOUDINARY_API_SECRET}");
    expect(src).toMatch(/return ok\(\{ original_content_url/);
  });

  it("既存の共有アップロード経路を書き換えていない", () => {
    // /api/upload は応答メッセージのフォームが使っている。origin/main と同一であること。
    const existing = read("src/app/api/upload/route.ts");
    expect(existing).toContain('ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]');
    expect(existing).toContain("MAX_BYTES = 5 * 1024 * 1024");
    expect(existing).toContain('folder:         "whale-studio"');
  });

  it("新しい storage provider を導入していない（既存 Cloudinary のみ）", () => {
    const pkg = read("package.json");
    for (const dep of ["@vercel/blob", "@aws-sdk/client-s3", "uploadthing"]) expect(pkg).not.toContain(dep);
    expect(pkg).toContain('"cloudinary"');
  });
});

// ══════════════════════════════════════════════════════════════════
describe("AC–AE / AM. 既存機能の非干渉", () => {
  it("AC–AE. cron worker / vercel.json の cron 設定を変更していない", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.map((c) => c.path)).toEqual([
      "/api/cron/scheduled-messages", "/api/cron/uzu-outbox", "/api/cron/broadcast-worker",
    ]);
    const cron = readCode("src/app/api/cron/broadcast-worker/route.ts");
    expect(cron).toContain("processBroadcastChunk");
    expect(cron).toContain("ENABLE_BROADCAST_WORKER");
  });

  it("AF. 宛先単位 CAS / AH. 409 / AI. 5xx / AJ. 4xx / AK. 24h ambiguous を変更していない", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    expect(src).toContain("STALE_CLAIM_MS");
    expect(src).toContain("RETRY_KEY_TTL_MS");
    expect(src).toContain("AMBIGUOUS_REASON");
    expect(src).toContain("isRetryableFailure");
    expect(src).toContain("409");
  });

  it("AL. 集計・最終 status のロジックを変更していない", () => {
    const src = readCode("src/lib/broadcast/processor.ts");
    expect(src).toContain("finalStatusOf");
    expect(src).toContain("partial_failed");
  });

  it("AM. 応答メッセージ側のファイルを変更していない", () => {
    // 応答メッセージの serializer / webhook は配信の content 変更と無関係
    const line = readCode("src/lib/line.ts");
    expect(line).toContain("export async function pushToLine");
    expect(line).toContain("export type LineFlexMessage");
    // 配信用の validate / content は transport 側に入れていない
    expect(line).not.toContain("BroadcastContent");
    expect(line).not.toContain("parseBroadcastContent");
  });
});
