// src/app/api/works/[workId]/route.ts
// GET    /api/works/:workId — 作品詳細（_count 付き）
// PATCH  /api/works/:workId — 作品更新
// DELETE /api/works/:workId — 作品削除（CASCADE: characters/phases/messages も削除）

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateWorkSchema, formatZodErrors } from "@/lib/validations";
import { parseLiffHomeSettings } from "@/components/liff/liff-style-helpers";
import { parseWelcomeMessages } from "@/lib/welcome-messages";
import { conflictsWithOthers } from "@/lib/start-keyword";
import { ZodError } from "zod";

/** 既存 liff_home_settings_json に、PATCH で渡されたキーだけをマージする。
 *  値を渡したキーは更新、空文字/空白のみ・null は「解除」としてキーを削除する。
 *  description は内部の改行を保持する（trim は空判定にのみ使用）。 */
function mergeLiffHomeSettings(
  existing: unknown,
  patch: { title?: string | null; description?: string | null; image_url?: string | null; header_title?: string | null; font_family?: string | null; home_menu_layout?: string | null },
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const key of ["title", "description", "image_url", "header_title"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (typeof v === "string" && v.trim() !== "") base[key] = v;
    else delete base[key]; // null / 空文字 / 空白のみ → 解除
  }
  // font_family は enum。"default" / null / 空 は「解除」（= 従来フォント）としてキー削除。
  if ("font_family" in patch) {
    const f = patch.font_family;
    if (typeof f === "string" && ["meiryo", "hiragino", "yu_gothic", "ud"].includes(f)) base.font_family = f;
    else delete base.font_family;
  }
  // home_menu_layout は enum。"list" のみ保存。"card" / null / 空 は「解除」（= 既定カード）としてキー削除。
  if ("home_menu_layout" in patch) {
    base.home_menu_layout = patch.home_menu_layout === "list" ? "list" : undefined;
    if (base.home_menu_layout === undefined) delete base.home_menu_layout;
  }
  return base as Prisma.InputJsonValue;
}
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";

