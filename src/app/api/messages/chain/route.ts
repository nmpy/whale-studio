// src/app/api/messages/chain/route.ts
// PUT /api/messages/chain
//
// 連続メッセージ（head → next_message_id で連なる送信チェーン）を「1リクエストで一括保存」する。
// 既存の保存はクライアントから update/create/delete を逐次叩く非トランザクション方式で、
// 途中失敗で中途半端な状態（リンク切れ・孤児スロット）が残るのが #6 の根本問題。
// 本 API は計画（planChainSave 純関数）→ prisma.$transaction で all-or-nothing 保存する。
//
// Body:
//   {
//     work_id: string,
//     head_id: string,                         // チェーン先頭メッセージ id（work に属する既存）
//     expected_head_updated_at?: string,        // 楽観ロック（head.updatedAt と不一致なら 409）
//     head?: { ...content },                    // head の本文等（省略時は内容更新なし）
//     slots: Array<{ id?, ...content, free_input_enabled? }>, // 2通目以降（即時送信順）
//     free_input_response_id?: string | null,   // 自由入力後の応答 message id（freeInputNext に設定）
//     removed_message_ids?: string[],            // 削除するスロット
//   }
//
// 認可: head の work の OA に対し tester（削除を含む場合は owner）。
// 返却: { chain: Message[], sendCount, exceedsReplyLimit, freeInputResponseId }
//
// freeInputNext 正規化:
//   - freeInput プロンプト = nextMessageId:null / freeInputNextMessageId:<応答 or null> / freeInputEnabled:true
//   - それ以外の送信チェーン message = freeInputNextMessageId:null / freeInputEnabled:false / nextMessageId:<次>
//
// UI 非接続（#6-2a）: 既存の編集/新規ページはまだこの API を呼ばない。

import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { quickReplyItemSchema } from "@/lib/validations";
import { planChainSave, type ChainSaveSpec, type WorkMessageRef } from "@/lib/chain-plan";

export const dynamic = "force-dynamic";

// チェーン編集で扱うメッセージ内容フィールド。
// 編集画面（formStateToMsgBody / additionalSlotToMsgBody）が保存する全フィールドを
// データ損失なく受けられるように網羅する。
// 注意: next_message_id / free_input_next_message_id は **このルートが計画に従って制御する**ため
//       content として受け取らない（z.object は未知キーを silently drop するので送られても無害）。
//       free_input_enabled は plan 判定に使うが、列への書き込みは link/正規化ステップが行う。
const contentSchema = z.object({
  trigger_keyword:  z.string().max(200).optional().nullable(),
  target_segment:   z.string().max(100).optional().nullable(),
  phase_id:         z.string().uuid().optional().nullable(),
  character_id:     z.string().uuid().optional().nullable(),
  message_type:     z.enum(["text", "image", "riddle", "video", "carousel", "voice", "flex"]).optional(),
  kind:             z.enum(["start", "normal", "response", "hint", "puzzle", "system_notice"]).optional(),
  body:             z.string().max(10000).optional().nullable(),
  asset_url:        z.string().url().optional().nullable(),
  notify_text:      z.string().max(500).optional().nullable(),
  riddle_id:        z.string().uuid().optional().nullable(),
  quick_replies:    z.array(quickReplyItemSchema).max(13).optional().nullable(),
  alt_text:         z.string().max(400).optional().nullable(),
  flex_payload_json: z.string().max(50000).optional().nullable(),
  lag_ms:           z.number().int().min(0).optional(),
  sort_order:       z.number().int().min(0).optional(),
  is_active:        z.boolean().optional(),
  // puzzle
  puzzle_type:      z.enum(["text", "image", "video", "carousel"]).optional().nullable(),
  answer:           z.string().max(500).optional().nullable(),
  puzzle_hint_text: z.string().max(1000).optional().nullable(),
  answer_match_type: z.array(z.enum(["exact", "partial", "ignore_punctuation", "normalize_width"])).optional(),
  correct_action:   z.enum(["text", "text_and_transition", "transition"]).optional().nullable(),
  correct_text:     z.string().max(2000).optional().nullable(),
  incorrect_text:   z.string().max(2000).optional().nullable(),
  incorrect_quick_replies: z.array(quickReplyItemSchema).max(13).optional().nullable(),
  correct_next_phase_id:   z.string().uuid().optional().nullable(),
  hint_mode:        z.enum(["always", "on_wrong", "hidden"]).optional(),
  // タップ遷移先
  tap_destination_id: z.string().uuid().optional().nullable(),
  tap_url:            z.string().max(2000).optional().nullable(),
  // 画像タップ時アクション
  image_action_type: z.enum(["none", "message", "uri", "liff", "postback"]).optional().nullable(),
  image_action_text: z.string().max(300).optional().nullable(),
  image_action_url:  z.string().max(2000).optional().nullable(),
  image_action_liff_page_id:  z.string().uuid().optional().nullable(),
  image_action_postback_data: z.string().max(300).optional().nullable(),
  // 自由入力受付
  free_input_enabled:      z.boolean().optional(),
  free_input_variable_key: z.string().max(100).optional().nullable(),
  // 演出設定
  read_receipt_mode:    z.enum(["inherit", "immediate", "delayed", "before_reply"]).optional().nullable(),
  read_delay_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_enabled:       z.boolean().optional().nullable(),
  typing_min_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_max_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  loading_enabled:      z.boolean().optional().nullable(),
  loading_threshold_ms: z.number().int().min(0).max(30000).optional().nullable(),
  loading_min_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  loading_max_seconds:  z.number().int().min(3).max(60).optional().nullable(),
});

