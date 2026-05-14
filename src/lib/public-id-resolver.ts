// src/lib/public-id-resolver.ts
//
// Work / LiffPageConfig / Location を「UUID または publicId」のどちらでも引けるようにする resolver。
//
// 背景:
//   公開 URL では UUID ではなく 10 文字の短縮 ID (publicId) を使いたい。
//   ただし旧 URL (UUID 形式) も後方互換として維持する必要がある。
//   そのため、URL パスから渡される識別子は UUID / publicId のどちらでもよく、
//   route handler では本 helper で resolver を経由して対応する DB レコードを取得する。
//
// 仕様:
//   - 引数が UUID v4 形式に見える場合 → id で findUnique
//   - それ以外 → publicId で findUnique
//   - 見つからなければ null
//
// 注意:
//   UUID 判定は形式チェックのみ (URL 上での区別が目的)。
//   v4 ではない UUID-like な文字列でも UUID として扱う (寛容な判定)。

import { prisma } from "@/lib/prisma";

/** UUID 形式かどうかの簡易判定。8-4-4-4-12 形式の hex に一致するか。 */
export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Work を UUID / publicId のどちらでも検索する。 */
export async function findWorkByIdOrPublicId(idOrPublic: string) {
  if (looksLikeUuid(idOrPublic)) {
    return prisma.work.findUnique({ where: { id: idOrPublic } });
  }
  return prisma.work.findUnique({ where: { publicId: idOrPublic } });
}

/** LiffPageConfig を UUID / publicId のどちらでも検索する。
 *  workScope を指定すると、その work に属することも検証する (テナント分離)。 */
export async function findLiffPageConfigByIdOrPublicId(
  idOrPublic: string,
  options?: { workScope?: string },
) {
  const page = looksLikeUuid(idOrPublic)
    ? await prisma.liffPageConfig.findUnique({ where: { id: idOrPublic } })
    : await prisma.liffPageConfig.findUnique({ where: { publicId: idOrPublic } });
  if (!page) return null;
  if (options?.workScope && page.workId !== options.workScope) return null;
  return page;
}

/** Location を UUID / publicId のどちらでも検索する。
 *  workScope を指定すると、その work に属することも検証する。 */
export async function findLocationByIdOrPublicId(
  idOrPublic: string,
  options?: { workScope?: string },
) {
  const loc = looksLikeUuid(idOrPublic)
    ? await prisma.location.findUnique({ where: { id: idOrPublic } })
    : await prisma.location.findUnique({ where: { publicId: idOrPublic } });
  if (!loc) return null;
  if (options?.workScope && loc.workId !== options.workScope) return null;
  return loc;
}

/** Work + LiffPageConfig を 1 度で resolver する複合関数。
 *  workIdOrPublic と pageIdOrPublic の組み合わせが整合しないなら null。 */
export async function resolveWorkAndPage(
  workIdOrPublic: string,
  pageIdOrPublic: string,
) {
  const work = await findWorkByIdOrPublicId(workIdOrPublic);
  if (!work) return null;
  const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
  if (!page) return null;
  return { work, page };
}
