// src/lib/uzupro/ticket-link-replace.ts
//
// for ウズプロ ＞ チケット連携の「内容を修正」処理（PR-C）。
//
// 方針:
//   - **既存 TicketLink を直接上書き編集しない。** 修正は replacement で表現する:
//       旧 TicketLink を REVOKED → 修正内容で新 TicketLink を PENDING_UZU_BOOKING として作成。
//     これにより (a) 変更前の内容が履歴として残り、(b) CMS 照合済みデータを後から書き換えず、
//     (c) 修正後の内容が UZU Pro CMS で改めて照合され、
//     (d) PR-B の「REVOKED は terminal」設計と整合し、
//     (e) LINKED → PENDING_UZU_BOOKING という既存に無い遷移を増やさない。
//   - **旧 TicketLink の内容と TicketLinkMember は一切変更しない**（status のみ REVOKED）。
//     新しい TicketLinkMember は新 TicketLink に対して作り直す（旧メンバーの付け替えはしない）。
//   - 検証は LIFF 本登録（ticket-link/service.ts confirmTicketLink）と**同じ純関数**を使う。
//     管理画面専用の normalize / 検証を作らない。
//   - 参加人数は作品設定（Work.liffHomeSettingsJson の ticket_link）を唯一の正とし、
//     クライアントから participantCount を受け取らない（ticketTypeKey のみ受け取る）。
//   - プレイヤーの所有情報（lineUserId / lineDisplayName / oaId / workId / source）は
//     **旧 TicketLink からサーバー側で引き継ぐ**。クライアントからは受け取らない。
//   - uzuSyncedAt は引き継がない（新リンクは未同期 = CMS の差分取得対象として自然に拾われる）。
//
// 並行更新:
//   旧リンクの REVOKED 化は **compare-and-swap**（読んだ status を where に含める）。
//   この CAS が replacement 作成の gate であり、
//     - 同じ行への「内容を修正」2 連打で新リンクが 2 件できない
//     - PR-B の「連携を解除」と競合しても片方だけが成立する
//     - CMS sync-result による status 変更を stale 値で踏み潰さない
//   を同時に満たす。CAS の再試行は明示的に上限あり（無制限 retry はしない）。

import { Prisma } from "@prisma/client";
import type { TicketLinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canTransitionLink, validateCodeNames } from "@/lib/ticket-link/rules";
import {
  parseTicketLinkReservationNumberInput,
  ticketLinkReservationNumberErrorMessage,
} from "@/lib/ticket-link/reservation-number";
import { readTicketLinkSettings, resolveTicketTypeByKey } from "@/lib/ticket-link/settings";
import { recordUzuProActivity } from "@/lib/uzupro/activity";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 旧リンクを REVOKED にする CAS の試行上限。初回 + 最新 status での再判定 1 回のみ。
 * PR-B（revoke / sync-result）と同じ方針で、無制限 retry はしない。
 */
const MAX_REPLACE_CAS_ATTEMPTS = 2;

/** 修正できる状態。REVOKED は terminal なので対象外。 */
export const REPLACEABLE_STATUSES: readonly TicketLinkStatus[] = ["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"];

export type ReplaceInvalidCode =
  | "INVALID_TICKET_TYPE"
  | "INVALID_RESERVATION_NUMBER"
  | "CODE_NAME_COUNT_MISMATCH"
  | "CODE_NAME_INVALID";

export type ReplaceOutcome =
  /** 旧を REVOKED にし、新リンクを PENDING_UZU_BOOKING で作成した。 */
  | { kind: "replaced"; oldTicketLinkId: string; newTicketLinkId: string; previousStatus: TicketLinkStatus }
  /** 内容が実質的に変わっていない。**何も書き込まない**（replacement を作らない）。 */
  | { kind: "no_change" }
  /** 対象が無い / 別 OA・別作品。存在を露出しないため呼び出し側は 404 にする。 */
  | { kind: "not_found" }
  /** 既に解除済み。REVOKED は terminal なので修正できない。 */
  | { kind: "already_revoked" }
  /** 現在の状態からは REVOKED へ遷移できない（既存 rules 上は発生しない想定）。 */
  | { kind: "invalid_transition"; currentStatus: TicketLinkStatus }
  /** 並行更新で CAS が上限まで外れた。成功扱いにせず再操作を促す。 */
  | { kind: "conflict"; currentStatus: TicketLinkStatus }
  /** 入力が不正（メッセージはユーザー向け。内部情報を含めない）。 */
  | { kind: "invalid"; code: ReplaceInvalidCode; message: string }
  /** 新しい予約番号が既に別の有効な連携で使われている。 */
  | { kind: "reservation_taken" };

export interface ReplaceInput {
  /** URL 由来。これ単体では対象を確定させない。 */
  ticketLinkId: string;
  /** サーバー側で認可済みの OA。クライアント値を使わないこと。 */
  oaId: string;
  /** サーバー側で認可済みの作品。クライアント値を使わないこと。 */
  workId: string;
  /** 作品設定のチケット種別キー。**表示名や人数はここから解決する**。 */
  ticketTypeKey: string;
  /** 運営が入力した予約番号の生値。正規化・検証はサーバー側で行う。 */
  reservationNumberInput: string;
  /** 人数分のコードネーム。件数は participantCount と完全一致であること。 */
  codeNames: string[];
}

