// src/lib/live.ts
// Whale Studio Live（隠し上位機能）の利用可否・権限判定ヘルパー（サーバー専用）。
//
// 権限モデル（studio 権限と Live 権限を厳密に分離）:
//   Live にアクセスできる = entitlement 有効 かつ 次のいずれか
//     - platform admin（運営）           → 全 section
//     - OA owner（実効ロール owner）       → 全 section
//     - liveRole を持つメンバー            → 自分の liveRole に対応する section のみ
//   studio role が admin/editor/viewer でも liveRole が無ければ Live には一切入れない。
//   権限がないユーザーには存在を露出しない（呼び出し側で notFound / 非表示にする）。

import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import { LIVE_ROLE_SECTION, type LiveRole, type LiveSection } from "@/lib/types/permissions";
import { activeCache, CACHE_KEY, TTL } from "@/lib/cache";

/** OaEntitlement.featureKey の第一弾 */
export const LIVE_FEATURE_KEY = "whale_studio_live";

/**
 * OA で Whale Studio Live が有効か（entitlement enabled）。
 *
 * 管理画面の複数ページから同一 OA に対して連続して呼ばれるため、activeCache に
 * 短 TTL（{@link TTL.LIVE_ENABLED}）で乗せる。`/api/admin/oa-entitlements` の
 * PATCH 成功時には {@link invalidateLiveEnabledCache} で write-through invalidation
 * を行うため、ON/OFF 操作の即時反映は維持される。
 */
export async function isLiveEnabled(oaId: string): Promise<boolean> {
  const key = CACHE_KEY.liveEnabled(oaId);
  const cached = await activeCache.get<boolean>(key);
  if (cached !== null) return cached;

  const ent = await prisma.oaEntitlement.findUnique({
    where:  { oaId_featureKey: { oaId, featureKey: LIVE_FEATURE_KEY } },
    select: { enabled: true },
  });
  const enabled = ent?.enabled === true;
  await activeCache.set(key, enabled, TTL.LIVE_ENABLED);
  return enabled;
}

/** /api/admin/oa-entitlements PATCH 成功時に呼ぶ。Live ON/OFF を即時反映するため。 */
export async function invalidateLiveEnabledCache(oaId: string): Promise<void> {
  await activeCache.delete(CACHE_KEY.liveEnabled(oaId));
}

/** メンバーの liveRole を取得（owner_key 判定の owner などメンバー行が無い場合は null）。 */
export async function getLiveRole(oaId: string, userId: string): Promise<LiveRole | null> {
  const member = await prisma.workspaceMember.findUnique({
    where:  { workspaceId_userId: { workspaceId: oaId, userId } },
    select: { liveRole: true },
  });
  return (member?.liveRole as LiveRole | null) ?? null;
}

/** OA owner（実効ロール）か。owner_key / ADMIN_IDENTITY も考慮する。 */
async function isOaOwner(oaId: string, userId: string): Promise<boolean> {
  const info = await getWorkspaceRole(oaId, userId); // MemberInfo | null
  return info?.role === "owner" && info.status === "active";
}

/**
 * Phase 2-J: 招待 URL を受諾済みの LiveActor.userId == user.id が存在するか。
 * Studio role / liveRole とは独立に、Actor Console だけ閲覧できるルートを提供する。
 */
async function isLinkedAsLiveActor(oaId: string, userId: string): Promise<boolean> {
  const actor = await prisma.liveActor.findFirst({
    where:  { oaId, userId },
    select: { id: true },
  });
  return actor !== null;
}

/**
 * Phase 2-J: Actor Console の「表示確認モード」(= 任意 Actor 視点プレビュー) を
 * 操作できるか。admin 集合 (= platform admin / OA owner / live_owner / live_admin)
 * のみ true を返す。一般演者 (= live_actor / 招待された LiveActor) には UI を出さない。
 */
export async function canPreviewLiveActor(oaId: string, userId: string): Promise<boolean> {
  if (!(await isLiveEnabled(oaId))) return false;
  if (isPlatformOwner(userId)) return true;
  if (await isOaOwner(oaId, userId)) return true;
  const liveRole = await getLiveRole(oaId, userId);
  return liveRole === "live_owner" || liveRole === "live_admin";
}

/**
 * Live 全体にアクセスできるか（メニュー表示・/live ハブ到達の判定）。
 * entitlement 有効 かつ（platform admin / OA owner / liveRole 保持 / 招待された Actor）。
 */
export async function canAccessLive(oaId: string, userId: string): Promise<boolean> {
  if (!(await isLiveEnabled(oaId))) return false;
  if (isPlatformOwner(userId)) return true;
  if (await isOaOwner(oaId, userId)) return true;
  const liveRole = await getLiveRole(oaId, userId);
  if (liveRole !== null) return true;
  // Phase 2-J: 招待を受諾した演者 (= LiveActor.userId に user.id) も /live hub に到達できる
  return await isLinkedAsLiveActor(oaId, userId);
}

/**
 * 特定の Live セクション（player/admin/actor）を閲覧できるか。
 * platform admin / OA owner は全 section。それ以外は liveRole が section に一致する場合のみ。
 *
 * Phase 2-J: actor section のみ、LiveActor.userId == user.id でも閲覧可能。
 */
export async function canViewLiveSection(
  oaId: string,
  userId: string,
  section: LiveSection,
): Promise<boolean> {
  if (!(await isLiveEnabled(oaId))) return false;
  if (isPlatformOwner(userId)) return true;
  if (await isOaOwner(oaId, userId)) return true;
  const liveRole = await getLiveRole(oaId, userId);
  if (liveRole === "live_owner") return true;
  if (liveRole && LIVE_ROLE_SECTION[liveRole] === section) return true;
  // Phase 2-J: actor section のみ、招待された LiveActor 経由で許可
  if (section === "actor" && await isLinkedAsLiveActor(oaId, userId)) return true;
  return false;
}
