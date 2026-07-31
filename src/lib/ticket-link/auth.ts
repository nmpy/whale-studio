// src/lib/ticket-link/auth.ts
//
// チケット連携 LIFF API のサーバー側認証・認可。
//
// クライアントから送られた lineUserId / oaId / channelId / participantCount /
// ticketTypeLabel / 既存連携状態は **認可判断に一切使わない**。
// サーバーが以下をすべて自力で確定する:
//
//   1. 検証済み LINE userId  … verifyLiffAccessToken（LINE Profile API でトークン検証）
//   2. 対象 Work            … URL の workId（UUID/publicId）から DB 解決
//   3. 対象 OA              … Work → Oa（クライアント指定の oaId は見ない）
//   4. LIFF ID / チャネル    … Oa.liffId / Oa.channelId（DB 上の対応のみを正とする）
//   5. トークンの発行先チャネル … verifyTokenIssuedForOaChannel。
//                              LINE の oauth2/v2.1/verify が返す client_id と、
//                              Oa.liffId から導いた LINE Login チャネル ID の一致を確認する。
//                              = 別チャネルで発行された有効トークンの流用を防ぐ。
//   6. ユーザー ↔ OA の対応  … getOaFriendStatus（対象 OA の channelAccessToken で /v2/bot/profile）
//                              200 でなければ続行しない。
//   7. Work のチケット連携設定 … 有効でなければ 404 相当（存在秘匿）
//
// 再監査メモ:
//   verifyLiffAccessToken は /v2/profile を叩くだけで発行先チャネルを検証しない。
//   getOaFriendStatus も「友だちか」しか見ないため、トークンがこの LIFF 用である保証にならない。
//   そのため 5 の strict 検証を追加した（共通関数は変更していない）。

import type { Prisma, PrismaClient } from "@prisma/client";
import { verifyLiffAccessToken } from "@/lib/liff/session";
import { getOaFriendStatus } from "@/lib/line-friend";
import { verifyTokenIssuedForOaChannel } from "@/lib/ticket-link/token-channel";
import { readTicketLinkSettings, isManualInputAvailable } from "@/lib/ticket-link/settings";
import type { TicketLinkSettings } from "@/types";

export type TicketLinkAuthFailure =
  /** トークン不正・期限切れ。 */
  | { kind: "unauthorized" }
  /** 対象作品が無い / チケット連携が無効 / 権限外。存在秘匿のため一律これ。 */
  | { kind: "not_found" }
  /** OA の友だちでない（= この OA の導線から来ていない）。 */
  | { kind: "friend_required" }
  /** 別チャネルで発行されたトークン、または発行先を判定できない。 */
  | { kind: "channel_mismatch" }
  /** OA 側の LINE 設定不備。ユーザーの問題ではない。 */
  | { kind: "oa_config_error" }
  /** 一時的な通信失敗。 */
  | { kind: "unavailable" };

export interface TicketLinkAuthContext {
  /** サーバー検証済み。クライアント値は使わない。 */
  lineUserId:  string;
  /** LINE 側の表示名（取得できたときのみ）。 */
  displayName: string | null;
  oaId:        string;
  workId:      string;
  /** DB 上の LIFF ID（未設定なら null）。 */
  liffId:      string | null;
  channelId:   string;
  settings:    TicketLinkSettings;
}

export type TicketLinkAuthResult =
  | { ok: true;  ctx: TicketLinkAuthContext }
  | { ok: false; failure: TicketLinkAuthFailure };

type Db = PrismaClient | Prisma.TransactionClient;