interface CurrentContent {
  normalizedReservationNumber: string;
  ticketTypeKey: string | null;
  participantCount: number;
  members: { codeName: string }[];
}

/**
 * 実質的な変更があるか（**サーバー側判定**。クライアントの申告を信用しない）。
 *
 * 比較は正規化後の値どうしで行う。予約番号の表記ゆれだけ（`１２３４５６` → `123-456`）は
 * 「変更なし」とみなす。
 */
export function isSameTicketLinkContent(
  current: CurrentContent,
  next: { normalized: string; ticketTypeKey: string; participantCount: number; codeNames: string[] },
): boolean {
  if (current.normalizedReservationNumber !== next.normalized) return false;
  if ((current.ticketTypeKey ?? null) !== next.ticketTypeKey) return false;
  if (current.participantCount !== next.participantCount) return false;

  // validateCodeNames と同じ正規化（NFKC + trim）で突き合わせる。
  const currentNames = current.members.map((m) => m.codeName.normalize("NFKC").trim());
  if (currentNames.length !== next.codeNames.length) return false;
  return currentNames.every((v, i) => v === next.codeNames[i]);
}

/**
 * replacement 本体。**単一トランザクション内で呼ぶこと。**
 *
 * 呼び出し側で `authorizeUzuPro(req, oaId, workId)` を通し、その認可済みの oaId / workId を渡すこと。
 */
