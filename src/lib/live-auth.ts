// src/lib/live-auth.ts
// Whale Studio Live API 専用の権限ガード。
//
// studio role (owner/admin/editor/viewer) と liveRole は分離されているため、
// 既存 withRole では Live 用途を直接表現できない。本ヘルパーで「Live 有効 OA」
// および「Live 管理権限のあるユーザー」を一括判定する。
//
// 設計:
//   - 全 Live API はまず isLiveEnabled() で OA の entitlement を確認 (= 無効なら 404 で
//     存在を露出しない)
//   - 認証必須。未ログイン → 401
//   - 認可:
//       canManageLive (= 作成・更新)  : platform admin / OA owner / live_owner / live_admin
//       canReadLive  (= 一覧・閲覧)   : 上記 + (将来 live_actor を追加する場合の拡張点)
//     現在は read / write とも同集合 (admin 集合) で運用する。live_player は不可。

import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import { isLiveEnabled, getLiveRole } from "@/lib/live";
import type { LiveSection, LiveRole } from "@/lib/types/permissions";

export type LiveAuthMode = "read" | "write";

export type LiveAuthOk = {
  ok: true;
  user: { id: string; email?: string };
  /** 判定根拠 (= デバッグ・ログ用) */
  via:
    | "platform_admin"
    | "oa_owner"
    | "live_owner"
    | "live_admin"
    | "live_actor"
    | "live_player"
    /// Phase 2-J: 招待 URL 受諾済みの LiveActor.userId 経由 (= WorkspaceMember 非依存)
    | "live_actor_invited";
};
export type LiveAuthFail = { ok: false; response: NextResponse };

/**
 * Live API 入口の共通ガード。
 *
 *   - 認証チェック
 *   - Live 有効 OA か (= isLiveEnabled)
 *   - 認可 (= mode に応じた集合)
 *
 * 失敗時は適切なステータスの NextResponse を返す。成功時は user / via を返す。
 *
 * 露出最小化のため Live 無効 OA / 権限なしはいずれも `404 not_found` で揃える。
 */
export async function authorizeLive(
  req: NextRequest,
  oaId: string,
  _mode: LiveAuthMode,
): Promise<LiveAuthOk | LiveAuthFail> {
  // 1. 認証
  const user = await getAuthUser(req);
  if (!user) {
    return {
      ok: false,
      response: Res.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } },
        { status: 401 },
      ),
    };
  }

  // 2. Live 有効 OA か (= 無効なら存在を露出しない)
  if (!(await isLiveEnabled(oaId))) {
    return { ok: false, response: notFoundResponse() };
  }

  // 3. OA が実在するか確認 (= isLiveEnabled が false の場合でも entitlement が無いだけで
  //    OA は存在し得るが、Live 無効と同様に 404 に揃える)
  const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { id: true } });
  if (!oa) {
    return { ok: false, response: notFoundResponse() };
  }

  // 4. 認可
  if (isPlatformOwner(user.id)) {
    return { ok: true, user, via: "platform_admin" };
  }

  const info = await getWorkspaceRole(oaId, user.id);
  if (info?.role === "owner" && info.status === "active") {
    return { ok: true, user, via: "oa_owner" };
  }

  const liveRole = await getLiveRole(oaId, user.id);
  if (liveRole === "live_owner") {
    return { ok: true, user, via: "live_owner" };
  }
  if (liveRole === "live_admin") {
    return { ok: true, user, via: "live_admin" };
  }

  // それ以外 (= live_actor / live_player / 非メンバー) は Admin API 経由では不可
  return { ok: false, response: notFoundResponse() };
}

function notFoundResponse(): NextResponse {
  return Res.json(
    { success: false, error: { code: "NOT_FOUND", message: "Not found" } },
    { status: 404 },
  );
}

/**
 * Section 別 (= player / actor / admin) の Live API ガード。
 *
 * 通過条件:
 *   - 認証済み
 *   - isLiveEnabled() で Live 有効 OA
 *   - 認可:
 *       platform admin / OA owner / live_owner はどの section でも可
 *       それ以外は section と liveRole が一致する場合のみ可
 *
 * Phase 2-A の authorizeLive (= admin 集合限定) と並行運用。Player/Actor 用エンドポイントは
 * 本関数を使い、Admin 用エンドポイントは authorizeLive を使い続ける (= 後方互換)。
 */
export async function authorizeLiveSection(
  req: NextRequest,
  oaId: string,
  section: LiveSection,
): Promise<LiveAuthOk | LiveAuthFail> {
  const user = await getAuthUser(req);
  if (!user) {
    return {
      ok: false,
      response: Res.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } },
        { status: 401 },
      ),
    };
  }

  if (!(await isLiveEnabled(oaId))) {
    return { ok: false, response: notFoundResponse() };
  }

  const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { id: true } });
  if (!oa) {
    return { ok: false, response: notFoundResponse() };
  }

  if (isPlatformOwner(user.id)) {
    return { ok: true, user, via: "platform_admin" };
  }

  const info = await getWorkspaceRole(oaId, user.id);
  if (info?.role === "owner" && info.status === "active") {
    return { ok: true, user, via: "oa_owner" };
  }

  const liveRole: LiveRole | null = await getLiveRole(oaId, user.id);
  if (liveRole === "live_owner") {
    return { ok: true, user, via: "live_owner" };
  }
  if (section === "player" && liveRole === "live_player") {
    return { ok: true, user, via: "live_player" };
  }
  if (section === "actor" && liveRole === "live_actor") {
    return { ok: true, user, via: "live_actor" };
  }
  if (section === "admin" && liveRole === "live_admin") {
    return { ok: true, user, via: "live_admin" };
  }

  // Phase 2-J: actor section のみ、LiveActor.userId 経由で許可。
  // 受諾済み演者は WorkspaceMember 非依存で Actor Console だけ閲覧できる
  // (= studio role / liveRole は付与しない設計)。
  if (section === "actor") {
    const linkedActor = await prisma.liveActor.findFirst({
      where:  { oaId, userId: user.id },
      select: { id: true },
    });
    if (linkedActor) {
      return { ok: true, user, via: "live_actor_invited" };
    }
  }

  return { ok: false, response: notFoundResponse() };
}