export interface TicketLinkAuthInput {
  /** LIFF SDK の liff.getAccessToken() の値。 */
  accessToken: string | null | undefined;
  /** URL パラメータの作品識別子（UUID / publicId のどちらでも可）。 */
  workIdOrPublicId: string;
  /** 手動入力導線として使えることまで要求するか（書き込み系は true）。 */
  requireManualInput?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * チケット連携 API の共通認証。成功時のみ検証済みコンテキストを返す。
 * 失敗理由は呼び出し側でユーザー向け文言へ変換する（予約の存在有無は漏らさない）。
 */
export async function authenticateTicketLinkRequest(
  db: Db,
  input: TicketLinkAuthInput,
): Promise<TicketLinkAuthResult> {
  // 1) LINE ユーザーをサーバー検証（クライアントの lineUserId は使わない）
  const verified = await verifyLiffAccessToken(input.accessToken, { fetchImpl: input.fetchImpl });
  if (!verified.ok) return { ok: false, failure: { kind: "unauthorized" } };

  // 2)(3)(4) Work → OA を DB から解決。クライアント指定の oaId / channelId は見ない。
  const work = await db.work.findFirst({
    where: {
      OR: [{ id: input.workIdOrPublicId }, { publicId: input.workIdOrPublicId }],
    },
    select: {
      id: true,
      oaId: true,
      liffHomeSettingsJson: true,
      oa: { select: { id: true, liffId: true, channelId: true, channelAccessToken: true } },
    },
  });
  if (!work || !work.oa) return { ok: false, failure: { kind: "not_found" } };

  // 6) 作品のチケット連携設定（fail closed）。無効なら存在秘匿で not_found。
  const settings = readTicketLinkSettings(work.liffHomeSettingsJson);
  if (!settings.enabled) return { ok: false, failure: { kind: "not_found" } };
  if (input.requireManualInput && !isManualInputAvailable(settings)) {
    return { ok: false, failure: { kind: "not_found" } };
  }

  // 5) トークンの発行先チャネルが対象 OA の LIFF チャネルと一致するか（strict / fail closed）。
  const bind = await verifyTokenIssuedForOaChannel(input.accessToken, work.oa.liffId, {
    fetchImpl: input.fetchImpl,
  });
  if (bind.kind === "token_invalid") return { ok: false, failure: { kind: "unauthorized" } };
  if (bind.kind === "unavailable")   return { ok: false, failure: { kind: "unavailable" } };
  // channel_mismatch / expected_channel_unknown はどちらも「この LIFF 用と確認できない」。
  if (bind.kind !== "ok")            return { ok: false, failure: { kind: "channel_mismatch" } };

  // 6) ユーザー ↔ OA の対応を Messaging チャネル側で確認する。
  const friend = await getOaFriendStatus(verified.lineUserId, work.oa.channelAccessToken, {
    fetchImpl: input.fetchImpl,
  });
  if (friend.kind === "not_friend")   return { ok: false, failure: { kind: "friend_required" } };
  if (friend.kind === "config_error") return { ok: false, failure: { kind: "oa_config_error" } };
  if (friend.kind === "unavailable")  return { ok: false, failure: { kind: "unavailable" } };

  return {
    ok: true,
    ctx: {
      lineUserId:  verified.lineUserId,
      displayName: verified.displayName,
      oaId:        work.oaId,
      workId:      work.id,
      liffId:      work.oa.liffId,
      channelId:   work.oa.channelId,
      settings,
    },
  };
}

/**
 * ticket_link ページが対象 Work に属し、公開されているかを検証する。
 * 別 Work のページ ID を渡されても通さない。
 */
export async function assertTicketLinkPageBelongsToWork(
  db: Db,
  workId: string,
  pageIdOrPublicId: string,
): Promise<boolean> {
  const page = await db.liffPageConfig.findFirst({
    where: {
      workId,
      pageType: "ticket_link",
      isEnabled: true,
      OR: [{ id: pageIdOrPublicId }, { publicId: pageIdOrPublicId }],
    },
    select: { id: true },
  });
  return !!page;
}

/** 認証失敗をユーザー向け文言へ変換する（予約や他ユーザーの情報は一切出さない）。 */
export function authFailureMessage(f: TicketLinkAuthFailure): string {
  switch (f.kind) {
    case "unauthorized":
      return "LINE連携に失敗しました。もう一度開き直してください。";
    case "friend_required":
      return "この機能を利用するには、公式アカウントを友だち追加してください。";
    case "channel_mismatch":
      // 技術的詳細は出さない（攻撃者に手掛かりを与えない）。
      return "LINE連携に失敗しました。公式アカウントのメニューから開き直してください。";
    case "oa_config_error":
      return "現在ご利用いただけません。運営からの案内をお待ちください。";
    case "unavailable":
      return "通信が不安定です。時間をおいてもう一度お試しください。";
    case "not_found":
    default:
      return "この機能は現在ご利用いただけません。";
  }
}

/** 認証失敗の HTTP ステータス。存在秘匿のため not_found は 404。 */
export function authFailureStatus(f: TicketLinkAuthFailure): number {
  switch (f.kind) {
    case "unauthorized":     return 401;
    case "friend_required":  return 403;
    case "channel_mismatch": return 401;
    case "not_found":        return 404;
    case "oa_config_error":  return 503;
    case "unavailable":      return 503;
    default:                 return 400;
  }
}