export async function runTicketLinkReplace(
  tx: Db,
  input: ReplaceInput,
  actorUserId: string,
  now: Date,
): Promise<ReplaceOutcome> {
  const { ticketLinkId, oaId, workId } = input;

  // 1) 対象を取得。id だけでなく oaId + workId も条件に含める
  //    （別 OA / 別作品の id を渡されても 1 件も引けない = not_found）。
  const link = await tx.ticketLink.findFirst({
    where: { id: ticketLinkId, oaId, workId },
    select: {
      id: true,
      status: true,
      // ownership・登録経路はここから引き継ぐ（クライアントから受け取らない）。
      lineUserId: true,
      lineDisplayName: true,
      source: true,
      // no-op 判定用の現在値。
      normalizedReservationNumber: true,
      ticketTypeKey: true,
      participantCount: true,
      members: { orderBy: { memberIndex: "asc" }, select: { codeName: true } },
    },
  });
  if (!link) return { kind: "not_found" };
  if (link.status === "REVOKED") return { kind: "already_revoked" };
  if (!canTransitionLink(link.status, "REVOKED")) {
    return { kind: "invalid_transition", currentStatus: link.status };
  }

  // 2) 参加人数の source of truth = 作品設定。work も OA スコープで引く。
  const work = await tx.work.findFirst({
    where: { id: workId, oaId },
    select: { liffHomeSettingsJson: true },
  });
  if (!work) return { kind: "not_found" };
  const settings = readTicketLinkSettings(work.liffHomeSettingsJson);

  // 3) 入力検証。**LIFF 本登録と同じ純関数**を使う（管理画面専用の別実装を作らない）。
  //    無効化済みのチケット種別は解決しない（fail closed）。
  const ticketType = resolveTicketTypeByKey(settings, input.ticketTypeKey);
  if (!ticketType) {
    return {
      kind: "invalid",
      code: "INVALID_TICKET_TYPE",
      message: "選択されたチケット種別は現在ご利用いただけません。",
    };
  }

  const parsed = parseTicketLinkReservationNumberInput(input.reservationNumberInput);
  if (!parsed.ok) {
    return {
      kind: "invalid",
      code: "INVALID_RESERVATION_NUMBER",
      message: ticketLinkReservationNumberErrorMessage(parsed.reason),
    };
  }
  const normalized = parsed.normalized;

  // 人数はクライアント値ではなく設定値と突き合わせる。
  if (input.codeNames.length !== ticketType.participantCount) {
    return { kind: "invalid", code: "CODE_NAME_COUNT_MISMATCH", message: "コードネームの数が正しくありません。" };
  }
  const validation = validateCodeNames(input.codeNames);
  if (!validation.ok) {
    return {
      kind: "invalid",
      code: "CODE_NAME_INVALID",
      message: validation.errors[0]?.message ?? "コードネームが正しくありません。",
    };
  }

  // 4) no-op ならここで終了。**旧リンクを REVOKED にしない / 新リンクを作らない / ログも書かない。**
  if (
    isSameTicketLinkContent(link, {
      normalized,
      ticketTypeKey: ticketType.ticketTypeKey,
      participantCount: ticketType.participantCount,
      codeNames: validation.normalized,
    })
  ) {
    return { kind: "no_change" };
  }

  // 5) 新しい予約番号が既に別の有効な連携で使われていないか
  //    （部分 UNIQUE ticket_links_active_reservation_key と同じ条件。旧リンク自身は除く）。
  //    ここで弾いておけば「旧を解除したのに新規作成できない」無駄な往復を避けられる。
  //    競合で擦り抜けた場合は create の P2002 を replaceTicketLink 側で拾う。
  const taken = await tx.ticketLink.findFirst({
    where: {
      oaId,
      workId,
      normalizedReservationNumber: normalized,
      status: { in: ["PENDING_UZU_BOOKING", "LINKED"] },
      id: { not: link.id },
    },
    select: { id: true },
  });
  if (taken) return { kind: "reservation_taken" };

  // 6) 旧リンクを CAS で REVOKED にする。**これが replacement 作成の gate**。
  //    先に解除/修正した側が勝ち、後続は新リンクを作らない。
  let observed: TicketLinkStatus = link.status;
  let revoked = false;
  for (let attempt = 0; attempt < MAX_REPLACE_CAS_ATTEMPTS; attempt += 1) {
    const updated = await tx.ticketLink.updateMany({
      where: { id: link.id, oaId, workId, status: observed },
      data: { status: "REVOKED" },
    });
    if (updated.count > 0) {
      revoked = true;
      break;
    }

    // count 0 = 「where に一致する行が無かった」だけ。DB エラーは throw されるのでここには来ない。
    const after = await tx.ticketLink.findFirst({
      where: { id: link.id, oaId, workId },
      select: { status: true },
    });
    if (!after) return { kind: "not_found" };
    // 他の解除 / 修正が先に成立した → replacement を作らない（新リンクの二重作成を防ぐ）。
    if (after.status === "REVOKED") return { kind: "already_revoked" };
    if (!canTransitionLink(after.status, "REVOKED")) {
      return { kind: "invalid_transition", currentStatus: after.status };
    }
    observed = after.status; // 次の周回で最新 status に対して CAS する
  }
  if (!revoked) return { kind: "conflict", currentStatus: observed };

  // 7) 修正内容で新しい TicketLink + TicketLinkMember を作成する。
  //    旧 TicketLinkMember は触らない（旧リンクの履歴としてそのまま残す）。
  const created = await tx.ticketLink.create({
    data: {
      oaId,
      workId,
      // ownership はサーバー側で旧リンクから引き継ぐ。
      lineUserId: link.lineUserId,
      lineDisplayName: link.lineDisplayName,
      normalizedReservationNumber: normalized,
      reservationNumberRaw: input.reservationNumberInput.trim() || null,
      ticketTypeKey: ticketType.ticketTypeKey,
      ticketType: ticketType.ticketTypeLabel,
      participantCount: ticketType.participantCount,
      // TicketLinkSource に管理画面用の値は無い。enum / migration を増やさず旧値を引き継ぎ、
      // 「管理画面からの修正」であることは UzuProActivityLog 側で表現する。
      source: link.source,
      // 修正後は必ず CMS 照合待ちへ戻す。
      status: "PENDING_UZU_BOOKING",
      confirmedAt: now,
      // uzuSyncedAt は既定の null のまま（同期済み状態を引き継がない）。
      members: {
        create: validation.normalized.map((codeName, i) => ({ memberIndex: i + 1, codeName })),
      },
    },
    select: { id: true },
  });

  // 8) 監査ログ。**PII を入れない**（予約番号・コードネーム・LINE UID / 表示名は入れない）。
  //    旧新の内容は TicketLink 履歴から辿れるため、内部 ID で関連付けるだけにする。
  //    単純解除（ticket_link_revoke）と区別できるよう専用 action を使う。
  await recordUzuProActivity(tx, {
    oaId,
    workId,
    actorUserId,
    action: "ticket_link_replace",
    targetType: "ticket_link",
    targetId: link.id,
    detail: {
      // CAS が一致した status = 更新直前の実際の値（stale な初回読み取り値ではない）。
      fromStatus: observed,
      toStatus: "REVOKED",
      replacementTicketLinkId: created.id,
      replacementStatus: "PENDING_UZU_BOOKING",
    },
  });

  return {
    kind: "replaced",
    oldTicketLinkId: link.id,
    newTicketLinkId: created.id,
    previousStatus: observed,
  };
}

/**
 * 旧リンクの解除・新リンクの作成・メンバー作成・監査ログを **同一トランザクション**で実行する。
 *
 * どれか 1 つでも失敗すれば全体が rollback する。
 * 「旧連携だけ無効になって新連携が作れなかった」状態は作らない。
 */
export async function replaceTicketLink(
  args: ReplaceInput & { actorUserId: string; now?: Date },
): Promise<ReplaceOutcome> {
  const { actorUserId, now, ...input } = args;
  try {
    return await prisma.$transaction((tx) => runTicketLinkReplace(tx, input, actorUserId, now ?? new Date()));
  } catch (e) {
    // 部分 UNIQUE 違反 = 事前チェックをすり抜けた並行登録。
    // トランザクションは既に rollback されており、旧リンクは元の状態のまま。
    // Prisma の内部エラーをそのままユーザーへ出さず、業務メッセージへ変換する。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { kind: "reservation_taken" };
    }
    throw e;
  }
}
