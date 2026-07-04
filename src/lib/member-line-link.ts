// src/lib/member-line-link.ts
//
// 会員（WorkspaceMember）本人の LINE 連携（分析除外用の UID 取得）。
//   - 連携コードは「WS-LINE-LINK-XXXXXXXX」形式（通常のシナリオ回答・本文と衝突しにくい特殊形式）。
//   - webhook が対象 OA の公式 LINE 宛メッセージから source.userId を取得して保存するため、
//     除外に使う lineUserId は必ず UserProgress.lineUserId と同一 Provider・同一値になる。
//   - token は sha256 hash 保存・期限付き・one-time。平文は DB に残さない。
//
// pure（isMemberLinkCode / 形式）とサーバ（generate/hash/prisma）を同居させるが、
// 判定に使う isMemberLinkCode は crypto を呼ばず単体テスト可能。

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const MEMBER_LINK_PREFIX = "WS-LINE-LINK-";
/** コード本体（prefix の後ろ）の文字数。曖昧文字（0/O/1/I 等）を除いた Base32 風。 */
const CODE_BODY_LEN = 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O/1/I を除外
/** 完全一致判定用の正規表現（前後空白は呼び出し側で trim 済み前提だが、ここでも許容）。 */
const CODE_RE = new RegExp(`^${MEMBER_LINK_PREFIX}[${CODE_ALPHABET}]{${CODE_BODY_LEN}}$`);

export const LINK_TOKEN_TTL_MS = 20 * 60 * 1000; // 20 分

/**
 * テキストが「会員 LINE 連携コード」形式に完全一致するか（純関数・テスト可）。
 * 通常メッセージ / 謎解き回答 / QR ラベル等はこの形式に一致しないため横取りされない。
 */
export function isMemberLinkCode(text: string | null | undefined): boolean {
  if (!text) return false;
  return CODE_RE.test(text.trim());
}

/** ランダムな連携コード（平文）を生成する（サーバ専用）。 */
export function generateLinkCode(): string {
  const bytes = randomBytes(CODE_BODY_LEN);
  let body = "";
  for (let i = 0; i < CODE_BODY_LEN; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${MEMBER_LINK_PREFIX}${body}`;
}

/** 連携コードの sha256 hash（保存/照合用）。 */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/**
 * 本人用のワンタイム連携トークンを発行する（サーバ）。
 * 既存の未消費トークンは同一 member ぶんを掃除してから新規発行する（多重発行時の混乱防止）。
 * @returns 平文コード（一度きり表示用）と失効時刻
 */
export async function createMemberLinkToken(args: {
  oaId: string; workspaceMemberId: string; userId: string; now: Date;
}): Promise<{ code: string; expiresAt: Date }> {
  const code = generateLinkCode();
  const tokenHash = hashLinkCode(code);
  const expiresAt = new Date(args.now.getTime() + LINK_TOKEN_TTL_MS);

  // 同一 member の未消費・未失効トークンは無効化（consumed 済みにする）。
  await prisma.memberLineLinkToken.updateMany({
    where: { oaId: args.oaId, userId: args.userId, consumedAt: null },
    data:  { consumedAt: args.now },
  });

  await prisma.memberLineLinkToken.create({
    data: {
      oaId:              args.oaId,
      workspaceMemberId: args.workspaceMemberId,
      userId:            args.userId,
      tokenHash,
      expiresAt,
    },
  });
  return { code, expiresAt };
}

export type ConsumeResult =
  | { ok: true;  message: string }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "oa_mismatch" | "uid_taken" | "already_linked"; message: string };

/**
 * webhook から受け取った連携コード＋source.userId でトークンを消費し、
 * workspace_members.line_user_id に保存する（サーバ）。UserProgress には一切触れない。
 *   - token 無効/期限切れ/使用済み/OA不一致 → 失敗（返信メッセージ付き）
 *   - 既に同一 OA の別メンバーに同じ UID が紐づいている → 拒否（uid_taken）
 *   - 対象メンバーが既に UID 設定済み → 再連携不可（already_linked・安全側）
 */
export async function consumeMemberLinkCode(args: {
  oaId: string; code: string; lineUserId: string; now: Date;
}): Promise<ConsumeResult> {
  const INVALID = { ok: false as const, reason: "invalid" as const, message: "連携コードが無効または期限切れです。管理画面でコードを再発行してください。" };
  if (!isMemberLinkCode(args.code)) return INVALID;

  const tokenHash = hashLinkCode(args.code);
  const token = await prisma.memberLineLinkToken.findUnique({ where: { tokenHash } });
  if (!token) return INVALID;
  if (token.oaId !== args.oaId) return { ok: false, reason: "oa_mismatch", message: "このコードはこのアカウント宛ではありません。" };
  if (token.consumedAt) return { ok: false, reason: "consumed", message: "この連携コードはすでに使用済みです。管理画面で再発行してください。" };
  if (token.expiresAt.getTime() < args.now.getTime()) return { ok: false, reason: "expired", message: "連携コードの有効期限が切れています。管理画面で再発行してください。" };

  // 同一 OA で同じ UID が別メンバーに紐づいていないか。
  const uidOwner = await prisma.workspaceMember.findFirst({
    where:  { workspaceId: args.oaId, lineUserId: args.lineUserId },
    select: { userId: true },
  });
  if (uidOwner && uidOwner.userId !== token.userId) {
    return { ok: false, reason: "uid_taken", message: "この LINE アカウントは既に別のメンバーに連携済みです。" };
  }

  const member = await prisma.workspaceMember.findUnique({
    where:  { workspaceId_userId: { workspaceId: args.oaId, userId: token.userId } },
    select: { lineUserId: true },
  });
  if (!member) return INVALID;
  // 既に別 UID が設定済みなら再連携不可（安全側）。同じ UID の再送は成功扱いにする。
  if (member.lineUserId && member.lineUserId !== args.lineUserId) {
    // token は消費しておく（使い回し防止）。
    await prisma.memberLineLinkToken.update({ where: { id: token.id }, data: { consumedAt: args.now } });
    return { ok: false, reason: "already_linked", message: "このメンバーには既に別の LINE が連携されています。管理者に解除を依頼してください。" };
  }

  // 保存 ＋ token 消費（トランザクション）。
  await prisma.$transaction([
    prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: args.oaId, userId: token.userId } },
      data:  { lineUserId: args.lineUserId },
    }),
    prisma.memberLineLinkToken.update({ where: { id: token.id }, data: { consumedAt: args.now } }),
  ]);

  return { ok: true, message: "LINE の連携が完了しました。分析除外の設定が可能になりました。" };
}
