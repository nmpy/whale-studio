// src/app/api/works/[id]/duplicate/route.ts
// POST /api/works/:id/duplicate
//
// 作品を複製する。
//
// 複製対象:
//   Work → Character → Phase → Message → Transition
//
// 変換ルール:
//   - タイトル         : 「元タイトル（コピー）」
//   - publish_status  : "draft"（公開状態はリセット）
//   - sort_order      : 同 OA 内の現在の最大値 + 1
//   - Character ID    : 新 UUID に張り替え（Message.character_id を追従）
//   - Phase ID        : 新 UUID に張り替え（Message.phase_id / Transition.from/to_phase_id を追従）
//   - UserProgress    : コピーしない（進行状態は新作品固有）
//
// すべての INSERT は単一トランザクションで実行するため、
// 途中でエラーが起きても DB は変更されない。

import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { created, notFound, serverError } from "@/lib/api-response";

export const POST = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    // ── 1. 複製元作品を全リレーションごと取得 ──────────
    const original = await prisma.work.findUnique({
      where:   { id: params.id },
      include: {
        characters: { orderBy: { sortOrder: "asc" } },
        phases: {
          orderBy: { sortOrder: "asc" },
          include: {
            messages:        { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
            transitionsFrom: { orderBy: [{ sortOrder: "asc" }] },
          },
        },
      },
    });
    if (!original) return notFound("作品");

    const check = await requireRole(original.oaId, user.id, 'tester');
    if (!check.ok) return check.response;

    // 同 OA 内の現在の最大 sort_order を取得
    const maxSortOrder = await prisma.work.aggregate({
      where:   { oaId: original.oaId },
      _max:    { sortOrder: true },
    });

    // ── 2. トランザクション内で全レコードを複製 ────────
    const newWork = await prisma.$transaction(async (tx) => {

      // ── 2-a. Work 作成 ──
      const work = await tx.work.create({
        data: {
          oaId:           original.oaId,
          title:          `${original.title}（コピー）`,
          description:    original.description,
          publishStatus:  "draft",                        // 複製後は常に下書き
          sortOrder:      (maxSortOrder._max.sortOrder ?? 0) + 1,
          welcomeMessage: original.welcomeMessage,        // あいさつメッセージも引き継ぐ
        },
      });

      // ── 2-b. Character 複製（旧 ID → 新 ID マップ） ──
      const charIdMap = new Map<string, string>();
      for (const char of original.characters) {
        const newChar = await tx.character.create({
          data: {
            workId:       work.id,
            name:         char.name,
            iconType:     char.iconType,
            iconText:     char.iconText,
            iconImageUrl: char.iconImageUrl,
            iconColor:    char.iconColor,
            sortOrder:    char.sortOrder,
            isActive:     char.isActive,
          },
        });
        charIdMap.set(char.id, newChar.id);
      }

      // ── 2-c. Phase 複製（旧 ID → 新 ID マップ） ──────
      const phaseIdMap = new Map<string, string>();
      for (const phase of original.phases) {
        const newPhase = await tx.phase.create({
          data: {
            workId:      work.id,
            phaseType:   phase.phaseType,
            name:        phase.name,
            description: phase.description,
            sortOrder:   phase.sortOrder,
            isActive:    phase.isActive,
          },
        });
        phaseIdMap.set(phase.id, newPhase.id);
      }

      // ── 2-d. Message 複製（phase_id / character_id を張り替え） ──
      for (const phase of original.phases) {
        const newPhaseId = phaseIdMap.get(phase.id);
        if (!newPhaseId) continue;

        for (const msg of phase.messages) {
          await tx.message.create({
            data: {
              workId:      work.id,
              phaseId:     newPhaseId,
              characterId: msg.characterId
                ? (charIdMap.get(msg.characterId) ?? null)
                : null,
              messageType: msg.messageType,
              body:        msg.body,
              assetUrl:    msg.assetUrl,
              sortOrder:   msg.sortOrder,
              isActive:    msg.isActive,
            },
          });
        }
      }

      // ── 2-e. Transition 複製（from/to phase_id を張り替え） ──
      for (const phase of original.phases) {
        for (const trans of phase.transitionsFrom) {
          const newFromPhaseId = phaseIdMap.get(trans.fromPhaseId);
          const newToPhaseId   = phaseIdMap.get(trans.toPhaseId);

          // 張り替え先が存在しない場合（削除済みフェーズへの遷移）はスキップ
          if (!newFromPhaseId || !newToPhaseId) continue;

          await tx.transition.create({
            data: {
              workId:        work.id,
              fromPhaseId:   newFromPhaseId,
              toPhaseId:     newToPhaseId,
              label:         trans.label,
              condition:     trans.condition,
              flagCondition: trans.flagCondition,
              setFlags:      trans.setFlags,
              sortOrder:     trans.sortOrder,
              isActive:      trans.isActive,
            },
          });
        }
      }

      return work;
    });

    // ── 3. 複製後の作品を _count 付きで返す ────────────
    const result = await prisma.work.findUnique({
      where:   { id: newWork.id },
      include: {
        _count: { select: { characters: true, phases: true, messages: true } },
      },
    });

    return created({
      id:                  result!.id,
      oa_id:               result!.oaId,
      title:               result!.title,
      description:         result!.description,
      publish_status:      result!.publishStatus,
      sort_order:          result!.sortOrder,
      system_character_id: result!.systemCharacterId,
      welcome_message:     result!.welcomeMessage,
      created_at:          result!.createdAt,
      updated_at:          result!.updatedAt,
      _count:              result!._count,
      // 複製元との差分を返す（UI でのフィードバック用）
      _duplicated_from: params.id,
    });
  } catch (err) {
    return serverError(err);
  }
});
