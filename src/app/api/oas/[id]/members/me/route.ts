// GET /api/oas/:id/members/me — 自分のロールを取得（viewer以上）

export const dynamic = "force-dynamic";

import { withRole } from "@/lib/auth";
import { ok, notFound, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { isLiveEnabled, getLiveRole, canAccessLive } from "@/lib/live";
import { hasUzuProGrant } from "@/lib/uzupro";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }, user, role) =>
    runWithRequestId(genRequestId(), () => withTiming("api/members-me:GET", async () => {
      try {
        const oa = await withTiming("api/members-me:db:oa", () =>
          prisma.oa.findUnique({
            where:  { id: params.id },
            select: { id: true, title: true },
          }),
        );
        if (!oa) return notFound("OA");

        // Whale Studio Live: ナビ表示の出し分けに使う。
        // Live 無効 OA / 権限なしユーザーには live を露出しない (= live_enabled=false / live_role=null)。
        // perf: live.ts 側は React.cache で重複排除されているため、Promise.all で並列に呼んでも
        //       isLiveEnabled / getLiveRole / isOaOwner の DB 呼び出しは request 内で 1 回に短絡する。
        const live_enabled = await withTiming("api/members-me:live:enabled", () => isLiveEnabled(params.id));
        const [live_role, live_access] = live_enabled
          ? await withTiming("api/members-me:live:roleAndAccess", () => Promise.all([
              getLiveRole(params.id, user.id),
              canAccessLive(params.id, user.id),
            ]))
          : [null, false];

        // for ウズプロ: per-user の Grant 保有のみ返す（OA 単位）。
        // アクセス可否は作品単位（Work.uzuProEnabled + Grant + member）のため、ナビ表示は
        // 作品単位 API /oas/[id]/works/[workId]/uzu-pro/access で判定する（members/me では返さない）。
        const uzu_pro_granted = await withTiming(
          "api/members-me:uzupro:granted",
          () => hasUzuProGrant(user.id),
        );

        return ok({
          workspace_id: params.id,
          user_id:      user.id,
          role,
          live_enabled,
          live_role,
          live_access,
          uzu_pro_granted,
        });
      } catch (err) {
        return serverError(err);
      }
    })),
);