function toResponse(w: {
  id: string; publicId?: string | null; oaId: string; title: string; description: string | null;
  publishStatus: string; sortOrder: number;
  liffEnabled?: boolean | null;
  liffHomeSettingsJson?: unknown;
  resumeEnabled?: boolean | null;
  systemCharacterId: string | null;
  welcomeMessage: string | null;
  welcomeMessagesJson?: unknown;
  welcomeLoadingSeconds?: number | null;
  followAction?: string | null;
  startKeyword?: string | null;
  startTriggerMode?: string | null;
  readReceiptMode: string | null; readDelayMs: number | null;
  typingEnabled: boolean | null; typingMinMs: number | null; typingMaxMs: number | null;
  loadingEnabled: boolean | null; loadingThresholdMs: number | null;
  loadingMinSeconds: number | null; loadingMaxSeconds: number | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:                  w.id,
    public_id:           w.publicId ?? undefined,
    oa_id:               w.oaId,
    title:               w.title,
    description:         w.description,
    publish_status:      w.publishStatus,
    sort_order:          w.sortOrder,
    // 既存 DB 行は migration 後 default(true) なので false 単体での null は来ない想定。
    // null/undefined のときは true 扱い (= LIFF 有効)。
    liff_enabled:        w.liffEnabled ?? true,
    // 作品メニューホームの任意設定。未設定/空 {} は全 null（= 従来表示）に正規化。
    liff_home_settings:  parseLiffHomeSettings(w.liffHomeSettingsJson),
    resume_enabled:      w.resumeEnabled ?? true,
    system_character_id: w.systemCharacterId,
    welcome_message:     w.welcomeMessage,
    welcome_messages:    parseWelcomeMessages(w.welcomeMessagesJson),
    welcome_loading_seconds: w.welcomeLoadingSeconds ?? 0,
    follow_action:       (w.followAction as "auto_start" | "welcome_wait" | "none" | undefined) ?? "auto_start",
    start_keyword:       w.startKeyword ?? null,
    start_trigger_mode:  (w.startTriggerMode as "keyword" | "free_text" | undefined) ?? "keyword",
    // 演出設定
    read_receipt_mode:    (w.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
    read_delay_ms:        w.readDelayMs ?? null,
    typing_enabled:       w.typingEnabled ?? null,
    typing_min_ms:        w.typingMinMs ?? null,
    typing_max_ms:        w.typingMaxMs ?? null,
    loading_enabled:      w.loadingEnabled ?? null,
    loading_threshold_ms: w.loadingThresholdMs ?? null,
    loading_min_seconds:  w.loadingMinSeconds ?? null,
    loading_max_seconds:  w.loadingMaxSeconds ?? null,
    created_at:          w.createdAt,
    updated_at:          w.updatedAt,
  };
}

// ── GET /api/works/:workId ───────────────────────────
export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) =>
  runWithRequestId(genRequestId(), () => withTiming("api/works-detail:GET", async () => {
    try {
      const work = await withTiming("api/works-detail:db:findUnique", () =>
        prisma.work.findUnique({
          where: { id: params.workId },
          include: {
            _count: {
              select: { characters: true, phases: true, messages: true, userProgress: true },
            },
            // 開始トリガーを持つ start フェーズを1件取得（list API と同仕様）。
            phases: {
              where:   { phaseType: "start" },
              select:  { startTrigger: true },
              take:    1,
              orderBy: { sortOrder: "asc" },
            },
          },
        }),
      );
      if (!work) return notFound("作品");

      const check = await withTiming("api/works-detail:rbac", () =>
        requireRole(work.oaId, user.id, 'viewer'),
      );
      if (!check.ok) return check.response;

      // 開始トリガー（開始フェーズ startTrigger）を返す。作品トップの開始判定
      //   （@/lib/start-keyword: Work.startKeyword ∨ 開始フェーズ startTrigger）に必要。
      //   ※ プレイヤー指標は作品トップでは既存 GET /api/analytics（audience と同一定義）を流用するため、
      //     ここでは集計しない（重複 groupBy を持たせない）。phases 未 include でも安全にアクセスする。
      return ok({
        ...toResponse(work),
        _count: work._count,
        start_trigger: work.phases?.[0]?.startTrigger ?? null,
      });
    } catch (err) {
      return serverError(err);
    }
  })),
);

