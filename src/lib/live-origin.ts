// src/lib/live-origin.ts
//
// Live 実行レコードのプロダクト境界 origin（NATIVE / UZU_PRO）の共通ヘルパー。
//   - NATIVE  = LIVE for Whale Studio（native Live 管理 API/UI から作成・管理）
//   - UZU_PRO = for UZU Pro（/api/external/v2/* 経由で UZU Pro CMS から作成・管理）
//
// 方針:
//   - origin は明示保存（externalSessionRef 等の有無で推測しない）。
//   - native Live の全 read/write は `origin = NATIVE` を条件に含める（UZU_PRO は存在自体を露出せず 404 相当）。
//   - external v2 の全 read/write は `origin = UZU_PRO` を条件に含める（NATIVE を操作できない）。
//   - 子（Team/Token/Participant）は親 Session / 発行 token の origin を継承し、異 origin の紐付けは禁止。
//   - クライアント入力から origin を決めない（API 層で固定）。

import { LiveOrigin } from "@prisma/client";

export { LiveOrigin };

/** native Live（LIVE for Whale Studio）レコードの origin。 */
export const NATIVE_ORIGIN = LiveOrigin.NATIVE;
/** for UZU Pro（external v2 由来）レコードの origin。 */
export const UZU_PRO_ORIGIN = LiveOrigin.UZU_PRO;

/**
 * native Live の where に付与する origin 条件（`{ origin: "NATIVE" }`）。
 * 例: `prisma.liveSession.findMany({ where: { oaId, ...nativeOrigin() } })`
 * findUnique は unique 条件しか取れないため、id 取得は `findFirst({ where: { id, ...nativeOrigin() } })` にする。
 */
export function nativeOrigin(): { origin: typeof NATIVE_ORIGIN } {
  return { origin: NATIVE_ORIGIN };
}

/** external v2（for UZU Pro）の where に付与する origin 条件（`{ origin: "UZU_PRO" }`）。 */
export function uzuProOrigin(): { origin: typeof UZU_PRO_ORIGIN } {
  return { origin: UZU_PRO_ORIGIN };
}

/**
 * 親子の origin 整合を検証する。異なれば例外（service 層で紐付け前に呼ぶ）。
 * DB の FK では origin 一致を表現できないため、作成・紐付け時に機構的に担保する。
 */
export function assertSameOrigin(parent: LiveOrigin, child: LiveOrigin, context: string): void {
  if (parent !== child) {
    throw new Error(`[live-origin] origin mismatch (${context}): parent=${parent} child=${child}`);
  }
}
