// src/app/api/oas/[id]/works/[workId]/messages/bootstrap/route.ts
//
// GET /api/oas/[id]/works/[workId]/messages/bootstrap
//
// メッセージ一覧画面の初期表示に必要なデータを「1 リクエスト」でまとめて返す
// Bootstrap API。
//
// ## 背景 (= なぜ作るか)
//
// 従来、メッセージ一覧 mount 時に以下 5 本が並列発火していた:
//   - GET /api/works/[workId]
//   - GET /api/messages?with_relations=true
//   - GET /api/phases
//   - GET /api/transitions?with_phases=true
//   - GET /api/oas/[oaId]/members/me   (= useWorkspaceRole)
//
// それぞれが withAuth (= Supabase auth.getUser() の往復) と getWorkspaceRole
// (= Oa.findUnique + WorkspaceMember.findUnique) を**個別に**実行していたため、
// 認証 + 認可のオーバーヘッドが 5 倍に積み上がり、warm でも 5 並列の最大待ちが
// 7〜8 秒級になっていた。
//
// この Bootstrap API は:
//   - 認証 (withAuth) を 1 回に集約
//   - 認可 (requireRole) を 1 回に集約。OA は getCachedOaById で warm hit させ、
//     requireRole 内部の Oa.findUnique をスキップ (preloadedOa)
//   - work / messages / phases / transitions を Promise.all で並列取得
// することで、初期表示のブロッキング往復を 5 → 1 に削減する。
//
// ## 権限・preview の扱い (= 既存方針を厳守)
//
//   - viewer 以上のみ通過 (requireRole)。getWorkspaceRole が唯一の source of truth。
//   - 返す role は **実 role** (= platform admin / owner / member の実体)。
//     previewRole / previewPlan は UI 表示専用であり、この API は一切採用しない
//     (= 既存の useAccessPreview / AccessPreviewBar の責務。サーバ権限は不変)。
//   - GET 専用。メッセージ作成・更新・削除・並び替えの権限 (POST/PATCH/DELETE) は
//     既存 /api/messages 系のまま変更しない。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, roleAtLeast } from "@/lib/rbac";
import { getCachedOaById } from "@/lib/oa-cache";
import { genRequestId, runWithRequestId, withTiming, PERF_LOG_ENABLED } from "@/lib/perf";
import {
  messageToResponse,
  phaseToResponse,
  transitionToResponse,
} from "@/lib/api/list-shapes";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string; workId: string }>(async (_req, { params }, user) =>
  runWithRequestId(genRequestId(), () => withTiming("api/messages-bootstrap:GET", async () => {
    const startedAt = performance.now();
    const dbStartedAt = performance.now();
    try {
      // 1. work 取得 (存在確認 + oaId 取得 + 画面が使う最小 work 情報を 1 query で)。
      const work = await withTiming("api/messages-bootstrap:db:work", () =>
        prisma.work.findUnique({
          where:  { id: params.workId },
          select: {
            id:                true,
            oaId:              true,
            title:             true,
            welcomeMessage:    true,
            publishStatus:     true,
            liffEnabled:       true,
            resumeEnabled:     true,
            systemCharacterId: true,
          },
        }),
      );
      if (!work) return notFound("作品");

      // URL の oaId と work.oaId が食い違う場合は、その OA 配下の作品ではない → 404。
      if (work.oaId !== params.id) return notFound("作品");

      // 2. 認可: OA を cache 越しに引いて requireRole にプリロード (内部 Oa.findUnique を回避)。
      //    role は実 role。preview では絶対に広げない。
      const cachedOa = await withTiming("api/messages-bootstrap:db:oa", () => getCachedOaById(work.oaId));
      if (!cachedOa) return notFound("OA");
      const check = await requireRole(work.oaId, user.id, "viewer", {
        preloadedOa: { ownerKey: cachedOa.ownerKey },
      });
      if (!check.ok) return check.response;
      const role = check.role;

      // 3. 一覧データを並列取得 (相互依存なし)。各 select は既存 GET API と同一 shape。
      const [messages, phases, transitions] = await withTiming(
        "api/messages-bootstrap:db:lists",
        () =>
          Promise.all([
            // messages: 既存 /api/messages?with_relations=true と同一 (phase + character を include)
            prisma.message.findMany({
              where:   { workId: work.id },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: {
                phase:     { select: { id: true, name: true, phaseType: true } },
                character: { select: { id: true, name: true, iconType: true, iconText: true, iconImageUrl: true, iconColor: true } },
              },
            }),
            // phases: 既存 /api/phases (global を除外 / _count 付き) と同一
            prisma.phase.findMany({
              where:   { workId: work.id, phaseType: { not: "global" } },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: { _count: { select: { messages: true, transitionsFrom: true } } },
            }),
            // transitions: 既存 /api/transitions?with_phases=true と同一 (toPhase を include)
            prisma.transition.findMany({
              where:   { workId: work.id },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
            }),
          ]),
      );
      // DB 寄りの所要時間 (work 取得 → OA 認可 → 3 list の並列取得まで)。
      const dbMs = Math.round(performance.now() - dbStartedAt);

      const payload = {
        // work の最小情報 (snake_case = 既存 client の shape に合わせる)
        work: {
          id:                  work.id,
          oa_id:               work.oaId,
          title:               work.title,
          welcome_message:     work.welcomeMessage,
          publish_status:      work.publishStatus,
          liff_enabled:        work.liffEnabled ?? true,
          resume_enabled:      work.resumeEnabled ?? true,
          system_character_id: work.systemCharacterId,
        },
        messages:    messages.map(messageToResponse),
        phases:      phases.map(phaseToResponse),
        transitions: transitions.map((t) => transitionToResponse(t, t.toPhase)),
        // 現在ユーザーの実 role + UI 表示用の権限フラグ (= 既存 useWorkspaceRole 相当)。
        role,
        permissions: {
          can_edit:  roleAtLeast(role, "tester"),
          is_owner:  role === "owner",
          is_admin:  roleAtLeast(role, "admin"),
          is_viewer: role === "viewer",
        },
        counts: {
          messages:    messages.length,
          phases:      phases.length,
          transitions: transitions.length,
        },
      };

      if (PERF_LOG_ENABLED) {
        const total = Math.round(performance.now() - startedAt);
        // PII は出さない (oaId / workId は識別子だが UUID 全長は出さず先頭のみ)。
        // eslint-disable-next-line no-console
        console.log(
          `[perf:admin:bootstrap] total=${total}ms db=${dbMs}ms oa=${params.id.slice(0, 8)}… work=${params.workId.slice(0, 8)}… ` +
          `msgs=${messages.length} phases=${phases.length} trans=${transitions.length}`,
        );
      }

      return ok(payload);
    } catch (err) {
      return serverError(err);
    }
  })),
);