const slotSchema = contentSchema.extend({
  id: z.string().uuid().optional().nullable(),
});

const chainSaveSchema = z.object({
  work_id:                   z.string().min(1),
  head_id:                   z.string().uuid(),
  expected_head_updated_at:  z.string().optional().nullable(),
  head:                      contentSchema.optional(),
  slots:                     z.array(slotSchema).max(50),
  free_input_response_id:    z.string().uuid().optional().nullable(),
  removed_message_ids:       z.array(z.string().uuid()).optional(),
  /** chain から外す（実体は残し nextMessageId=null）。非破壊・参照ガード対象外。 */
  detached_message_ids:      z.array(z.string().uuid()).optional(),
});

type ContentInput = z.infer<typeof contentSchema>;

// 内容フィールド → prisma data（undefined は据え置き、null は明示クリア）。
// next/freeInputNext/freeInputEnabled は link/正規化ステップが設定するため含めない。
function contentToData(c: ContentInput | undefined): Record<string, unknown> {
  if (!c) return {};
  const d: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) d[k] = v; };
  set("triggerKeyword", c.trigger_keyword);
  set("targetSegment", c.target_segment);
  set("phaseId", c.phase_id);
  set("characterId", c.character_id);
  set("messageType", c.message_type);
  set("kind", c.kind);
  set("body", c.body);
  set("assetUrl", c.asset_url);
  set("notifyText", c.notify_text);
  set("riddleId", c.riddle_id);
  if (c.quick_replies !== undefined) d.quickReplies = c.quick_replies ? JSON.stringify(c.quick_replies) : null;
  set("altText", c.alt_text);
  set("flexPayloadJson", c.flex_payload_json);
  set("lagMs", c.lag_ms);
  set("sortOrder", c.sort_order);
  set("isActive", c.is_active);
  // puzzle
  set("puzzleType", c.puzzle_type);
  set("answer", c.answer);
  set("puzzleHintText", c.puzzle_hint_text);
  if (c.answer_match_type !== undefined) d.answerMatchType = JSON.stringify(c.answer_match_type);
  set("correctAction", c.correct_action);
  set("correctText", c.correct_text);
  set("incorrectText", c.incorrect_text);
  if (c.incorrect_quick_replies !== undefined) d.incorrectQuickReplies = c.incorrect_quick_replies ? JSON.stringify(c.incorrect_quick_replies) : null;
  set("correctNextPhaseId", c.correct_next_phase_id);
  set("hintMode", c.hint_mode);
  // タップ遷移先
  set("tapDestinationId", c.tap_destination_id);
  set("tapUrl", c.tap_url);
  // 画像タップ時アクション
  set("imageActionType", c.image_action_type);
  set("imageActionText", c.image_action_text);
  set("imageActionUrl", c.image_action_url);
  set("imageActionLiffPageId", c.image_action_liff_page_id);
  set("imageActionPostbackData", c.image_action_postback_data);
  // 自由入力（key のみ。enabled / next は link/正規化が設定）
  set("freeInputVariableKey", c.free_input_variable_key);
  // 演出設定
  set("readReceiptMode", c.read_receipt_mode);
  set("readDelayMs", c.read_delay_ms);
  set("typingEnabled", c.typing_enabled);
  set("typingMinMs", c.typing_min_ms);
  set("typingMaxMs", c.typing_max_ms);
  set("loadingEnabled", c.loading_enabled);
  set("loadingThresholdMs", c.loading_threshold_ms);
  set("loadingMinSeconds", c.loading_min_seconds);
  set("loadingMaxSeconds", c.loading_max_seconds);
  return d;
}