// ── PATCH /api/works/:workId ─────────────────────────
export const PATCH = withAuth<{ workId: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.workId } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'tester');
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateWorkSchema.parse(body);

    // ── 開始キーワードの重複バリデーション ──
    // この作品が公開中（になる）かつ開始キーワードを持つ場合、同一 OA の他の公開中作品の
    // 開始キーワード候補（startKeyword ∨ 開始フェーズ startTrigger）と重複していたらエラー。
    const effectivePublish = data.publish_status ?? existing.publishStatus;
    const effectiveStartKw = data.start_keyword !== undefined ? data.start_keyword : existing.startKeyword;
    if (effectivePublish === "active" && (effectiveStartKw ?? "").trim()) {
      const otherActive = await prisma.work.findMany({
        where:  { oaId: existing.oaId, publishStatus: "active", id: { not: params.workId } },
        select: { id: true, startKeyword: true },
      });
      const others = await Promise.all(otherActive.map(async (w) => {
        const sp = await prisma.phase.findFirst({
          where: { workId: w.id, phaseType: "start", isActive: true },
          select: { startTrigger: true },
        });
        return { id: w.id, startKeyword: w.startKeyword, startTrigger: sp?.startTrigger ?? null };
      }));
      if (conflictsWithOthers(effectiveStartKw, others)) {
        return badRequest("開始キーワードが同じOAの公開中の他作品と重複しています。別のキーワードにしてください。");
      }
    }

    // ── 「自由入力で開始」(free_text) の重複バリデーション ──
    // この作品が公開中（になる）かつ free_text で開始する場合、同一 OA の他の公開中作品に
    // free_text が既にあれば「どの作品を開始するか曖昧」になるためエラー。
    const effectiveTriggerMode = data.start_trigger_mode ?? existing.startTriggerMode;
    if (effectivePublish === "active" && effectiveTriggerMode === "free_text") {
      const otherFreeText = await prisma.work.count({
        where: {
          oaId:             existing.oaId,
          publishStatus:    "active",
          startTriggerMode: "free_text",
          id:               { not: params.workId },
        },
      });
      if (otherFreeText > 0) {
        return badRequest("自由入力で開始できる作品は、1つの公式アカウントにつき1作品までです。どの作品を開始するか曖昧になるため、他の作品の設定を変更してください。");
      }
    }

    const updated = await prisma.work.update({
      where: { id: params.workId },
      data: {
        ...(data.title               !== undefined && { title:              data.title }),
        ...(data.description         !== undefined && { description:        data.description }),
        ...(data.publish_status      !== undefined && { publishStatus:      data.publish_status }),
        ...(data.sort_order          !== undefined && { sortOrder:          data.sort_order }),
        ...(data.liff_enabled        !== undefined && { liffEnabled:        data.liff_enabled }),
        ...(data.liff_home_settings  !== undefined && {
          liffHomeSettingsJson: mergeLiffHomeSettings(existing.liffHomeSettingsJson, data.liff_home_settings),
        }),
        ...(data.resume_enabled      !== undefined && { resumeEnabled:      data.resume_enabled }),
        ...(data.system_character_id !== undefined && { systemCharacterId:  data.system_character_id }),
        ...(data.welcome_message     !== undefined && { welcomeMessage:     data.welcome_message }),
        // あいさつ複数件（text/image）。welcomeMessagesJson を保存し、welcomeMessage を先頭 text に同期（案B）。
        // 全削除([])時は welcomeMessage=null。welcome_messages 省略時は何も変えない。
        ...(data.welcome_messages    !== undefined && {
          welcomeMessagesJson: data.welcome_messages,
          welcomeMessage:      data.welcome_messages.find((m) => m.type === "text")?.text ?? null,
        }),
        ...(data.welcome_loading_seconds !== undefined && { welcomeLoadingSeconds: data.welcome_loading_seconds }),
        ...(data.follow_action       !== undefined && { followAction:       data.follow_action }),
        // 開始キーワード: 空文字は null（解除）に正規化して保存。
        ...(data.start_keyword       !== undefined && { startKeyword:       (data.start_keyword ?? "").trim() || null }),
        // 開始方法（keyword / free_text）。省略時は変更なし。
        ...(data.start_trigger_mode  !== undefined && { startTriggerMode:   data.start_trigger_mode }),
        // 演出設定
        ...(data.read_receipt_mode    !== undefined && { readReceiptMode:    data.read_receipt_mode }),
        ...(data.read_delay_ms        !== undefined && { readDelayMs:        data.read_delay_ms }),
        ...(data.typing_enabled       !== undefined && { typingEnabled:      data.typing_enabled }),
        ...(data.typing_min_ms        !== undefined && { typingMinMs:        data.typing_min_ms }),
        ...(data.typing_max_ms        !== undefined && { typingMaxMs:        data.typing_max_ms }),
        ...(data.loading_enabled      !== undefined && { loadingEnabled:     data.loading_enabled }),
        ...(data.loading_threshold_ms !== undefined && { loadingThresholdMs: data.loading_threshold_ms }),
        ...(data.loading_min_seconds  !== undefined && { loadingMinSeconds:  data.loading_min_seconds }),
        ...(data.loading_max_seconds  !== undefined && { loadingMaxSeconds:  data.loading_max_seconds }),
      },
    });

    // キャッシュ無効化
    await activeCache.delete(CACHE_KEY.work(existing.oaId));

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/works/:workId ────────────────────────
export const DELETE = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.workId } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    // CASCADE により characters / phases / messages も削除される
    await prisma.work.delete({ where: { id: params.workId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