const PLAN_CODE_MESSAGE: Record<string, string> = {
  MULTIPLE_FREE_INPUT: "MULTIPLE_FREE_INPUT",
  FREE_INPUT_NOT_LAST: "FREE_INPUT_NOT_LAST",
  RESPONSE_WITHOUT_PROMPT: "RESPONSE_WITHOUT_PROMPT",
  RESPONSE_IN_SEND_CHAIN: "RESPONSE_IN_SEND_CHAIN",
  DUPLICATE_MESSAGE: "DUPLICATE_MESSAGE",
  REMOVED_IN_CHAIN: "REMOVED_IN_CHAIN",
  DETACHED_IN_CHAIN: "DETACHED_IN_CHAIN",
  DETACHED_AND_REMOVED: "DETACHED_AND_REMOVED",
  REFERENCE_GUARD: "REFERENCE_GUARD",
  CYCLE: "CYCLE",
};

export const PUT = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = chainSaveSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / "));
    }
    const input = parsed.data;
    const removedIds = input.removed_message_ids ?? [];
    const detachedIds = input.detached_message_ids ?? [];

    // 認可: 実体削除を含むなら owner、内容更新 / 切り離し（非破壊）のみなら tester。
    const oaId = await getOaIdFromWorkId(input.work_id);
    if (!oaId) return badRequest("work_id に該当する作品が見つかりません");
    const role = removedIds.length > 0 ? "owner" : "tester";
    const check = await requireRole(oaId, user.id, role);
    if (!check.ok) return check.response;

    // work 内の全メッセージ（参照ガード + head 整合 + 楽観ロック用）
    const work = await prisma.message.findMany({
      where:  { workId: input.work_id },
      select: { id: true, phaseId: true, sortOrder: true, nextMessageId: true, freeInputNextMessageId: true, quickReplies: true, updatedAt: true },
    });
    const byId = new Map(work.map((m) => [m.id, m]));

    const head = byId.get(input.head_id);
    if (!head) return notFound("チェーン先頭メッセージ");

    // 関係する全 id が work に属することを保証（cross-work 防御）
    const slotIds = input.slots.map((s) => s.id).filter((id): id is string => !!id);
    const mustBelong = [...slotIds, ...removedIds, ...detachedIds, ...(input.free_input_response_id ? [input.free_input_response_id] : [])];
    for (const id of mustBelong) {
      if (!byId.has(id)) return badRequest(`message ${id.slice(0, 8)} は work=${input.work_id.slice(0, 8)} に属していません`);
    }

    // 楽観ロック: head.updatedAt 不一致 → 409（#246 バナーで表示）
    if (input.expected_head_updated_at) {
      const actual = head.updatedAt instanceof Date ? head.updatedAt.toISOString() : String(head.updatedAt);
      if (actual !== input.expected_head_updated_at) {
        return conflict("この連続メッセージは別の場所で更新されています。最新を読み込み直してから保存してください。");
      }
    }

    // 計画 + ドメイン検証（純関数）
    const spec: ChainSaveSpec = {
      headId:                input.head_id,
      headFreeInputEnabled:  input.head?.free_input_enabled ?? false,
      sendSlots:             input.slots.map((s) => ({ id: s.id ?? null, freeInputEnabled: s.free_input_enabled ?? false })),
      freeInputResponseId:   input.free_input_response_id ?? null,
      removedMessageIds:     removedIds,
      detachedMessageIds:    detachedIds,
    };
    const workRefs: WorkMessageRef[] = work.map((m) => ({
      id: m.id, nextMessageId: m.nextMessageId, freeInputNextMessageId: m.freeInputNextMessageId, quickReplies: m.quickReplies,
    }));
    const plan = planChainSave(spec, workRefs);
    if (!plan.ok) {
      return unprocessable(plan.message, PLAN_CODE_MESSAGE[plan.code] ?? "UNPROCESSABLE", { detail: plan.detail });
    }

    // ── トランザクション保存（all-or-nothing）─────────────────────────
    await prisma.$transaction(async (tx) => {
      // 1) 新規スロットを create → id を確定
      const resolvedSlotIds: string[] = [];
      for (let i = 0; i < input.slots.length; i++) {
        const s = input.slots[i];
        if (s.id) {
          resolvedSlotIds.push(s.id);
          continue;
        }
        const createdId = await createSlot(tx, input.work_id, head.phaseId, head.sortOrder, contentToData(s));
        resolvedSlotIds.push(createdId);
      }

      // 送信チェーン id 列（head=0, slots=1..）
      const sendChain = [input.head_id, ...resolvedSlotIds];
      const freeAt = plan.freeInputAt; // sendChain 内 index or null
      const responseId = plan.freeInputResponseId;

      // 2) 各送信チェーン message を内容更新 + リンク + freeInput 正規化
      for (let idx = 0; idx < sendChain.length; idx++) {
        const id = sendChain[idx];
        const isHead = idx === 0;
        const isFree = freeAt !== null && idx === freeAt;
        const nextId = isFree ? null : (sendChain[idx + 1] ?? null);

        const data: Record<string, unknown> = {
          ...contentToData(isHead ? input.head : input.slots[idx - 1]),
          nextMessageId:          nextId,
          freeInputEnabled:       isFree,
          freeInputNextMessageId: isFree ? responseId : null,
        };
        await tx.message.update({ where: { id }, data: data as Prisma.MessageUpdateInput });
      }

      // 3) chain から外す（非破壊）: nextMessageId=null にして単体化。実体は残す。
      //    freeInputEnabled / freeInputNextMessageId は保持（単体の freeInput メッセージとして残せる）。
      for (const id of detachedIds) {
        await tx.message.update({ where: { id }, data: { nextMessageId: null } });
      }

      // 4) 削除（実体消去）
      if (removedIds.length > 0) {
        await tx.message.deleteMany({ where: { id: { in: removedIds }, workId: input.work_id } });
      }
    });

    // キャッシュ無効化（head の phase + global）
    const headFull = await prisma.message.findUnique({
      where: { id: input.head_id }, select: { phaseId: true, phase: { select: { phaseType: true } } },
    });
    if (headFull?.phaseId) {
      await activeCache.delete(CACHE_KEY.phase(headFull.phaseId));
      await activeCache.delete(CACHE_KEY.startMsgs(headFull.phaseId));
    }
    if (!headFull?.phaseId || headFull.phase?.phaseType === "global") {
      await activeCache.delete(CACHE_KEY.globalKw(input.work_id));
    }

    // 保存後の chain を再 fetch して返す（head から next を walk）
    const after = await prisma.message.findMany({
      where: { workId: input.work_id },
      select: { id: true, nextMessageId: true, freeInputEnabled: true, freeInputNextMessageId: true, body: true, characterId: true, quickReplies: true, sortOrder: true },
    });
    const afterById = new Map(after.map((m) => [m.id, m]));
    const chain: typeof after = [];
    let cur: string | null = input.head_id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const m = afterById.get(cur);
      if (!m) break;
      chain.push(m);
      cur = m.nextMessageId ?? null;
    }

    return ok({
      chain,
      sendCount:           plan.sendCount,
      exceedsReplyLimit:   plan.exceedsReplyLimit,
      freeInputResponseId: plan.freeInputResponseId,
    });
  } catch (err) {
    console.error("[PUT /api/messages/chain] UNEXPECTED ERROR:", err);
    return serverError(err);
  }
});

// 新規スロットを head と同じ phase/work に作成して id を返す。
async function createSlot(
  tx: Prisma.TransactionClient,
  workId: string,
  phaseId: string | null,
  sortOrder: number,
  content: Record<string, unknown>,
): Promise<string> {
  // head の phase / sortOrder を継承（new slot は同 phase の連続送信）。
  const created = await tx.message.create({
    data: {
      workId,
      phaseId,
      sortOrder,
      messageType: "text",
      kind:        "normal",
      ...content,
    } as Prisma.MessageUncheckedCreateInput,
    select: { id: true },
  });
  return created.id;
}
