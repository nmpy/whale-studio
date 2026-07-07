// src/app/api/line/[oaId]/webhook/route.ts
// POST /api/line/[oaId]/webhook
//
// LINE Messaging API Webhook エンドポイント。
// LINE は各イベントに replyToken を付与するため、1 イベントごとに reply を行う。
//
// ─ 処理フロー ─────────────────────────────────────────
//
//  1. raw body 読み取り → X-Line-Signature 検証
//  2. OA を DB から取得（channelSecret / channelAccessToken を使う）
//  3. OA 配下の最初のアクティブ作品を取得
//  4. テキストメッセージ / postback イベントを並列処理
//     a. "はじめる"（START_KEYWORD）→ シナリオを（再）開始
//     b. 進行中 → advance（遷移マッチング）
//     c. エンディング到達済み → 到達済みメッセージを返す
//     d. 未開始 → 開始を促すメッセージを返す
//  5. 200 OK を返す（LINE 要件: 常に速やかに 200 を返すこと）
//
// ─ 署名検証スキップ（開発用）────────────────────────────
//
//  X-Line-Signature ヘッダーが存在しない場合:
//    - NODE_ENV=development  → 検証スキップ（ローカル curl テスト可能）
//    - NODE_ENV=production   → 401 を返す（必ず署名を付けること）
//
// ─ テストユーザー限定モード ──────────────────────────────
//
//  TEST_MODE=true かつ TEST_LINE_USER_ID が設定されている場合:
//    - 一致する userId のイベントのみ処理する
//    - 不一致の userId は 200 OK を返すが返信・DB更新を行わない
//    - ログに "[Webhook] ignored (test mode)" を出力

import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyLineSignature,
  isStartCommand, isStartIntent, isResetCommand, isContinueCommand,
  replyToLine as _replyToLine, replyWithLagToLine as _replyWithLagToLine,
  buildPhaseMessages as _buildPhaseMessages, buildQuickReply, buildKeywordMessages as _buildKeywordMessages, buildQuickReplyFromItems,
  expandKeywordChain,
  RICHMENU_ACTIONS,
  sleep, resolveHeadSendDelayMs,
  type LineWebhookBody, type LineEvent, type LineSender, type LineMessage, type KeywordMessageRecord,
} from "@/lib/line";
import { buildRuntimeState, matchTransition, applySetFlags, safeParseFlags, safeParseVariables, safeParseWaitingForInput, fetchPhaseWithIncludes, drainAutoSendableItems, drainKeywordResponseFollowups, type PhaseRow } from "@/lib/runtime";
import { matchImageActionPhaseTransition } from "@/lib/image-action-phase";
import { matchBackToPuzzle, buildBackToPuzzlePostbackData, parseBackToPuzzlePostback } from "@/lib/hint-back-to-puzzle";
import { buildPuzzleHintPostbackData, parsePuzzleHintPostback, resolveHintItems } from "@/lib/puzzle-hint";
import { shouldOfferResumeChoice } from "@/lib/message-flow";
import { isFreeInputPrompt } from "@/lib/free-input";
import { decideFollowBehavior, resolveFollowSettings } from "@/lib/follow-action";
import { parseWelcomeMessages, WELCOME_MESSAGES_MAX, type WelcomeMessageItem } from "@/lib/welcome-messages";
import { resolveQrBranchDelivery } from "@/lib/qr-branch";
import { matchStartWork, normalizeStartKeyword, resolveFreeTextStartWork } from "@/lib/start-keyword";
import { parseQuickReplyPostback, resolveQuickReplyItem } from "@/lib/quick-reply-postback";
import { isMemberLinkCode, consumeMemberLinkCode } from "@/lib/member-line-link";
import { parseFrontier, selectQrScope } from "@/lib/qr-frontier";
import { collectLegacyQrMatches, collectLegacyHintMatches } from "@/lib/legacy-qr-fallback";
import { normalizeHintQrItems } from "@/lib/hint-qr";
import { applyFreeInputPostEffect } from "@/lib/frontier-effect";
import { handleBeaconEvent, type LineBeaconEvent } from "@/lib/beacon";
import { consumeBeaconArrivalTrigger } from "@/lib/checkin-trigger";
import { pushToLine as _pushToLine } from "@/lib/line";
import { moveQuickReplyToTail } from "@/lib/quick-reply-tail";
import { getCurrentPlanTierForOa } from "@/lib/plan-guard";
import { getPlanAccessState, FEATURE } from "@/lib/constants/plans";
import { logEvent } from "@/lib/event-logger";
import { activeCache, TTL, CACHE_KEY } from "@/lib/cache";
import { linkRichMenuToUser } from "@/lib/line-richmenu";
import { ReadReceiptController, calcReadDelayByTextLength, showLoadingAnimation } from "@/lib/line-read-receipt";
import { judgePuzzleAnswerAny, checkPuzzleAnswerAny, resolveAnswerCandidates, parseAnswerMatchType } from "@/lib/puzzle-answer";
import type { MessageTimingConfig } from "@/types";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";

// あいさつ送信前の「入力中…」演出（welcomeLoadingSeconds 最大8秒）で webhook が
// reply 前に最大8秒ブロックしうるため、安全マージンとして関数の最大実行時間を延長する。
// （push 分割ではない＝reply 一括前提。Vercel Pro は最大300s。）
export const maxDuration = 60;

/**
 * WorkRow から作品単位の演出設定を抽出する。
 * すべて null なら null を返す（= inherit、controller への影響なし）。
 */
function extractWorkTiming(work: { readReceiptMode: string | null; readDelayMs: number | null; typingEnabled: boolean | null; typingMinMs: number | null; typingMaxMs: number | null; loadingEnabled: boolean | null; loadingThresholdMs: number | null; loadingMinSeconds: number | null; loadingMaxSeconds: number | null } | null): MessageTimingConfig | null {
  if (!work) return null;
  const hasAny =
    work.readReceiptMode != null || work.readDelayMs != null ||
    work.typingEnabled != null || work.typingMinMs != null || work.typingMaxMs != null ||
    work.loadingEnabled != null || work.loadingThresholdMs != null ||
    work.loadingMinSeconds != null || work.loadingMaxSeconds != null;
  if (!hasAny) return null;
  return {
    read_receipt_mode:    (work.readReceiptMode as MessageTimingConfig["read_receipt_mode"]) ?? null,
    read_delay_ms:        work.readDelayMs        ?? null,
    typing_enabled:       work.typingEnabled       ?? null,
    typing_min_ms:        work.typingMinMs         ?? null,
    typing_max_ms:        work.typingMaxMs         ?? null,
    loading_enabled:      work.loadingEnabled      ?? null,
    loading_threshold_ms: work.loadingThresholdMs  ?? null,
    loading_min_seconds:  work.loadingMinSeconds   ?? null,
    loading_max_seconds:  work.loadingMaxSeconds   ?? null,
  };
}

// ────────────────────────────────────────────────
// 既読制御: AsyncLocalStorage でハンドラーにコントローラーを透過的に渡す
// ────────────────────────────────────────────────
// 既存の replyToLine / replyWithLagToLine 呼び出しを一切変更せずに
// 返信前の既読送信を自動的に挟み込む。

const readCtrlStorage = new AsyncLocalStorage<ReadReceiptController>();

/**
 * replyToLine のラッパー。AsyncLocalStorage から ReadReceiptController を取得し、
 * typing 待機 → 既読保証 → 返信 の順で実行する。
 */
async function replyToLine(
  replyToken: string,
  messages: LineMessage[],
  channelAccessToken: string,
): Promise<void> {
  const ctrl = readCtrlStorage.getStore();
  if (ctrl) {
    const first = messages[0];
    // Phase 2c hotfix v2: msg1 に明示 _timing があれば waitTypingForMessage を使う
    // (= receivedAt 経過時間に縛られず必ず typing_min~max ms 待機)。
    // _timing が無ければ legacy の waitTypingBeforeReply (= env-based + processing fallback) を使う。
    const typingStart = Date.now();
    if (first?._timing) {
      console.log(`[diag][typing-before] msg=${idOf(first)} via=perMessage`);
      await ctrl.waitTypingForMessage(first._timing);
    } else {
      console.log(`[diag][typing-before] msg=${first ? idOf(first) : "?"} via=legacy`);
      await ctrl.waitTypingBeforeReply();
    }
    const typingWaited = Date.now() - typingStart;
    console.log(`[diag][typing-after] msg=${first ? idOf(first) : "?"} waitedMs=${typingWaited}`);

    // Phase 2c hotfix: 1 通目に明示的 loading_enabled=true があれば、
    // 「処理遅延ベースで loading が出るか出ないか分からない」状態を解消し、
    // 必ず loading 表示してから reply する。
    if (first?._timing) {
      await ctrl.showLoadingForMessage(first._timing, { messageId: first._sourceMessageId ?? null });
    }
    await ctrl.ensureReadBeforeReply();
  }
  // 送信前待機（head/単発）: lag_ms を head にも適用する（従来は chain 2通目以降のみ＝バグ）。
  const headLag = resolveHeadSendDelayMs(messages[0]);
  if (headLag > 0) {
    console.log(`[timing] head send delay applied: resolvedLagMs=${headLag} source=message-lag path=reply`);
    await sleep(headLag);
  }
  await _replyToLine(replyToken, messages, channelAccessToken);
  if (ctrl) ctrl.markReplySent();
}

/** [diag] LineMessage の識別用 (= webhook/route.ts でも使う) */
function idOf(m: LineMessage): string {
  if (m.type === "text") return `txt:${(m.text ?? "").slice(0, 14)}`;
  if (m.type === "image") return `img:…${m.originalContentUrl.slice(-12)}`;
  if (m.type === "video") return `vid:…${m.originalContentUrl.slice(-12)}`;
  return `flex:${m.altText?.slice(0, 14) ?? "?"}`;
}

/**
 * replyWithLagToLine のラッパー。
 *  - chain head: typing 待機 → 既読保証 → reply 送信
 *  - chain 2 通目以降: 各メッセージの _timing で per-message typing 待機 (Phase 2c)
 *
 * Phase 2c: controller を _replyWithLagToLine に渡し、push loop 内で
 * waitTypingForMessage を呼ばせる。
 */
async function replyWithLagToLine(
  replyToken: string,
  messages: LineMessage[],
  userId: string,
  channelAccessToken: string,
): Promise<void> {
  const ctrl = readCtrlStorage.getStore();
  if (ctrl) {
    const first = messages[0];
    // Phase 2c hotfix v2: msg1 (chain head) にも per-message typing を適用する。
    // 経過時間 (receivedAt) に縛られず必ず typing_min~max ms 待機する。
    const typingStart = Date.now();
    if (first?._timing) {
      console.log(`[diag][typing-before] msg=${idOf(first)} via=perMessage (chain head)`);
      await ctrl.waitTypingForMessage(first._timing);
    } else {
      console.log(`[diag][typing-before] msg=${first ? idOf(first) : "?"} via=legacy (chain head)`);
      await ctrl.waitTypingBeforeReply();
    }
    const typingWaited = Date.now() - typingStart;
    console.log(`[diag][typing-after] msg=${first ? idOf(first) : "?"} waitedMs=${typingWaited} (chain head)`);

    // Phase 2c hotfix: chain head (= msg1) に明示的 loading_enabled=true があれば、
    // 処理時間に依存せず必ず loading 表示してから reply する。
    // chain 2 通目以降の loading は _replyWithLagToLine の push loop で個別適用される。
    if (first?._timing) {
      await ctrl.showLoadingForMessage(first._timing, { messageId: first._sourceMessageId ?? null });
    }
    await ctrl.ensureReadBeforeReply();
  }
  // 送信前待機（chain head）: head の lag_ms を適用する（chain 2通目以降は _replyWithLagToLine 側で適用）。
  const headLag = resolveHeadSendDelayMs(messages[0]);
  if (headLag > 0) {
    console.log(`[timing] head send delay applied: resolvedLagMs=${headLag} source=message-lag path=chain-head`);
    await sleep(headLag);
  }
  await _replyWithLagToLine(replyToken, messages, userId, channelAccessToken, ctrl);
  if (ctrl) ctrl.markReplySent();
}

/**
 * buildPhaseMessages のラッパー。chain head (= 1 通目) の演出設定を controller に適用する。
 *
 * Phase 2c: 2 通目以降の per-message timing は LineMessage._timing として
 * convertMessageToLine で搬送され、_replyWithLagToLine の push loop で
 * waitTypingForMessage 経由で適用される (= ここでは触らない)。
 */
function buildPhaseMessages(
  ...args: Parameters<typeof _buildPhaseMessages>
): ReturnType<typeof _buildPhaseMessages> {
  const msgs = _buildPhaseMessages(...args);
  const firstMsg = args[0]?.messages[0];
  // [diag] RuntimePhase の各メッセージの timing/lag をログに出す
  console.log(
    `[diag][timing-runtime-phase] msgs=${args[0]?.messages.length ?? 0}件`,
    (args[0]?.messages ?? []).map((m, i) =>
      `[${i}] id=${m.id.slice(0, 8)} kind=${m.kind} lag=${m.lag_ms} timing=${m.timing ? "あり" : "null"}` +
      (m.timing ? ` typing=${m.timing.typing_enabled} typingMin=${m.timing.typing_min_ms} typingMax=${m.timing.typing_max_ms} loading=${m.timing.loading_enabled} read=${m.timing.read_receipt_mode}` : ""),
    ).join(" / "),
  );
  if (firstMsg?.timing) {
    console.log(`[diag][timing-ctrl-apply] msg1 timing → controller`, firstMsg.timing);
    readCtrlStorage.getStore()?.applyMessageTiming(firstMsg.timing);
  } else {
    console.log(`[diag][timing-ctrl-apply] msg1 timing null → controller stays default (env)`);
  }
  return msgs;
}

/**
 * buildKeywordMessages のラッパー。
 * Phase 2c: KeywordMessageRecord にも timing を持たせたため、1 通目の timing を controller に適用する。
 * 2 通目以降は _timing 経由で per-message timing が適用される。
 */
function buildKeywordMessages(
  ...args: Parameters<typeof _buildKeywordMessages>
): ReturnType<typeof _buildKeywordMessages> {
  const msgs = _buildKeywordMessages(...args);
  const firstRecord = args[0]?.[0];
  // [diag] keyword record の各 msg の timing/lag をログに出す
  console.log(
    `[diag][timing-keyword-records] records=${args[0]?.length ?? 0}件`,
    (args[0] ?? []).map((r, i) =>
      `[${i}] id=${r.id.slice(0, 8)} lag=${r.lagMs ?? "—"} timing=${r.timing ? "あり" : "null"}` +
      (r.timing ? ` typing=${r.timing.typing_enabled} read=${r.timing.read_receipt_mode}` : ""),
    ).join(" / "),
  );
  if (firstRecord?.timing) {
    console.log(`[diag][timing-ctrl-apply][kw] msg1 timing → controller`, firstRecord.timing);
    readCtrlStorage.getStore()?.applyMessageTiming(firstRecord.timing);
  }
  return msgs;
}
import {
  loadSheetsData,
  findActiveWork,
} from "@/lib/sheets-db";
import {
  handleTextEventSheets,
  handlePostbackEventSheets,
  buildSystemSenderFromSheets,
} from "@/lib/sheets-scenario";

// visible_phase と phaseType のマッピング
const PHASE_TYPE_TO_VISIBLE: Record<string, string[]> = {
  start:   ["start"],
  normal:  ["playing"],
  ending:  ["cleared"],
};

/**
 * フェーズ遷移時に対応する visible_phase のリッチメニューをユーザーにリンクする。
 * 対応するメニューがない場合は何もしない（デフォルトメニューのまま）。
 */
async function switchRichMenuForUser(
  oa:        { id: string; channelAccessToken: string },
  userId:    string,
  phaseType: string,
): Promise<void> {
  try {
    const visiblePhases = PHASE_TYPE_TO_VISIBLE[phaseType] ?? ["playing"];
    const menu = await prisma.richMenu.findFirst({
      where: {
        oaId:         oa.id,
        visiblePhase: { in: visiblePhases },
        lineRichMenuId: { not: null },
        isActive:     true,
      },
    });
    if (menu?.lineRichMenuId) {
      await linkRichMenuToUser(oa.channelAccessToken, userId, menu.lineRichMenuId);
    }
  } catch (e) {
    // メニュー切り替え失敗はサイレント（メッセージ送信には影響しない）
    console.warn("[webhook] visible_phase メニュー切り替え失敗:", e);
  }
}

const isDev = process.env.NODE_ENV !== "production";

// ── ビルド識別子（コールドスタート時に一度だけ出力）─────────
// 旧ビルド vs 新ビルドを Vercel ログで切り分けるためのマーカー。
// このログが出ていれば Phase-C キャッシュコードが動作中。
console.log("[build] webhook cache=phase-c-v4 cache-provider=" + activeCache.constructor.name);

// ────────────────────────────────────────────────
// インメモリキャッシュヘルパー
// ────────────────────────────────────────────────
// サーバーウォーム時に OA / Work / Phase / GlobalCmd 等をインメモリキャッシュする。
// 同一コンテナ内の連続アクセスで DB クエリを大幅に削減し、応答速度を改善する。
// UserProgress は毎アクセスで変わるためキャッシュしない。

/** アクティブ Work を取得するヘルパー（型導出専用）*/
async function fetchActiveWork(oaId: string) {
  return prisma.work.findFirst({
    where:   { oaId, publishStatus: "active" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      systemCharacter: {
        select: { name: true, iconImageUrl: true },
      },
    },
  });
}
type WorkRow = NonNullable<Awaited<ReturnType<typeof fetchActiveWork>>>;

// ── 多作品（1 OA に複数公開）対応のヘルパー ───────────────────────────────
// 既存の単一作品パス（fetchActiveWork + work キャッシュ）は一切変更しない。
// 公開中が複数のときだけ、開始キーワードで作品を解決する。

/** OA の公開中作品を全件取得（単一作品時の fetchActiveWork と同じ include / 並び順）。キャッシュはしない（古い単一Workと混ざらないため・常に最新）。 */
async function fetchActiveWorks(oaId: string): Promise<WorkRow[]> {
  return prisma.work.findMany({
    where:   { oaId, publishStatus: "active" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { systemCharacter: { select: { name: true, iconImageUrl: true } } },
  });
}

/** work の systemCharacter から LINE sender を構築（既存ロジックを共通化）。 */
function buildWorkSystemSender(work: WorkRow | null): LineSender | undefined {
  return work?.systemCharacter
    ? {
        name: work.systemCharacter.name.slice(0, 20),
        ...(work.systemCharacter.iconImageUrl?.startsWith("https://")
          ? { iconUrl: work.systemCharacter.iconImageUrl }
          : {}),
      }
    : undefined;
}

/**
 * 開始キーワード非一致の通常テキストで「現在進行中の作品」を特定する。
 *   - 対象 OA の active 作品のみ（activeWorkIds）
 *   - UserProgress.lineUserId 一致・reachedEnding=false・currentPhaseId != null
 *   - lastInteractedAt DESC（同値は updatedAt DESC）で 1 件
 * lineUserId だけの横断検索はしない（必ず activeWorkIds で絞る）。該当なしは null。
 */
async function resolveInProgressWorkId(userId: string, activeWorkIds: string[]): Promise<string | null> {
  if (activeWorkIds.length === 0) return null;
  const p = await prisma.userProgress.findFirst({
    where:   { lineUserId: userId, workId: { in: activeWorkIds }, reachedEnding: false, currentPhaseId: { not: null } },
    orderBy: [{ lastInteractedAt: "desc" }, { updatedAt: "desc" }],
    select:  { workId: true },
  });
  return p?.workId ?? null;
}

/**
 * このユーザーが対象 OA の active 作品に「何らかの UserProgress を持つか」を返す。
 * 未完了(reachedEnding=false)・完了(reachedEnding=true) を問わず1件でもあれば true。
 * free_text 開始は「完全新規（＝progress が一切ない）」ユーザーに限定するためのゲートに使う
 * （クリア済みユーザーが感想/雑談を送っただけで再スタートしないようにする）。
 */
async function hasAnyProgressInActiveWorks(userId: string, activeWorkIds: string[]): Promise<boolean> {
  if (activeWorkIds.length === 0) return false;
  const p = await prisma.userProgress.findFirst({
    where:  { lineUserId: userId, workId: { in: activeWorkIds } },
    select: { id: true },
  });
  return p !== null;
}

/**
 * postback の作品を payload 由来で解決する（直近 progress ではなく payload 優先）。
 * 優先: data.workId（resume_work 含む） → sourceMessageId/messageId → phaseId。
 * 解決した workId は必ず activeWorkIds（＝この OA の公開中作品）に含まれること（他 OA の id は拒否）。
 * 解決できない（rich menu 等 workId/messageId/phaseId 無し）→ null（複数公開時は呼び出し側でスキップ）。
 */
async function resolvePostbackWorkId(data: string, activeWorkIds: Set<string>): Promise<string | null> {
  let params: URLSearchParams;
  try { params = new URLSearchParams(data); } catch { return null; }

  // 1. data.workId（resume_work / 汎用）
  const directWid = params.get("workId");
  if (directWid) return activeWorkIds.has(directWid) ? directWid : null; // 他OA/非公開は拒否

  // 2. messageId 由来（quick_reply.sourceMessageId / puzzle_hint.messageId / hint_back_to_puzzle.messageId）
  const qr = parseQuickReplyPostback(data);
  const ph = qr ? null : parsePuzzleHintPostback(data);
  const bp = qr || ph ? null : parseBackToPuzzlePostback(data);
  const msgId = qr?.sourceMessageId ?? ph?.messageId ?? bp?.messageId ?? null;
  if (msgId) {
    const m = await prisma.message.findFirst({ where: { id: msgId, isActive: true }, select: { workId: true } });
    return m && activeWorkIds.has(m.workId) ? m.workId : null; // 他OAの messageId は拒否
  }

  // 3. phaseId 由来
  const phaseId = params.get("phaseId");
  if (phaseId) {
    const p = await prisma.phase.findFirst({ where: { id: phaseId }, select: { workId: true } });
    return p && activeWorkIds.has(p.workId) ? p.workId : null;
  }

  return null;
}

/** フェーズ（messages + transitionsFrom）をキャッシュ付きで取得。TTL 内は DB クエリをスキップ */
async function getCachedPhase(phaseId: string): Promise<PhaseRow | null> {
  const key = CACHE_KEY.phase(phaseId);
  const hit = await activeCache.get<PhaseRow>(key);
  if (hit) return hit;
  console.log(`[cache] phase MISS phaseId=${phaseId.slice(0, 8)}`);
  const phase = await fetchPhaseWithIncludes(phaseId);
  if (phase) await activeCache.set(key, phase, TTL.PHASE);
  return phase ?? null;
}

/** グローバルコマンド一覧をキャッシュ付きで取得 */
async function getCachedGlobalCmds(oaId: string): Promise<GlobalCommandRecord[]> {
  const key = CACHE_KEY.globalCmd(oaId);
  const hit = await activeCache.get<GlobalCommandRecord[]>(key);
  if (hit) return hit;
  console.log(`[cache] globalCmd MISS oaId=${oaId.slice(0, 8)}`);
  const cmds = await prisma.globalCommand.findMany({
    where:   { oaId, isActive: true },
    select:  { id: true, keyword: true, actionType: true, payload: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  await activeCache.set(key, cmds, TTL.GLOBAL_CMD);
  return cmds;
}

type StartPhaseRow = { id: string; phaseType: string; startTrigger: string | null; resumeSummary: string | null };

/** start フェーズ（id / phaseType / startTrigger / resumeSummary）をキャッシュ付きで取得 */
async function getCachedStartPhase(workId: string): Promise<StartPhaseRow | null> {
  const key = CACHE_KEY.startPhase(workId);
  const hit = await activeCache.get<StartPhaseRow>(key);
  if (hit) return hit;
  console.log(`[cache] startPhase MISS workId=${workId.slice(0, 8)}`);
  const phase = await prisma.phase.findFirst({
    where:   { workId, phaseType: "start", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select:  { id: true, phaseType: true, startTrigger: true, resumeSummary: true },
  });
  if (phase) await activeCache.set(key, phase, TTL.START_PHASE);
  return phase;
}

type CharacterRow = { name: string; iconImageUrl: string | null };

/** キャラクター情報をキャッシュ付きで取得（ヒント話者解決用）。TTL = 5分 */
async function getCachedCharacter(characterId: string): Promise<CharacterRow | null> {
  const key = `character:${characterId}`;
  const hit = await activeCache.get<CharacterRow>(key);
  if (hit) return hit;
  const character = await prisma.character.findUnique({
    where:  { id: characterId },
    select: { name: true, iconImageUrl: true },
  });
  if (character) await activeCache.set(key, character, 5 * 60 * 1000);
  return character ?? null;
}

/** キャラクター情報から LineSender を構築する */
function buildSenderFromCharacter(
  character: CharacterRow,
): import("@/lib/line").LineSender {
  return {
    name: character.name.slice(0, 20),
    ...(character.iconImageUrl?.startsWith("https://")
      ? { iconUrl: character.iconImageUrl }
      : {}),
  };
}

/**
 * パズルの正解 / 不正解メッセージの発話キャラクターを解決する。
 * 優先順: primaryId（正解/不正解メッセージ専用キャラ）→ fallbackId（問題本文キャラ）→ systemSender。
 * いずれの id も未設定 / キャラ不在なら systemSender（= 既存デフォルト挙動）にフォールバックする。
 */
async function resolvePuzzleSender(
  primaryId:    string | null | undefined,
  fallbackId:   string | null | undefined,
  systemSender: import("@/lib/line").LineSender | undefined,
): Promise<import("@/lib/line").LineSender | undefined> {
  for (const id of [primaryId, fallbackId]) {
    if (!id) continue;
    const ch = await getCachedCharacter(id);
    if (ch) return buildSenderFromCharacter(ch);
  }
  return systemSender;
}

/** 作品共通キーワードメッセージ（phaseId = null）をキャッシュ付きで取得 */
async function getCachedGlobalKeywords(
  workId: string,
): Promise<(KeywordMessageRecord & { triggerKeyword: string })[]> {
  const key = CACHE_KEY.globalKw(workId);
  const hit = await activeCache.get<(KeywordMessageRecord & { triggerKeyword: string })[]>(key);
  if (hit) return hit;
  console.log(`[cache] globalKw MISS workId=${workId.slice(0, 8)}`);
  const msgs = await prisma.message.findMany({
    where: {
      workId,
      isActive:       true,
      OR: [
        { phaseId: null },
        { phase: { phaseType: "global" } },
      ],
      triggerKeyword: { not: null },
      kind:           { notIn: ["start", "puzzle", "system_notice"] },
    },
    select: {
      id:              true,
      messageType:     true,
      body:            true,
      assetUrl:        true,
      altText:         true,
      flexPayloadJson: true,
      quickReplies:    true,
      nextMessageId:   true,
      sortOrder:       true,
      triggerKeyword:  true,
      imageActionType: true, imageActionText: true, imageActionUrl: true,
      imageActionLiffPageId: true, imageActionPostbackData: true,
      // 自由入力受付フラグ (buildMessageChain の chain walk 停止判定に必要)
      freeInputEnabled: true,
      // 演出設定 (Phase 2c)
      lagMs: true,
      readReceiptMode: true, readDelayMs: true,
      typingEnabled: true, typingMinMs: true, typingMaxMs: true,
      loadingEnabled: true, loadingThresholdMs: true,
      loadingMinSeconds: true, loadingMaxSeconds: true,
      character: {
        select: { name: true, iconImageUrl: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const result = msgs
    .filter((m): m is typeof m & { triggerKeyword: string } => m.triggerKeyword !== null)
    .map((m) => ({
      ...m,
      timing: buildKeywordTiming(m),
    }));
  await activeCache.set(key, result, TTL.GLOBAL_KW);
  return result;
}

/** getCachedStartMsgs / 継続メッセージ取得で共有する select。
 *  KeywordMessageRecord への変換 + buildKeywordTiming に必要な列を含む。 */
const START_MSG_SELECT = {
  id:              true,
  triggerKeyword:  true,
  messageType:     true,
  body:            true,
  assetUrl:        true,
  assetPreviewUrl: true,
  assetUsage:      true,
  altText:         true,
  flexPayloadJson: true,
  quickReplies:    true,
  // 問題のヒント QR 合成用（start chain 内に puzzle が来てもヒントを付ける）
  kind: true, hintMode: true, incorrectQuickReplies: true,
  nextMessageId:   true,
  sortOrder:       true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  // 自由入力受付フラグ (chain walk 停止判定に必要)
  freeInputEnabled: true,
  // 演出設定 (Phase 2c)
  lagMs: true,
  readReceiptMode: true, readDelayMs: true,
  typingEnabled: true, typingMinMs: true, typingMaxMs: true,
  loadingEnabled: true, loadingThresholdMs: true,
  loadingMinSeconds: true, loadingMaxSeconds: true,
  character: {
    select: { name: true, iconImageUrl: true },
  },
} as const;

/** id 指定で 1 メッセージを KeywordMessageRecord 形式で取得（連続送信の継続メッセージ取得用）。 */
async function fetchStartChainMessage(workId: string, id: string): Promise<KeywordMessageRecord | null> {
  const m = await prisma.message.findFirst({
    where:  { id, workId, isActive: true },
    select: START_MSG_SELECT,
  });
  return m ? { ...m, timing: buildKeywordTiming(m) } : null;
}

/** startPhase に紐づく kind="start" メッセージ + その nextMessageId 連鎖(継続メッセージ)を
 *  キャッシュ付きで取得する。
 *  継続メッセージ(kind != "start")も含めることで、開始メッセージが連続送信(2通以上)の場合に
 *  2通目以降も送信対象になる(= buildKeywordMessages は chain walk しないため、ここで展開しておく。
 *  buildPhaseMessages を使う handleStart 経路と挙動を揃える)。 */
async function getCachedStartMsgs(
  workId:  string,
  phaseId: string,
): Promise<KeywordMessageRecord[]> {
  const key = CACHE_KEY.startMsgs(phaseId);
  const hit = await activeCache.get<KeywordMessageRecord[]>(key);
  if (hit) return hit;
  console.log(`[cache] startMsgs MISS phaseId=${phaseId.slice(0, 8)}`);
  const msgs = await prisma.message.findMany({
    where: {
      workId,
      phaseId,
      kind:     "start",
      isActive: true,
    },
    select: START_MSG_SELECT,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const heads: KeywordMessageRecord[] = msgs.map((m) => ({
    ...m,
    timing: buildKeywordTiming(m),
  }));
  // kind="start" head の nextMessageId 連鎖(継続メッセージ)も送信対象に含める。
  const result = await expandKeywordChain(heads, (id) => fetchStartChainMessage(workId, id));
  await activeCache.set(key, result, TTL.START_MSGS);
  return result;
}

/**
 * beacon の action_type="message": messageId から DB Message chain を読み、
 * 既存のメッセージ送信パイプライン（buildKeywordMessages = lag/typing/loading/quickReply/chain 尊重）で
 * LineMessage[] を構築する。head が無い/非アクティブなら null。
 */
const BEACON_MSG_SELECT = {
  id: true, messageType: true, body: true, assetUrl: true, altText: true, flexPayloadJson: true,
  assetPreviewUrl: true, assetUsage: true,
  quickReplies: true, nextMessageId: true, sortOrder: true,
  // 問題のヒント QR 合成用（beacon target chain 内の puzzle 対応）
  kind: true, hintMode: true, incorrectQuickReplies: true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  freeInputEnabled: true,
  lagMs: true, readReceiptMode: true, readDelayMs: true,
  typingEnabled: true, typingMinMs: true, typingMaxMs: true,
  loadingEnabled: true, loadingThresholdMs: true, loadingMinSeconds: true, loadingMaxSeconds: true,
  character: { select: { name: true, iconImageUrl: true } },
} as const;

async function loadBeaconMessageChain(messageId: string, accountName: string): Promise<LineMessage[] | null> {
  const head = await prisma.message.findFirst({ where: { id: messageId, isActive: true }, select: BEACON_MSG_SELECT });
  if (!head) return null;
  const rows: (typeof head)[] = [head];
  const visited = new Set<string>([head.id]);
  let cur = head;
  while (rows.length < 5 && cur.nextMessageId && !cur.freeInputEnabled) {
    if (visited.has(cur.nextMessageId)) break;
    const next = await prisma.message.findFirst({ where: { id: cur.nextMessageId, isActive: true }, select: BEACON_MSG_SELECT });
    if (!next) break;
    visited.add(next.id);
    rows.push(next);
    if (next.freeInputEnabled) break;
    cur = next;
  }
  const records: KeywordMessageRecord[] = rows.map((m) => ({ ...m, timing: buildKeywordTiming(m) }));
  const msgs = buildKeywordMessages(records, undefined, { accountName });
  return msgs.length > 0 ? msgs : null;
}

// ── userProgress キャッシュ（TTL 10秒 / write-through）──────────────────
//
//  LINE の 1 ユーザー逐次配送モデルに基づき、短 TTL でキャッシュする。
//  全 upsert / update の直後に setCachedProgress() を呼んでキャッシュを更新する。
//  これにより read-after-write の整合性を保証する。

/**
 * userProgress をキャッシュ付きで取得する。
 * キャッシュ MISS 時は DB から全フィールドを取得してキャッシュに保存する。
 */
type ProgressCached = NonNullable<Awaited<ReturnType<typeof prisma.userProgress.findUnique>>>;

async function getCachedProgress(
  userId: string,
  workId: string,
): Promise<ProgressCached | null> {
  const key = CACHE_KEY.progress(userId, workId);
  const hit = await activeCache.get<ProgressCached>(key);
  if (hit) return hit;
  console.log(`[cache] progress MISS userId=${userId.slice(0, 8)} workId=${workId.slice(0, 8)}`);
  const r = await prisma.userProgress.findUnique({
    where: { lineUserId_workId: { lineUserId: userId, workId } },
  });
  if (r) await activeCache.set(key, r, TTL.PROGRESS);
  return r ?? null;
}

/**
 * userProgress キャッシュを上書きする（upsert / update 直後に呼ぶ）。
 * write-through によって次の read が必ず最新値を返せるようにする。
 */
async function setCachedProgress(progress: ProgressCached): Promise<void> {
  const key = CACHE_KEY.progress(progress.lineUserId, progress.workId);
  await activeCache.set(key, progress, TTL.PROGRESS);
}

/** キャッシュ済みグローバルコマンドとユーザー入力をインメモリで照合する */
function matchGlobalCmdInMemory(
  cmds:      GlobalCommandRecord[],
  inputText: string,
): GlobalCommandRecord | null {
  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);
  for (const cmd of cmds) {
    const kwNorm  = normKw(cmd.keyword);
    const kwLoose = normKwLoose(cmd.keyword);
    if (inputNorm === kwNorm || inputLoose === kwLoose) return cmd;
  }
  return null;
}

/** キャッシュ済みフェーズデータからヒント quickReply をインメモリで照合する */
function matchHintFromPhase(
  phase:     PhaseRow,
  inputText: string,
  logCtx?:   { oaId: string; workId: string },
): { hintText: string; hintFollowup?: string; qrItems: import("@/types").QuickReplyItem[]; matchedItem: import("@/types").QuickReplyItem; messageId: string } | null {
  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);

  // WARN 用の同名候補数（純ロジック・既存走査順と一致 = 下のループの先頭一致と整合）。返却/既存ログは
  // 下のループが担うため挙動・診断ログは不変。ここでは candidateCount / candidateMessageIds のみ算出する。
  const fallbackMatches = collectLegacyHintMatches(phase.messages, inputText, { strict: normKw, loose: normKwLoose });

  // 診断: フェーズ内の hint QR 候補をログ出力
  let hintCandidateCount = 0;
  for (const msg of phase.messages) {
    // hint_mode=hidden のメッセージはヒント照合をスキップ
    if ((msg as { hintMode?: string }).hintMode === "hidden") continue;
    // 候補 = quick_replies の hint アイテム ＋（問題なら）incorrect_quick_replies のヒント。
    // incorrect 側は display（resolveDisplayQrItems）と同じ normalizeHintQrItems でラベルを揃え、
    // タップ送信テキスト（label）と確実に一致させる。
    const items: import("@/types").QuickReplyItem[] = [];
    if (msg.quickReplies) {
      try {
        const parsed = JSON.parse(msg.quickReplies);
        if (Array.isArray(parsed)) items.push(...(parsed as import("@/types").QuickReplyItem[]));
      } catch { /* skip */ }
    }
    if (msg.kind === "puzzle") {
      const rawIncorrect = (msg as { incorrectQuickReplies?: string | null }).incorrectQuickReplies;
      if (rawIncorrect) {
        try {
          const parsed = JSON.parse(rawIncorrect);
          if (Array.isArray(parsed)) items.push(...normalizeHintQrItems(parsed as import("@/types").QuickReplyItem[]));
        } catch { /* skip */ }
      }
    }
    if (items.length === 0) continue;
    for (const item of items) {
      if (item.action !== "hint") continue;
      if (item.enabled === false) continue;
      hintCandidateCount++;
      // value と label の両方を照合キーとして試みる（LINE では label がそのまま送信される）
      const keys = [item.value?.trim(), item.label].filter(Boolean) as string[];
      const matched = keys.some(
        (k) => normKw(k) === inputNorm || normKwLoose(k) === inputLoose,
      );
      if (matched) {
        const hintText     = item.hint_text?.trim() || "ヒントはまだ設定されていません。";
        const hintFollowup = item.hint_followup?.trim() || undefined;
        console.log(
          `[cache][hint] マッチ msgId=${msg.id.slice(0, 8)}`,
          `key="${item.value ?? item.label}" hint_text="${hintText.slice(0, 30)}..."`,
        );
        // 観測ログ（挙動変更なし）: postback ではなくラベル一致 fallback で解決した事実。
        const label = item.value?.trim() || item.label;
        console.warn("[webhook] legacy hint fallback used", {
          oaId:             logCtx?.oaId ?? null,
          workId:           logCtx?.workId ?? null,
          phaseId:          phase.id,
          label,
          matchedMessageId: msg.id.slice(0, 8),
          reason:           "missing_postback_payload",
        });
        // 同一スコープ内に同名候補が複数（先頭一致では識別できない旧仕様の曖昧性）。
        if (fallbackMatches.length >= 2) {
          console.warn("[webhook] legacy hint fallback ambiguous", {
            oaId:                logCtx?.oaId ?? null,
            workId:              logCtx?.workId ?? null,
            phaseId:             phase.id,
            label,
            candidateCount:      fallbackMatches.length,
            candidateMessageIds: fallbackMatches.map((m) => m.messageId.slice(0, 8)),
            reason:              "multiple_same_label_hint_in_scope",
          });
        }
        return { hintText, hintFollowup, qrItems: items, matchedItem: item, messageId: msg.id };
      } else {
        console.log(
          `[cache][hint] 不一致 msgId=${msg.id.slice(0, 8)} kind=${msg.kind}`,
          `input="${inputNorm}" keys=${JSON.stringify(keys)}`,
        );
      }
    }
  }
  if (hintCandidateCount === 0) {
    console.log(
      `[cache][hint] 候補なし phaseId=${phase.id.slice(0, 8)}`,
      `messages=${phase.messages.length}件`,
      `qrMessages=${phase.messages.filter((m) => m.quickReplies).length}件`,
      phase.messages.map((m) => `id=${m.id.slice(0, 8)} kind=${m.kind} qr=${m.quickReplies ? "あり" : "なし"} hintMode=${(m as { hintMode?: string }).hintMode ?? "always"}`).join(" / "),
    );
  }
  return null;
}

/**
 * 画像タップ「メッセージを送信する＋フェーズ遷移」(image_action_type="message_with_phase") を
 * 現在フェーズ内の画像メッセージから image_action_text 一致でインメモリ照合する。
 *
 * - 対象は現在フェーズ文脈の messageType="image" のみ（作品外/他フェーズの画像には反応しない）。
 * - image_action_text 一致 かつ image_action_phase_id 設定済み のときだけ遷移先を返す。
 * - 手入力で同一テキストを送った場合も一致しうる（仕様: 制作者向け UI 補足で注意喚起）。
 * - 照合は hint/QR の後・通常キーワード/謎/transition の前に呼ぶ（画像タップは明示 UI アクション扱い）。
 */
function matchImageMessagePhaseTransition(
  phase:     PhaseRow,
  inputText: string,
): { targetPhaseId: string; messageId: string; actionText: string } | null {
  const r = matchImageActionPhaseTransition(
    phase.messages as unknown as import("@/lib/image-action-phase").ImagePhaseCandidate[],
    inputText,
    { strict: normKw, loose: normKwLoose },
  );
  if (r) console.log(`[cache][imgPhase] マッチ msgId=${r.messageId.slice(0, 8)} text="${r.actionText.slice(0, 30)}" → phase=${r.targetPhaseId.slice(0, 8)}`);
  return r;
}

/**
 * キャッシュ済みフェーズデータから QR アイテムをインメモリで照合する（統合版）。
 *
 * ヒント以外の QR アイテムのうち、以下のいずれかが設定されているものだけを対象とする:
 *   - response_message_id : Step2 で返す応答メッセージ
 *   - target_message_id   : Step3 で送る遷移先メッセージ
 *   - target_phase_id     : Step3 で遷移する遷移先フェーズ
 *
 * 上記のいずれも設定されていない QR（単純なラベル送信）は通常のキーワード照合に委ねる。
 */
function matchQrItem(
  phase:     PhaseRow,
  inputText: string,
  frontier:  Set<string> | null = null,
  logCtx?:   { oaId: string; workId: string; userId: string },
): import("@/types").QuickReplyItem | null {
  // frontier（直近送信 chain の messageId 群）が有れば、その範囲の QR だけを照合する。
  // null（レガシー progress）なら従来どおりフェーズ全体を走査（後方互換）。
  const { scoped, mode } = selectQrScope(phase.messages, frontier);
  console.info("[line:qr:scope]", JSON.stringify({
    oaId:               logCtx?.oaId ?? null,
    workId:             logCtx?.workId ?? null,
    userIdPrefix:       logCtx?.userId ? logCtx.userId.slice(0, 8) : null,
    mode,
    frontierMessageIds: frontier ? [...frontier] : null,
    candidateCount:     scoped.length,
  }));

  // 候補収集は純ロジックに委譲（走査順は既存と同一 = 先頭が既存 return と一致・挙動不変）。
  const matches = collectLegacyQrMatches(scoped, inputText, { strict: normKw, loose: normKwLoose });
  if (matches.length === 0) return null;
  const first = matches[0];
  console.log(
    `[cache][qrItem] マッチ msgId=${first.messageId.slice(0, 8)}`,
    `key="${first.matchKey}"`,
    `response_message_id=${first.item.response_message_id?.slice(0, 8) ?? "none"}`,
    `target_type=${first.item.target_type ?? "none"}`,
    `target_message_id=${first.item.target_message_id?.slice(0, 8) ?? "none"}`,
    `target_phase_id=${first.item.target_phase_id?.slice(0, 8) ?? "none"}`,
  );
  // 観測ログ（挙動変更なし）: postback ではなくラベル一致 fallback で解決した事実。
  console.warn("[webhook] legacy QR fallback used", {
    oaId:             logCtx?.oaId ?? null,
    workId:           logCtx?.workId ?? null,
    phaseId:          phase.id,
    label:            first.matchKey,
    matchedMessageId: first.messageId.slice(0, 8),
    reason:           "missing_postback_payload",
  });
  // 同一スコープ内に同名候補が複数（先頭一致では識別できない旧仕様の曖昧性）。
  if (matches.length >= 2) {
    console.warn("[webhook] legacy QR fallback ambiguous", {
      oaId:                logCtx?.oaId ?? null,
      workId:              logCtx?.workId ?? null,
      phaseId:             phase.id,
      label:               first.matchKey,
      candidateCount:      matches.length,
      candidateMessageIds: matches.map((m) => m.messageId.slice(0, 8)),
      reason:              "multiple_same_label_qr_in_scope",
    });
  }
  return first.item;
}

/**
 * KeywordMessageRecord または単一メッセージ行を LINE メッセージ配列に変換し、
 * nextMessageId チェーンを DB から辿って追加する（再帰上限 5 件）。
 */
async function buildMessageChain(
  first: {
    id: string; messageType: string; body: string | null; assetUrl: string | null;
    altText: string | null; flexPayloadJson: string | null;
    quickReplies: string | null; nextMessageId: string | null; sortOrder: number;
    // 問題（puzzle）のヒント QR 合成用（buildKeywordMessages → resolveDisplayQrItems で使用）。
    kind?:                    string | null;
    hintMode?:                string | null;
    incorrectQuickReplies?:   string | null;
    imageActionType?:         string | null;
    imageActionText?:         string | null;
    imageActionUrl?:          string | null;
    imageActionLiffPageId?:   string | null;
    imageActionPostbackData?: string | null;
    // ── 演出設定（Phase 2c で chain 2 通目以降にも反映する） ──
    lagMs?:                number | null;
    readReceiptMode?:      string | null;
    readDelayMs?:          number | null;
    typingEnabled?:        boolean | null;
    typingMinMs?:          number | null;
    typingMaxMs?:          number | null;
    loadingEnabled?:       boolean | null;
    loadingThresholdMs?:   number | null;
    loadingMinSeconds?:    number | null;
    loadingMaxSeconds?:    number | null;
    /** 自由入力受付モード。true の message は「ここで一旦停止して
     *  waitingForInput をセットする」セマンティクスを持つため、chain walk は
     *  この message を含めた地点で停止する (= 通常 nextMessageId による
     *  自動連続送信の対象外。応答メッセージは free_input_next_message_id で
     *  別経路として送られる)。caller が select に含めていない場合は undefined
     *  扱いで stop しない（後方互換）。 */
    freeInputEnabled?:     boolean | null;
    /** Phase 2c hotfix v4: 既に集約済みの timing (= matchKeywordsInMemory が前段で計算)
     *  を引き取れるようにする。raw columns が削られた `match` から来る経路で
     *  buildKeywordTiming(r) が null を返してしまい head の timing が落ちる問題への対処。
     *  raw columns と timing 両方ある場合は timing を優先する。 */
    timing?:               import("@/types").MessageTimingConfig | null;
    character: { name: string; iconImageUrl: string | null } | null;
  },
  vars: import("@/lib/line").PlaceholderVars = {},
): Promise<{ messages: import("@/lib/line").LineMessage[]; chainIds: string[] }> {
  const records: (typeof first & { freeInputEnabled?: boolean | null })[] = [first];

  // 自由入力受付メッセージは「そこで一旦停止して waitingForInput をセットする」
  // セマンティクスを持つため、`first` が freeInputEnabled=true ならその時点で chain walk しない。
  // データ上 next_message_id が設定されていても、それは誤って付与された chain link (= 本来は
  // free_input_next_message_id に入れるべき遷移先) の可能性が高いので、warn log で可視化する。
  if (isFreeInputPrompt(first)) {
    if (first.nextMessageId) {
      console.warn(
        `[diag][chain] STOP at first — freeInputEnabled=true headId=${first.id.slice(0, 8)} ` +
        `nextMessageId=${first.nextMessageId.slice(0, 8)} sort=${first.sortOrder} ` +
        `type=${first.messageType} body="${(first.body ?? "").slice(0, 30)}" ` +
        `(data possibly miswired: 自由入力プロンプトに next_message_id が設定されている。` +
        `応答メッセージは free_input_next_message_id で送るのが正しい仕様)`,
      );
    } else {
      console.log(
        `[diag][chain] STOP at first — freeInputEnabled=true headId=${first.id.slice(0, 8)} ` +
        `sort=${first.sortOrder} type=${first.messageType} body="${(first.body ?? "").slice(0, 30)}" ` +
        `(chain walk skipped, awaiting user input)`,
      );
    }
  } else {
    // チェーンを最大 4 件追加（合計 5 件 = LINE 返信上限）
    // 循環参照を visited Set で防止する。loop cap (i<4) だけでは saved DB の chain link が
    // A→B→A のような cycle になっている場合に [A, B, A, B, A] のような重複展開が起きるため、
    // 明示的に既に積んだ id を skip する (= 重複の原因経路を断つ)。
    const visited = new Set<string>([first.id]);
    let current: typeof first & { freeInputEnabled?: boolean | null } = first;
    for (let i = 0; i < 4 && current.nextMessageId; i++) {
      if (visited.has(current.nextMessageId)) {
        console.warn(`[diag][chain] CYCLE — nextMessageId=${current.nextMessageId.slice(0, 8)} already visited (step=${i}). stop expansion.`);
        break;
      }
      const next = await prisma.message.findUnique({
        where: { id: current.nextMessageId, isActive: true },
        select: {
          id: true, messageType: true, body: true, assetUrl: true,
          assetPreviewUrl: true, assetUsage: true,
          altText: true, flexPayloadJson: true, quickReplies: true,
          nextMessageId: true, sortOrder: true,
          // 問題のヒント QR 合成用（chain 内に puzzle が来てもヒントを付ける）
          kind: true, hintMode: true, incorrectQuickReplies: true,
          imageActionType: true, imageActionText: true, imageActionUrl: true,
          imageActionLiffPageId: true, imageActionPostbackData: true,
          // 演出設定 (Phase 2c)
          lagMs: true,
          readReceiptMode: true, readDelayMs: true,
          typingEnabled: true, typingMinMs: true, typingMaxMs: true,
          loadingEnabled: true, loadingThresholdMs: true,
          loadingMinSeconds: true, loadingMaxSeconds: true,
          // 自由入力受付フラグ — true なら chain walk を停止する
          freeInputEnabled: true,
          character: { select: { name: true, iconImageUrl: true } },
        },
      });
      if (!next) {
        console.warn(`[diag][chain] BREAK — nextMessageId=${current.nextMessageId.slice(0, 8)} not found in DB or isActive=false (step=${i})`);
        break;
      }
      visited.add(next.id);
      records.push(next);
      // 自由入力受付メッセージに到達したら、この message を含めて chain walk を停止する。
      // この message の応答は free_input_next_message_id で別経路として送られる
      // (= waitingForInput をセットした上で、ユーザーの次入力でその message を送る仕様)。
      if (isFreeInputPrompt(next)) {
        if (next.nextMessageId) {
          console.warn(
            `[diag][chain] STOP at step=${i} — freeInputEnabled=true id=${next.id.slice(0, 8)} ` +
            `nextMessageId=${next.nextMessageId.slice(0, 8)} (data possibly miswired: ` +
            `自由入力プロンプトに next_message_id が設定されている。応答メッセージは ` +
            `free_input_next_message_id で送るのが正しい仕様)`,
          );
        } else {
          console.log(`[diag][chain] STOP at step=${i} — freeInputEnabled=true id=${next.id.slice(0, 8)} (awaiting user input)`);
        }
        break;
      }
      current = next;
    }
  }
  // KeywordMessageRecord 互換形式に変換（nextMessageId なし・triggerKeyword なし）
  // Phase 2c hotfix v4: r.timing が既に集約されていれば優先する (= matchKeywordsInMemory 経由)。
  // raw columns しか無い場合は buildKeywordTiming(r) で再計算 (= 再帰 findUnique 経由)。
  const asKeywordRecords: import("@/lib/line").KeywordMessageRecord[] = records.map((r) => ({
    id:              r.id,
    messageType:     r.messageType,
    body:            r.body,
    assetUrl:        r.assetUrl,
    assetPreviewUrl: (r as { assetPreviewUrl?: string | null }).assetPreviewUrl ?? null,
    assetUsage:      (r as { assetUsage?: string | null }).assetUsage ?? null,
    altText:         r.altText,
    flexPayloadJson: r.flexPayloadJson,
    quickReplies:    r.quickReplies,
    // 問題のヒント QR 合成用（buildKeywordMessages → resolveDisplayQrItems）。
    kind:                  (r as { kind?: string | null }).kind ?? null,
    hintMode:              (r as { hintMode?: string | null }).hintMode ?? null,
    incorrectQuickReplies: (r as { incorrectQuickReplies?: string | null }).incorrectQuickReplies ?? null,
    nextMessageId:   r.nextMessageId,
    sortOrder:       r.sortOrder,
    imageActionType:         r.imageActionType         ?? null,
    imageActionText:         r.imageActionText         ?? null,
    imageActionUrl:          r.imageActionUrl          ?? null,
    imageActionLiffPageId:   r.imageActionLiffPageId   ?? null,
    imageActionPostbackData: r.imageActionPostbackData ?? null,
    lagMs:           r.lagMs ?? null,
    // (r as { timing?: ... }).timing は records[0] (= first) のみ存在しうる。
    // 再帰 findUnique の next は raw columns のみで timing キーがない。
    timing:          (r as { timing?: import("@/types").MessageTimingConfig | null }).timing
                      ?? buildKeywordTiming(r),
    character:       r.character,
  }));
  // nextMessageId 連鎖の展開順を構造化ログに出す（管理画面表示順とのズレ調査用・PII なし）。
  console.info("[line:chain:expanded]", JSON.stringify({
    rootMessageId: records[0]?.id ?? null,
    messageIds:    records.map((r) => r.id),
    sortOrders:    records.map((r) => r.sortOrder ?? null),
    nextMessageIds: records.map((r) => r.nextMessageId ?? null),
  }));
  return {
    messages: buildKeywordMessages(asKeywordRecords, undefined, vars),
    chainIds: records.map((r) => r.id),
  };
}

/** ヒント「問題に戻る」で問題を再表示する際の message select（buildMessageChain 互換）。 */
const BACK_TO_PUZZLE_MSG_SELECT = {
  id: true, messageType: true, body: true, assetUrl: true,
  assetPreviewUrl: true, assetUsage: true,
  altText: true, flexPayloadJson: true, quickReplies: true,
  nextMessageId: true, sortOrder: true,
  kind: true, hintMode: true, incorrectQuickReplies: true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  lagMs: true,
  readReceiptMode: true, readDelayMs: true,
  typingEnabled: true, typingMinMs: true, typingMaxMs: true,
  loadingEnabled: true, loadingThresholdMs: true,
  loadingMinSeconds: true, loadingMaxSeconds: true,
  freeInputEnabled: true,
  character: { select: { name: true, iconImageUrl: true } },
} as const;

/**
 * 指定 messageId の問題を「通常出題と同じ buildMessageChain 経路」で再表示する（reply のみ）。
 * postback「問題に戻る」と message action フォールバックの共通処理。workId スコープで安全に取得。
 * 不正解・回数加算・履歴・遷移・push は一切行わない。再構築できなければ false。
 */
async function reshowPuzzleById(args: {
  messageId:          string;
  workId:             string;
  replyToken:         string;
  userId:             string;
  channelAccessToken: string;
  vars:               import("@/lib/line").PlaceholderVars;
}): Promise<boolean> {
  const puzzleRow = await prisma.message.findFirst({
    where:  { id: args.messageId, workId: args.workId, isActive: true },
    select: BACK_TO_PUZZLE_MSG_SELECT,
  });
  if (!puzzleRow) return false;
  // 対象が問題メッセージ (kind="puzzle") でなければ再表示しない（細工された messageId 等で
  // 別種メッセージを再表示させない安全ガード。スコープは workId + isActive で既に限定済み）。
  if (puzzleRow.kind !== "puzzle") {
    console.warn(`[Webhook] reshowPuzzleById: 対象が問題メッセージでない (kind=${puzzleRow.kind}) msgId=${args.messageId.slice(0, 8)} → スキップ`);
    return false;
  }
  const { messages: chain } = await buildMessageChain(puzzleRow, args.vars);
  if (chain.length === 0) return false;
  await replyWithLagToLine(args.replyToken, chain, args.userId, args.channelAccessToken);
  return true;
}

// ── ヒント返答メッセージの組み立て（legacy text 経路と postback 経路で共用）──
//   解決済みのヒント並び（displayHints = resolveHintItems 順）と matchedIndex から、
//   ヒント本文 + フォローアップ + 導線 QR（「さらにヒント」=次ヒントへの postback / 「問題に戻る」postback）を作る。
//   「さらにヒント」も postback 化（messageId + 次ヒント index）＝ラベル非依存で正しく次ヒントへ解決する。
//   進行順は既存どおり hint_level でソートして決め、postback の index は表示順（displayHints）へ写像する。
function composeHintMessages(args: {
  sourceMessageId: string;
  displayHints:    import("@/types").QuickReplyItem[];
  matchedIndex:    number;
  sender:          import("@/lib/line").LineSender | undefined;
}): import("@/lib/line").LineMessage[] {
  const matched = args.displayHints[args.matchedIndex];
  const hintText     = (matched as { hint_text?: string }).hint_text?.trim() || "ヒントはまだ設定されていません。";
  const hintFollowup = (matched as { hint_followup?: string }).hint_followup?.trim() || undefined;
  const msgs: import("@/lib/line").LineMessage[] = [
    { type: "text", text: hintText, sender: args.sender },
    ...(hintFollowup
      ? [{ type: "text", text: hintFollowup, sender: args.sender } as import("@/lib/line").LineMessage]
      : []),
  ];

  // 「さらにヒント」= hint_level 進行順の次ヒント（既存挙動）→ その表示 index へ postback。
  const levelSorted = [...args.displayHints].sort(
    (a, b) => ((a as { hint_level?: number }).hint_level ?? 999) - ((b as { hint_level?: number }).hint_level ?? 999),
  );
  const curLvlIdx = levelSorted.indexOf(matched);
  const nextItem  = curLvlIdx >= 0 && curLvlIdx + 1 < levelSorted.length ? levelSorted[curLvlIdx + 1] : null;

  const nav: import("@/lib/line").LineQuickReplyItem[] = [];
  if (nextItem) {
    const nextDisplayIdx = args.displayHints.indexOf(nextItem);
    if (nextDisplayIdx >= 0) {
      const nextLabel = (matched as { hint_next_label?: string }).hint_next_label?.trim() || "さらにヒント";
      nav.push({
        type: "action",
        action: { type: "postback", label: nextLabel.slice(0, 20), data: buildPuzzleHintPostbackData(args.sourceMessageId, nextDisplayIdx), displayText: nextLabel },
      });
    }
  }
  const cancelLabel = (matched as { hint_cancel_label?: string }).hint_cancel_label?.trim() || "問題に戻る";
  nav.push({
    type: "action",
    action: { type: "postback", label: cancelLabel.slice(0, 20), data: buildBackToPuzzlePostbackData(args.sourceMessageId), displayText: cancelLabel },
  });
  if (nav.length > 0) {
    (msgs[msgs.length - 1] as import("@/lib/line").LineTextMessage).quickReply = { items: nav };
  }
  return msgs;
}

/** 問題ヒント postback（puzzle_hint）: messageId + hintIndex から該当問題のヒントを reply のみで返す。
 *  ラベル非依存・work スコープ・kind="puzzle" のみ。範囲外/非問題/再構築不可は false（呼び出し側は無視）。 */
async function sendPuzzleHintById(args: {
  messageId:          string;
  hintIndex:          number;
  workId:             string;
  replyToken:         string;
  userId:             string;
  channelAccessToken: string;
  systemSender:       import("@/lib/line").LineSender | undefined;
}): Promise<boolean> {
  const row = await prisma.message.findFirst({
    where:  { id: args.messageId, workId: args.workId, isActive: true },
    select: { id: true, kind: true, hintMode: true, quickReplies: true, incorrectQuickReplies: true },
  });
  if (!row || row.kind !== "puzzle") return false;
  const displayHints = resolveHintItems(row);
  const matched = displayHints[args.hintIndex];
  if (!matched) return false; // 範囲外 hintIndex は安全に無視

  // ヒント話者: hint_character_id があればそのキャラ、なければ systemSender。
  let sender = args.systemSender;
  const hintCharId = (matched as { hint_character_id?: string | null }).hint_character_id;
  if (hintCharId) {
    const ch = await getCachedCharacter(hintCharId);
    if (ch) sender = buildSenderFromCharacter(ch);
  }
  const msgs = composeHintMessages({ sourceMessageId: row.id, displayHints, matchedIndex: args.hintIndex, sender });
  await replyToLine(args.replyToken, msgs, args.channelAccessToken);
  return true;
}

/**
 * Phase 2c: DB raw Message から MessageTimingConfig を組み立てる。
 * 全フィールドが null/undefined なら null (= inherit) を返す。
 */
function buildKeywordTiming(r: {
  readReceiptMode?:    string | null;
  readDelayMs?:        number | null;
  typingEnabled?:      boolean | null;
  typingMinMs?:        number | null;
  typingMaxMs?:        number | null;
  loadingEnabled?:     boolean | null;
  loadingThresholdMs?: number | null;
  loadingMinSeconds?:  number | null;
  loadingMaxSeconds?:  number | null;
}): import("@/types").MessageTimingConfig | null {
  const hasAny =
    r.readReceiptMode != null || r.readDelayMs != null ||
    r.typingEnabled != null || r.typingMinMs != null || r.typingMaxMs != null ||
    r.loadingEnabled != null || r.loadingThresholdMs != null ||
    r.loadingMinSeconds != null || r.loadingMaxSeconds != null;
  if (!hasAny) return null;
  return {
    read_receipt_mode:    (r.readReceiptMode as import("@/types").ReadReceiptMode | null) ?? null,
    read_delay_ms:        r.readDelayMs        ?? null,
    typing_enabled:       r.typingEnabled      ?? null,
    typing_min_ms:        r.typingMinMs        ?? null,
    typing_max_ms:        r.typingMaxMs        ?? null,
    loading_enabled:      r.loadingEnabled     ?? null,
    loading_threshold_ms: r.loadingThresholdMs ?? null,
    loading_min_seconds:  r.loadingMinSeconds  ?? null,
    loading_max_seconds:  r.loadingMaxSeconds  ?? null,
  };
}

/**
 * フェーズ内のキーワードメッセージ + 作品共通キーワードをインメモリで照合する。
 * 元の matchTriggerKeyword（DB クエリ版）の in-memory 版。
 */
function matchKeywordsInMemory(
  phaseMessages: PhaseRow["messages"],
  globalKwMsgs:  (KeywordMessageRecord & { triggerKeyword: string })[],
  inputText:     string,
): (KeywordMessageRecord & { triggerKeyword: string })[] {
  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);

  // フェーズ内のキーワードメッセージ（triggerKeyword あり / kind ≠ start・system_notice）。
  // 謎・問題（kind="puzzle"）も triggerKeyword を持てば「応答（キーワードで問題を送信）」として対象にする。
  // ※ フェーズスコープのみ。global（共通・phaseId=null）の謎・問題は回答バインドが曖昧なため対象外
  //   （getCachedGlobalKwMsgs 側は puzzle 除外のまま）。
  const phaseCandidates = phaseMessages
    .filter((m) => m.triggerKeyword !== null && m.kind !== "start" && m.kind !== "system_notice");
  const phaseKwMsgs = phaseCandidates
    .map((m) => ({
      id:              m.id,
      triggerKeyword:  m.triggerKeyword as string,
      messageType:     m.messageType,
      body:            m.body,
      assetUrl:        m.assetUrl,
      altText:         m.altText,
      flexPayloadJson: m.flexPayloadJson,
      quickReplies:    m.quickReplies,
      nextMessageId:   m.nextMessageId,
      sortOrder:       m.sortOrder,
      imageActionType:         m.imageActionType         ?? null,
      imageActionText:         m.imageActionText         ?? null,
      imageActionUrl:          m.imageActionUrl          ?? null,
      imageActionLiffPageId:   m.imageActionLiffPageId   ?? null,
      imageActionPostbackData: m.imageActionPostbackData ?? null,
      // 自由入力受付フラグ (buildMessageChain の chain walk 停止判定に必要)
      freeInputEnabled:        m.freeInputEnabled        ?? null,
      // 謎・問題（kind="puzzle"）をキーワード送信する場合の描画用。
      // buildKeywordMessages が kind/hintMode/incorrectQuickReplies を読み、ヒント QR と
      // sourceMessageId（回答追跡）を合成する。通常メッセージでは kind に応じて no-op。
      kind:                  m.kind ?? null,
      hintMode:              (m as { hintMode?: string | null }).hintMode ?? null,
      incorrectQuickReplies: (m as { incorrectQuickReplies?: string | null }).incorrectQuickReplies ?? null,
      // 演出設定 (Phase 2c) — PhaseRow.messages は include で全カラム取得済み
      lagMs:           m.lagMs ?? null,
      timing:          buildKeywordTiming(m),
      character:       m.character
        ? { name: m.character.name, iconImageUrl: m.character.iconImageUrl }
        : null,
    }));

  const allCandidates = [...phaseKwMsgs, ...globalKwMsgs];

  console.log(
    `[cache][kw] matchKeywordsInMemory input="${inputText}"`,
    `phaseMsgs=${phaseKwMsgs.length}件 globalKwMsgs=${globalKwMsgs.length}件`,
  );

  const matched = allCandidates.filter((msg) => {
    // 複数キーワード（\n 区切り）のいずれかと一致すれば OK
    const keywords = msg.triggerKeyword.split("\n").map((k) => k.trim()).filter(Boolean);
    return keywords.some((kw) => inputNorm === normKw(kw) || inputLoose === normKwLoose(kw));
  }) as (KeywordMessageRecord & { triggerKeyword: string })[];

  // ── 診断ログ（挙動変更なし。応答トリガー不発の A=keyword不一致 / B=候補外 切り分け用）──
  //   候補が多い場合に備えて上限 (CAND_CAP) を設ける。triggerKeyword は正規化後を出す。
  const CAND_CAP = 20;
  const candidateDebug = [
    ...phaseCandidates.map((m) => ({
      src:  "phase",
      id:   m.id.slice(0, 8),
      kind: m.kind,
      kw:   (m.triggerKeyword as string).split("\n").map((k) => normKw(k.trim())).filter(Boolean),
    })),
    ...globalKwMsgs.map((m) => ({
      src:  "global",
      id:   m.id.slice(0, 8),
      kind: null,
      kw:   m.triggerKeyword.split("\n").map((k) => normKw(k.trim())).filter(Boolean),
    })),
  ].slice(0, CAND_CAP);
  console.log(
    `[line-webhook:trigger-debug] reason=${matched.length > 0 ? "keyword_matched" : "keyword_no_match"}`,
    `normInput="${inputNorm}" phaseMsgs=${phaseKwMsgs.length} globalKwMsgs=${globalKwMsgs.length}`,
    `matched=${matched.length}` +
      (matched.length > 0
        ? ` matchedIds=[${matched.map((m) => m.id.slice(0, 8)).join(",")}]` +
          ` matchedKw=[${matched.map((m) => `"${m.triggerKeyword.replace(/\n/g, "\\n")}"`).join(",")}]`
        : ""),
    `candidates(max${CAND_CAP})=${JSON.stringify(candidateDebug)}`,
  );

  return matched;
}

/** キャッシュ済みフェーズデータからパズル照合をインメモリで行う */
function matchPuzzleFromPhase(
  phase:            PhaseRow,
  inputText:        string,
  solvedPuzzleIds:  string[] = [],
  userSegment:      "not_started" | "in_progress" | "completed" = "in_progress",
): PuzzleMatchResult {
  const puzzles = phase.messages.filter(
    (m) =>
      m.kind === "puzzle" &&
      (m.answer !== null || (typeof m.answers === "string" && m.answers.length > 0)) &&
      !solvedPuzzleIds.includes(m.id) &&
      // targetSegment フィルタ:
      //   未設定（null / ""）→ すべてのセグメントに発火
      //   設定あり → ユーザーのセグメントと一致する謎のみ発火
      (!m.targetSegment || m.targetSegment === userSegment),
  );

  if (puzzles.length === 0) return null;

  for (const puzzle of puzzles) {
    const candidates = resolveAnswerCandidates(puzzle.answer, puzzle.answers);
    if (candidates.length === 0) continue;
    const matchTypes = parsePuzzleMatchType(puzzle.answerMatchType);
    const judgement = judgePuzzleAnswerAny(inputText, candidates, matchTypes);
    if (judgement.accepted) {
      console.log(
        `[cache][puzzle] 正解 puzzleId=${puzzle.id.slice(0, 8)}`,
        `reason=${judgement.reason}`,
        `input="${inputText}" candidates=${candidates.length}件`,
      );
      return {
        type:   "correct",
        puzzle: {
          id:                    puzzle.id,
          answer:                puzzle.answer ?? "",
          answers:               puzzle.answers ?? null,
          answerMatchType:       puzzle.answerMatchType,
          correctAction:         puzzle.correctAction,
          correctText:           puzzle.correctText,
          correctCharacterId:    puzzle.correctCharacterId ?? null,
          incorrectText:         puzzle.incorrectText,
          incorrectCharacterId:  puzzle.incorrectCharacterId ?? null,
          incorrectQuickReplies: puzzle.incorrectQuickReplies,
          correctNextPhaseId:    puzzle.correctNextPhaseId,
          characterId:           puzzle.characterId ?? null,
        } as PuzzleRecord,
      };
    }
  }

  console.log(
    `[cache][puzzle] 不正解 input="${inputText}"`,
    `puzzles=${puzzles.length}件`,
  );
  return {
    type:                  "incorrect",
    // 表示する不正解ヒントは puzzles[0]（先頭問題）のもの。そのヒント QR を postback 化する際の
    // 解決キー（sourceMessageId）に使い、ラベル一致 fallback を避ける（同名ヒントの取り違え防止）。
    messageId:             puzzles[0]?.id ?? null,
    incorrectText:         puzzles[0]?.incorrectText ?? null,
    incorrectCharacterId:  puzzles[0]?.incorrectCharacterId ?? null,
    characterId:           puzzles[0]?.characterId ?? null,
    incorrectQuickReplies: puzzles[0]?.incorrectQuickReplies ?? null,
    hintMode:              (puzzles[0] as { hintMode?: string })?.hintMode ?? "always",
    hintQrItems:           puzzles[0]?.quickReplies ?? null,
  };
}

// ────────────────────────────────────────────────
// テストユーザー限定モード
// ────────────────────────────────────────────────

/**
 * TEST_MODE=true かつ TEST_LINE_USER_ID が設定されている場合にのみ
 * 指定 userId を許可する。それ以外は常に true（全員許可）を返す。
 */
function isAllowedUser(userId: string): boolean {
  const testMode   = process.env.TEST_MODE;
  const testUserId = process.env.TEST_LINE_USER_ID?.trim();

  if (testMode === "true" && testUserId) {
    return userId === testUserId;
  }
  // TEST_MODE が未設定 or false → 全ユーザーを許可
  return true;
}

/** テストモードが有効かどうか（ログ出力判定用） */
function isTestModeActive(): boolean {
  return process.env.TEST_MODE === "true" && !!process.env.TEST_LINE_USER_ID?.trim();
}

// ────────────────────────────────────────────────
// LINE ユーザープロフィール取得（プレースホルダ置換用）
// ────────────────────────────────────────────────

const LINE_PROFILE_URL  = "https://api.line.me/v2/bot/profile";
const TTL_USER_PROFILE  = 5 * 60 * 1000; // 5 分

type LineUserProfile = { displayName: string };

/**
 * LINE Profile API からユーザー表示名を取得する。
 * 5 分間インメモリキャッシュし、API エラー時は null を返す（フォールバック: 空文字）。
 */
async function getLineUserProfile(
  userId:      string,
  accessToken: string,
): Promise<LineUserProfile | null> {
  const key = `line-profile:${userId}`;
  const hit = await activeCache.get<LineUserProfile>(key);
  if (hit) return hit;
  try {
    const res = await fetch(`${LINE_PROFILE_URL}/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn(`[profile] API error ${res.status} userId=${userId.slice(0, 8)}`);
      return null;
    }
    const json = await res.json() as { displayName?: string };
    if (!json.displayName) return null;
    const profile: LineUserProfile = { displayName: json.displayName };
    await activeCache.set(key, profile, TTL_USER_PROFILE);
    return profile;
  } catch (e) {
    console.warn(`[profile] fetch error userId=${userId.slice(0, 8)}`, e);
    return null;
  }
}

// ── GET — LINE の疎通確認リクエストにも 200 を返す ──────
export async function GET() {
  return NextResponse.json({ ok: true });
}

// ── POST — メインの Webhook 処理 ─────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { oaId: string } }
) {
  // ── 全体を try/catch で包む: いかなる例外でも必ず 200 を返す ──
  try {
    // PERF_LOG_ENABLED=1 のとき totalMs を 1 行だけ出す。OFF 時は overhead 0（fn 直接呼び出し）。
    // 内部 phase の細分化は本番ログ取得後の別 PR で対応する。
    return await runWithRequestId(genRequestId(), () =>
      withTiming("line:webhook:total", () => handleWebhook(req, params.oaId))
    );
  } catch (err) {
    const e = err as Record<string, unknown> | null | undefined;
    console.error("[Webhook ERROR]", {
      name:    e?.name,
      message: e?.message,
      stack:   e?.stack,
      code:    e?.code,      // Prisma エラーコード (P2002 など)
      meta:    e?.meta,      // Prisma エラーメタ情報
      raw:     String(err),
    });
    return NextResponse.json({ ok: true });
  }
}

async function handleWebhook(req: NextRequest, oaId: string) {
  const t0 = Date.now();
  console.log(`[Webhook] 受信 oaId=${oaId} cache=${activeCache.constructor.name}`);

  // ── 1. Raw body 取得（署名検証に必要）──
  const rawBody  = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  // ── 2. JSON パース（疎通確認を早期に返すために署名検証より先に行う）──
  let webhookBody: LineWebhookBody;
  try {
    webhookBody = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    console.warn(`[Webhook] JSON パース失敗 oaId=${oaId} body=${rawBody.slice(0, 200)}`);
    return NextResponse.json({ ok: true });
  }

  // ── デバッグ: events の詳細を全件ログ出力 ──
  console.log(`[Webhook] events件数=${webhookBody.events?.length ?? 0} oaId=${oaId}`);
  for (const ev of webhookBody.events ?? []) {
    console.log(
      `[Webhook][event]`,
      `type=${ev.type}`,
      `replyToken=${ev.replyToken ? "あり" : "なし"}`,
      `message.type=${ev.message?.type ?? "-"}`,
      `message.text=${ev.message?.text != null ? `"${ev.message.text}"` : "-"}`,
      `postback.data=${ev.postback?.data ?? "-"}`,
    );
  }

  // events が空のとき（LINE の疎通確認）は署名検証をスキップして即 200 を返す
  if (!webhookBody.events || webhookBody.events.length === 0) {
    console.log(`[Webhook] 疎通確認（events 空） oaId=${oaId}`);
    return NextResponse.json({ ok: true });
  }

  // ── 3. OA 取得 ──
  // Webhook URL の [oaId] は LINE OA Basic ID（例: 613zlngs）。
  // DB の lineOaId カラムで検索する（channelId は数値の API 認証用で別物）。
  // LINE が @ 付きで送ってくる場合に備えて @ プレフィックスを除去して正規化する。
  const rawOaId        = oaId;
  const normalizedOaId = oaId.startsWith("@") ? oaId.slice(1) : oaId;

  console.log(
    `[Webhook][STEP] OA取得前`,
    `rawOaId=${rawOaId}`,
    `normalizedOaId=${normalizedOaId}`,
    `検索カラム=lineOaId`
  );

  // lineOaId で検索（@ 付き・なし両方を OR で同時に試す）。TTL 内はキャッシュを使用する。
  const oaCacheKey = CACHE_KEY.oa(normalizedOaId);
  type OaRow = NonNullable<Awaited<ReturnType<typeof prisma.oa.findFirst>>>;
  let oa: OaRow | null;
  const oaCachedVal = await activeCache.get<OaRow>(oaCacheKey);
  const oaHit = oaCachedVal !== null;
  if (oaHit) {
    console.log(`[cache] oa HIT  lineOaId=${normalizedOaId}`);
    oa = oaCachedVal;
  } else {
    console.log(`[cache] oa MISS lineOaId=${normalizedOaId}`);
    oa = await prisma.oa.findFirst({
      where: { OR: [
        { lineOaId: normalizedOaId },
        { lineOaId: `@${normalizedOaId}` },
      ]},
    });
    if (oa) await activeCache.set(oaCacheKey, oa, TTL.OA);
  }

  if (oa) {
    console.log(
      `[Webhook][STEP] OA取得後 found`,
      `id=${oa.id}`,
      `title="${oa.title}"`,
      `lineOaId="${oa.lineOaId}"`,
      `channelId="${oa.channelId}"`,
      `channel_secret=${oa.channelSecret ? "あり" : "なし"}`,
      `channel_access_token=${oa.channelAccessToken ? "あり" : "なし"}`
    );
  } else {
    // not found — 近傍の lineOaId / channelId を列挙して差分を確認しやすくする
    const candidates = await prisma.oa.findMany({
      select: { id: true, title: true, lineOaId: true, channelId: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    console.warn(
      `[Webhook] OA が見つかりません`,
      `rawOaId=${rawOaId}`,
      `normalizedOaId=${normalizedOaId}`,
      `DB内の最新5件:`,
      candidates.map((c) => `lineOaId="${c.lineOaId ?? "(未設定)"}" channelId="${c.channelId}"(id=${c.id.slice(0, 8)})`).join(" / ")
    );
    return NextResponse.json({ ok: true });
  }

  // ── 4. 署名検証 ──
  // 署名不一致・署名欠落の場合でも LINE 仕様に従い 200 を返す
  // （LINEはレスポンスコードが 200 以外だと再送を行うため）
  if (signature) {
    if (!verifyLineSignature(rawBody, signature, oa.channelSecret)) {
      console.warn(`[Webhook] 署名検証失敗 oaId=${oaId} — イベントを処理せず 200 を返します`);
      return NextResponse.json({ ok: true });
    }
  } else if (!isDev) {
    // 本番で署名なし → 不審なリクエストのため処理しないが 200 は返す
    console.warn(`[Webhook] 署名ヘッダー欠落 oaId=${oaId} — イベントを処理せず 200 を返します`);
    return NextResponse.json({ ok: true });
  } else {
    // 開発環境 + 署名なし → スキップ（curl テスト用）
    console.warn("[Webhook] 署名なし — 開発環境のためスキップします");
  }

  // ── 4-b. サービス停止判定 (= 契約終了 OA は通常処理せず一律メッセージのみ) ──
  // 必ず署名検証成功後に実行する (= 検証前に返信しない)。
  // message event の replyToken にのみ「サービス終了」テキストを返し、postback /
  // follow / beacon / unfollow 等は無視 (200 OK のみ)。reply 失敗は飲み込んで
  // 200 を返す (LINE 仕様: 200 以外で再送されるため)。
  if (oa.serviceSuspendedAt) {
    console.log(`[Webhook] oa service suspended oaId=${oa.id} lineOaId=${oa.lineOaId} suspendedAt=${oa.serviceSuspendedAt.toISOString()} events=${webhookBody.events.length}`);
    const suspendedReplyText = "このアカウントのサービスは終了しました。ご利用ありがとうございました。";
    const messageEvents = webhookBody.events.filter(
      (e): e is LineEvent & { replyToken: string } =>
        e.type === "message" && typeof e.replyToken === "string"
    );
    await Promise.allSettled(messageEvents.map(async (ev) => {
      try {
        await _replyToLine(ev.replyToken, [{ type: "text", text: suspendedReplyText }], oa.channelAccessToken);
      } catch (err) {
        console.error(`[Webhook] suspended reply failed oaId=${oa.id} replyToken=${ev.replyToken.slice(0, 8)}…`, err);
      }
    }));
    return NextResponse.json({ ok: true });
  }

  // ── 5. follow イベント処理（友達追加 → トラッキング帰属）──
  // 自動開始は work 取得後（後述）に行う
  const followEvents = webhookBody.events.filter(
    (e): e is LineEvent & { source: { userId: string }; replyToken: string } =>
      e.type === "follow" &&
      typeof e.source?.userId === "string" &&
      typeof e.replyToken === "string"
  );

  if (followEvents.length > 0) {
    // トラッキング帰属（fire-and-forget）
    await Promise.allSettled(
      followEvents.map((e) => attributeFollowToTracking(oa.id, e.source.userId))
    );
  }

  // ── 5-b. イベントを種別ごとに抽出 ──

  // テキストメッセージイベント
  const rawTextEvents = webhookBody.events.filter(
    (e): e is LineEvent & { replyToken: string; source: { userId: string }; message: { text: string } } =>
      e.type === "message" &&
      e.message?.type === "text" &&
      typeof e.message.text === "string" &&
      typeof e.replyToken === "string" &&
      typeof e.source?.userId === "string"
  );

  // postback イベント（リッチメニュータップ等）
  const rawPostbackEvents = webhookBody.events.filter(
    (e): e is LineEvent & { replyToken: string; source: { userId: string }; postback: { data: string } } =>
      e.type === "postback" &&
      typeof e.postback?.data === "string" &&
      typeof e.replyToken === "string" &&
      typeof e.source?.userId === "string"
  );

  // beacon イベント（LINE Beacon 受信圏侵入）
  const rawBeaconEvents = webhookBody.events.filter(
    (e): e is LineEvent & { beacon: { hwid: string; type: string; dm?: string } } =>
      e.type === "beacon" &&
      typeof (e as { beacon?: { hwid?: unknown } }).beacon?.hwid === "string"
  ) as unknown as LineBeaconEvent[];

  // ── 5-a. userId をログ出力（開発時の確認用）+ テストモードフィルタリング ──
  const testModeActive = isTestModeActive();

  const allowedTextEvents = rawTextEvents.filter((e) => {
    const uid = e.source.userId;
    console.info(
      `[Webhook] text message  userId=${uid}  text="${e.message.text.slice(0, 40)}"` +
      (testModeActive ? `  testMode=ON` : "")
    );
    if (!isAllowedUser(uid)) {
      console.info(`[Webhook] ignored (test mode)  userId=${uid}`);
      return false;
    }
    return true;
  });

  // ── 会員 LINE 連携コードの横取り（シナリオ処理より前・完全一致のみ）──
  //   分析除外用に、管理ユーザー本人が公式 LINE に送った連携コードを処理する。
  //   完全一致（WS-LINE-LINK-XXXXXXXX）だけを対象にし、それ以外は一切変更しない。
  //   連携コードイベントは UserProgress を作らず、シナリオ処理（textEvents）にも流さない。
  const linkCodeEvents = allowedTextEvents.filter((e) => isMemberLinkCode(e.message.text));
  const textEvents     = allowedTextEvents.filter((e) => !isMemberLinkCode(e.message.text));
  if (linkCodeEvents.length > 0) {
    for (const e of linkCodeEvents) {
      try {
        const result = await consumeMemberLinkCode({
          oaId:       oa.id,
          code:       e.message.text.trim(),
          lineUserId: e.source.userId,
          now:        new Date(),
        });
        await replyToLine(e.replyToken, [{ type: "text", text: result.message }], oa.channelAccessToken).catch(() => { /* 返信失敗は握りつぶす */ });
      } catch (err) {
        console.error(`[Webhook] member link code failed oaId=${oa.id}`, err);
        await replyToLine(e.replyToken, [{ type: "text", text: "連携処理でエラーが発生しました。時間をおいて再度お試しください。" }], oa.channelAccessToken).catch(() => {});
      }
    }
  }

  const postbackEvents = rawPostbackEvents.filter((e) => {
    const uid = e.source.userId;
    console.info(
      `[Webhook] postback      userId=${uid}  data="${e.postback.data}"` +
      (testModeActive ? `  testMode=ON` : "")
    );
    if (!isAllowedUser(uid)) {
      console.info(`[Webhook] ignored (test mode)  userId=${uid}`);
      return false;
    }
    return true;
  });

  // ── 5-c. beacon イベント処理（Sheets / Prisma モードに依らず実行）──
  // beacon は OA スコープのトリガー設定で発火するため、作品取得を待たず即実行する。
  const beaconEvents = rawBeaconEvents.filter((e) => {
    const uid = e.source?.userId;
    console.info(
      `[Webhook] beacon        userId=${uid ?? "(none)"}  hwid="${e.beacon.hwid}"  type=${e.beacon.type}` +
      (testModeActive ? `  testMode=ON` : "")
    );
    if (uid && !isAllowedUser(uid)) {
      console.info(`[Webhook] ignored (test mode)  userId=${uid}`);
      return false;
    }
    return true;
  });

  if (beaconEvents.length > 0) {
    // プラン gate（Beacon 連動は Pro 相当 / FEATURE.location）を OA 単位で 1 回だけ判定。
    let beaconPlanAllowed = true;
    try {
      const plan = await getCurrentPlanTierForOa(oa.id);
      beaconPlanAllowed = getPlanAccessState({ plan, featureKey: FEATURE.location }).allowed;
    } catch (e) {
      console.warn("[LINE Beacon] plan check failed, defaulting to allowed", e);
    }
    await Promise.allSettled(beaconEvents.map(async (event) => {
      try {
        const result = await handleBeaconEvent({
          prisma,
          oa: {
            id: oa.id,
            channelAccessToken: oa.channelAccessToken,
            serviceSuspendedAt: oa.serviceSuspendedAt,
            planAllowed: beaconPlanAllowed,
          },
          event,
          resolveMessage: ({ messageId }) => loadBeaconMessageChain(messageId, oa.title ?? ""),
          line: {
            reply: (token, msgs) => _replyToLine(token, msgs, oa.channelAccessToken),
            push:  async (uid, msgs) => { await _pushToLine(uid, msgs, oa.channelAccessToken); },
          },
          // 送信後の待機トリガー(地点到着で自動進行)の消化（本番 webhook 経路のみ）。
          // BeaconTrigger.locationId が設定された有効検知で、pending があれば次メッセージ送信 + 任意フェーズ遷移。
          onArrivalDetected: ({ lineUserId, locationId }) =>
            consumeBeaconArrivalTrigger({ lineUserId, locationId }).then(() => undefined),
        });
        console.log(
          `[Webhook][beacon] hwid=${event.beacon.hwid} type=${event.beacon.type}`,
          `userId=${event.source?.userId?.slice(0, 8) ?? "-"}`,
          `→ status=${result.status}${result.reason ? ` reason="${result.reason}"` : ""}`,
        );
      } catch (err) {
        // beacon 処理は webhook 全体を落とさない
        console.error(`[Webhook][beacon] ハンドラ例外`, err);
      }
    }));
  }

  // ── 6. Sheets モード: oa.spreadsheetId が設定されている場合は Sheets から読み込む ──
  if (oa.spreadsheetId) {
    // 診断ログ（挙動変更なし）: ここに入ると DB の triggerKeyword(応答トリガー)経路はバイパスされる。
    console.log(
      `[line-webhook:trigger-debug] reason=sheets_mode_bypass_db_trigger_keywords`,
      `oaId=${oa.id.slice(0, 8)} hasSpreadsheetId=${!!oa.spreadsheetId}`,
      `textEvents=${textEvents.length}`,
      `texts=[${textEvents.map((e) => `"${(e.message.text ?? "").slice(0, 40)}"`).join(",")}]`,
    );
    let sheetsData;
    try {
      sheetsData = await loadSheetsData(oa.spreadsheetId);
    } catch (e) {
      console.error("[Webhook] Sheets 読み込みエラー:", e);
      return NextResponse.json({ ok: true }); // Sheets 失敗時は静かに 200
    }

    const sheetsWork   = findActiveWork(sheetsData);
    const sheetsSender = sheetsWork
      ? buildSystemSenderFromSheets(sheetsData, sheetsWork)
      : undefined;

    await Promise.allSettled([
      ...textEvents.map((event) =>
        handleTextEventSheets({
          oa,
          data:         sheetsData,
          work:         sheetsWork,
          systemSender: sheetsSender,
          userId:       event.source.userId,
          text:         event.message.text.trim(),
          replyToken:   event.replyToken,
        })
      ),
      ...postbackEvents.map((event) =>
        handlePostbackEventSheets({
          oa,
          data:         sheetsData,
          work:         sheetsWork,
          systemSender: sheetsSender,
          userId:       event.source.userId,
          postbackData: event.postback.data,
          replyToken:   event.replyToken,
        })
      ),
    ]);

    return NextResponse.json({ ok: true });
  }

  // ── 6. (Prisma モード) アクティブな作品を取得（systemCharacter + welcomeMessage も JOIN）──

  const workCacheKey = CACHE_KEY.work(oa.id);
  let work: WorkRow | null;
  const workCachedVal = await activeCache.get<WorkRow>(workCacheKey);
  const workHit = workCachedVal !== null;
  if (workHit) {
    console.log(`[cache] work HIT  oaId=${oa.id.slice(0, 8)}`);
    work = workCachedVal;
  } else {
    console.log(`[cache] work MISS oaId=${oa.id.slice(0, 8)}`);
    work = await fetchActiveWork(oa.id);
    if (work) await activeCache.set(workCacheKey, work, TTL.WORK);
  }
  // welcomeMessage は work フィールドとして直接取得済み

  // システムキャラクター sender を構築（設定されていれば画像URL型のみ）
  const systemSender: LineSender | undefined = work?.systemCharacter
    ? {
        name:    work.systemCharacter.name.slice(0, 20),
        ...(work.systemCharacter.iconImageUrl?.startsWith("https://")
          ? { iconUrl: work.systemCharacter.iconImageUrl }
          : {}),
      }
    : undefined;

  // ── 6-a2. 多作品（1 OA に複数公開）判定 ──
  // 公開中作品を全件取得（単一作品時は activeWorks=[work] 同等＝既存パス不変）。
  // multiWork=true のときだけ、開始キーワードでの作品解決を行う。
  const activeWorks = await fetchActiveWorks(oa.id);
  const multiWork = activeWorks.length > 1;
  const activeWorkIdSet = new Set(activeWorks.map((w) => w.id));

  // ── 6-b. ユーザープロフィール一括取得（プレースホルダ置換用）──
  // 全イベントの unique userId を集めてプロフィールを並列フェッチする（5 分キャッシュ）。
  const allEventUserIds = [...new Set([
    ...followEvents.map((e) => e.source.userId),
    ...textEvents.map((e) => e.source.userId),
    ...postbackEvents.map((e) => e.source.userId),
  ])];
  const profileMap = new Map<string, string>(); // userId → displayName
  await Promise.allSettled(
    allEventUserIds.map(async (uid) => {
      const p = await getLineUserProfile(uid, oa.channelAccessToken);
      if (p?.displayName) profileMap.set(uid, p.displayName);
    })
  );
  /** ユーザー別のプレースホルダ変数を生成する */
  const buildVars = (uid: string): import("@/lib/line").PlaceholderVars => ({
    userName:    profileMap.get(uid) ?? "",
    accountName: oa.title,
  });

  // ── 6-c. follow（友だち追加）時の動作 — 作品単位の followAction で分岐 ──
  //   auto_start   : 友だち追加直後にシナリオ自動開始（既存挙動・既定）
  //   welcome_wait : あいさつメッセージを送り「はじめる」を待つ（progress は作らない）
  //   none         : 何もしない
  // ※ OA 停止中は上部（serviceSuspendedAt）で early return 済みのためここには来ない。
  if (followEvents.length > 0 && work) {
    // PR-1: あいさつ設定は OA 単位優先 + active Work フォールバック（resolveFollowSettings）。
    //   - oa.welcomeMessage/followAction が未設定(null)なら従来どおり work の値を使う（移行期互換）。
    //   - resume_enabled には触れない。実行（送信/開始）ロジックは不変。
    const effective = resolveFollowSettings(oa, work);
    const followAction = effective.followAction;
    // あいさつ（複数件・text/image）。空（または不正）なら welcomeMessage にフォールバック。
    const welcomeItems = parseWelcomeMessages(work.welcomeMessagesJson);
    // 送信判断は純関数 decideFollowBehavior に一本化する。
    // 未設定・空文字・空白のみ・開始対象なしのときは「何も送らない」(デフォルト文面は送らない)。
    await Promise.allSettled(
      followEvents.map(async (e) => {
        const uid = e.source.userId;

        // ── 複数公開時: 自動開始しない。OA あいさつ（単一テキスト）があれば送るだけ。 ──
        // どの作品を開始すべきか曖昧なため auto_start せず、開始 quickReply も付けない
        // （ユーザーは作品ごとの開始キーワードを送って選ぶ）。単一公開時は下の既存ロジック。
        if (multiWork) {
          const welcomeText = (effective.welcomeMessage ?? "").trim();
          if (welcomeText) {
            await applyWelcomeLoading(work.welcomeLoadingSeconds, uid, oa.channelAccessToken);
            await replyToLine(
              e.replyToken,
              buildWelcomeMessages({ ...work, welcomeMessage: welcomeText }, systemSender, null, []),
              oa.channelAccessToken,
            );
            console.info(`[line-follow] multiWork: sent OA welcome only (no auto_start) userId=${uid.slice(0, 8)}`);
          } else {
            console.info(`[line-follow] multiWork: no OA welcome → skip userId=${uid.slice(0, 8)}`);
          }
          return;
        }

        // auto_start のときだけ開始対象（開始フェーズ）の有無を確認する。
        const hasStartTarget =
          followAction === "auto_start" ? !!(await getCachedStartPhase(work.id)) : false;
        const decision = decideFollowBehavior({
          followAction,
          welcomeMessage: effective.welcomeMessage,
          hasWelcomeMessages: welcomeItems.length > 0,
          hasStartTarget,
        });

        if (decision.action === "skip") {
          console.info(`[line-follow] skipped: ${decision.reason} userId=${uid.slice(0, 8)}`);
          return;
        }
        if (decision.action === "send_welcome") {
          // welcomeMessage が明示設定されている場合のみ。progress は作らず開始 quick reply を待つ。
          // 対象作品の startTrigger を取得し、あれば開始 quick reply を付与する（無ければ警告）。
          const startTrigger = (await getCachedStartPhase(work.id))?.startTrigger?.trim() || null;
          if (!startTrigger) {
            console.warn(`[line-follow] welcome_wait: startTrigger 未設定 → 開始 quickReply なし workId=${work.id.slice(0, 8)} userId=${uid.slice(0, 8)}`);
          }
          console.info(`[line-follow] sent welcome_wait message userId=${uid.slice(0, 8)} startTriggerQr=${!!startTrigger} items=${welcomeItems.length} loadingSec=${work.welcomeLoadingSeconds ?? 0}`);
          // 送信前の「入力中…」演出（welcomeLoadingSeconds>0 のとき）。reply 一括は維持。
          await applyWelcomeLoading(work.welcomeLoadingSeconds, uid, oa.channelAccessToken);
          await replyToLine(e.replyToken, buildWelcomeMessages({ ...work, welcomeMessage: effective.welcomeMessage }, systemSender, startTrigger, welcomeItems), oa.channelAccessToken);
          return;
        }
        // auto_start（開始対象あり）: 既存仕様どおりシナリオ自動開始。
        console.info(`[line-follow] sent auto_start first message userId=${uid.slice(0, 8)}`);
        await handleStart({ oa, work, systemSender, userId: uid, replyToken: e.replyToken, vars: buildVars(uid) });
      })
    );
  }

  // ── 7. 各イベントを並列処理（エラーが出ても他のイベントに影響させない）──
  // ReadReceiptController を AsyncLocalStorage 経由でハンドラーに注入する。
  // これにより既存の replyToLine / replyWithLagToLine 呼び出しが透過的に
  // 「返信前の既読送信」を行うようになる。
  const workTiming = extractWorkTiming(work);
  await Promise.allSettled([
    // テキストメッセージ（markAsReadToken 付き）
    ...textEvents.map((event) => {
      const dynamicDelay = calcReadDelayByTextLength(event.message.text.trim().length);
      const ctrl = new ReadReceiptController({
        markAsReadToken:  event.markAsReadToken,
        userId:           event.source.userId,
        channelAccessToken: oa.channelAccessToken,
        isOneOnOne:       event.source.type === "user",
        config:           { readDelayMs: dynamicDelay },
        oaId:             oa.id,
        workId:           work?.id ?? null,
      });
      ctrl.setWorkTiming(workTiming);
      ctrl.scheduleDelayedRead();
      const loadingAbort = new AbortController();
      ctrl.scheduleLoading(loadingAbort.signal);

      return readCtrlStorage.run(ctrl, async () => {
        const uid  = event.source.userId;
        const text = event.message.text.trim();
        try {
          if (!multiWork) {
            // 単一公開（or 0件）。
            // NEW: Work.startKeyword 一致なら開始（resume 導線維持）。startTrigger / 開始コマンド / キーワード /
            //   QR 等は従来どおり handleTextEvent 内で処理（後方互換）。startKeyword 未設定なら従来挙動のまま。
            const single = work ?? null;
            const skNorm = normalizeStartKeyword(single?.startKeyword);
            if (single && skNorm && normalizeStartKeyword(text) === skNorm) {
              console.log(`[Webhook][single] start keyword 一致 → workId=${single.id.slice(0, 8)} userId=${uid.slice(0, 8)}`);
              await startWorkByKeyword({ oa, work: single, systemSender, userId: uid, replyToken: event.replyToken, vars: buildVars(uid) });
            } else {
              // 開始KW非一致。free_text 開始は「完全新規（この OA に progress が一切ない）」ユーザーに限定。
              //   進行中/クリア済みなど progress がある場合は handleTextEvent（＝謎回答/ヒント/応答KW等の既存処理）に委ねる。
              const ftRes = resolveFreeTextStartWork(activeWorks);
              const ftHasProgress = ftRes.status === "start"
                ? await hasAnyProgressInActiveWorks(uid, activeWorks.map((w) => w.id))
                : true;
              if (ftRes.status === "start" && !ftHasProgress) {
                const ftWork = activeWorks.find((w) => w.id === ftRes.workId) ?? single;
                console.log(`[Webhook][single] free_text 開始 → workId=${ftRes.workId.slice(0, 8)} userId=${uid.slice(0, 8)} reason="free_text_start_trigger"`);
                await startWorkByKeyword({ oa, work: ftWork!, systemSender, userId: uid, replyToken: event.replyToken, vars: buildVars(uid) });
              } else {
                if (ftRes.status === "start" && ftHasProgress) {
                  console.log(`[Webhook][single] free_text 開始せず（既存progressあり=新規ではない） userId=${uid.slice(0, 8)} reason="free_text_start_skipped_existing_progress"`);
                } else if (ftRes.status === "ambiguous") {
                  console.warn(`[Webhook][single] free_text 開始せず（複数候補で曖昧） userId=${uid.slice(0, 8)} reason="free_text_start_ambiguous" candidates=[${ftRes.workIds.map((id) => id.slice(0, 8)).join(",")}]`);
                }
                await handleTextEvent({
                  oa, work: single, systemSender, userId: uid, text,
                  replyToken: event.replyToken, vars: buildVars(uid),
                });
              }
            }
          } else {
            // 複数公開: 開始キーワード(Work.startKeyword ∨ 開始フェーズ Phase.startTrigger)を最優先で照合。
            const candidates = await Promise.all(activeWorks.map(async (w) => ({
              id: w.id, startKeyword: w.startKeyword, startTrigger: (await getCachedStartPhase(w.id))?.startTrigger ?? null,
            })));
            const matched = matchStartWork(text, candidates);
            if (matched) {
              // 開始KW一致 → その作品を開始（作品内応答キーワードより優先・resume 導線維持・他作品の進行は消さない）。
              const startWork = activeWorks.find((w) => w.id === matched.id)!;
              console.log(`[Webhook][multi] start keyword 一致 → workId=${startWork.id.slice(0, 8)} userId=${uid.slice(0, 8)}`);
              await startWorkByKeyword({ oa, work: startWork, systemSender: buildWorkSystemSender(startWork), userId: uid, replyToken: event.replyToken, vars: buildVars(uid) });
            } else {
              // 非一致 → 進行中作品があればその作品で通常処理。無ければ勝手に開始しない（何もしない）。
              const inProgressId = await resolveInProgressWorkId(uid, activeWorks.map((w) => w.id));
              const ipWork = inProgressId ? activeWorks.find((w) => w.id === inProgressId) ?? null : null;
              if (ipWork) {
                console.log(`[Webhook][multi] 進行中作品で継続 → workId=${ipWork.id.slice(0, 8)} userId=${uid.slice(0, 8)}`);
                await handleTextEvent({ oa, work: ipWork, systemSender: buildWorkSystemSender(ipWork), userId: uid, text, replyToken: event.replyToken, vars: buildVars(uid) });
              } else {
                // 開始KW非一致 & 進行中なし（ここに来た時点で in-progress 作品なし）。
                // free_text 開始は「完全新規（この OA に progress が一切ない）」ユーザーに限定する。
                //   → クリア済み(reachedEnding=true)ユーザーの感想/雑談で再スタートしない。
                const ftRes = resolveFreeTextStartWork(activeWorks);
                if (ftRes.status === "start") {
                  const hasProgress = await hasAnyProgressInActiveWorks(uid, activeWorks.map((w) => w.id));
                  if (!hasProgress) {
                    const ftWork = activeWorks.find((w) => w.id === ftRes.workId)!;
                    console.log(`[Webhook][multi] free_text 開始 → workId=${ftWork.id.slice(0, 8)} userId=${uid.slice(0, 8)} reason="free_text_start_trigger"`);
                    await startWorkByKeyword({ oa, work: ftWork, systemSender: buildWorkSystemSender(ftWork), userId: uid, replyToken: event.replyToken, vars: buildVars(uid) });
                  } else {
                    console.log(`[Webhook][multi] free_text 開始せず（既存progressあり=新規ではない） userId=${uid.slice(0, 8)} reason="free_text_start_skipped_existing_progress"`);
                  }
                } else if (ftRes.status === "ambiguous") {
                  console.warn(`[Webhook][multi] free_text 開始せず（複数候補で曖昧） userId=${uid.slice(0, 8)} reason="free_text_start_ambiguous" candidates=[${ftRes.workIds.map((id) => id.slice(0, 8)).join(",")}]`);
                } else {
                  console.log(`[Webhook][multi] 開始KW非一致 & 進行中なし → 何もしない userId=${uid.slice(0, 8)} text="${text.slice(0, 40)}"`);
                }
              }
            }
          }
        } catch (err) {
          console.error(
            `[Webhook][ERROR] handleTextEvent 例外`,
            `userId=${event.source.userId.slice(0, 8)}`,
            `text="${event.message.text.slice(0, 60)}"`,
            err,
          );
          throw err;
        } finally {
          loadingAbort.abort();
          ctrl.logTiming(`text userId=${event.source.userId.slice(0, 8)}`);
          ctrl.dispose();
        }
      });
    }),
    // postback（リッチメニューアクション）
    ...postbackEvents.map((event) => {
      const ctrl = new ReadReceiptController({
        markAsReadToken:  event.markAsReadToken,
        userId:           event.source.userId,
        channelAccessToken: oa.channelAccessToken,
        isOneOnOne:       event.source.type === "user",
        oaId:             oa.id,
        workId:           work?.id ?? null,
      });
      ctrl.setWorkTiming(workTiming);
      ctrl.scheduleDelayedRead();

      return readCtrlStorage.run(ctrl, async () => {
        const uid = event.source.userId;
        try {
          // postback の作品は payload 由来で解決する（直近 progress ではなく workId/messageId/phaseId 優先）。
          // 単一公開時は既存どおり work を使う（後方互換）。複数公開時に解決できない（rich menu 等）postback は
          // 誤った作品で処理しないようスキップする。他 OA の id を含む payload は resolvePostbackWorkId が拒否する。
          let pbWork: WorkRow | null = work ?? null;
          if (multiWork) {
            const wid = await resolvePostbackWorkId(event.postback.data, activeWorkIdSet);
            pbWork = wid ? (activeWorks.find((w) => w.id === wid) ?? null) : null;
            if (!pbWork) {
              console.log(`[Webhook][multi] postback 作品解決不可 → スキップ userId=${uid.slice(0, 8)} data="${event.postback.data.slice(0, 60)}"`);
              return;
            }
          }
          await handlePostbackEvent({
            oa,
            work:         pbWork,
            systemSender: multiWork ? buildWorkSystemSender(pbWork) : systemSender,
            userId:       uid,
            data:         event.postback.data,
            replyToken:   event.replyToken,
            vars:         buildVars(uid),
          });
        } catch (err) {
          console.error(
            `[Webhook][ERROR] handlePostbackEvent 例外`,
            `userId=${event.source.userId.slice(0, 8)}`,
            `data="${event.postback.data}"`,
            err,
          );
          throw err;
        } finally {
          ctrl.logTiming(`postback userId=${event.source.userId.slice(0, 8)}`);
          ctrl.dispose();
        }
      });
    }),
  ]);

  // LINE には常に 200 OK を返す
  console.log(`[perf][webhook] total=${Date.now() - t0}ms oa=${oaHit ? "hit" : "miss"} work=${workHit ? "hit" : "miss"}`);
  return NextResponse.json({ ok: true });
}

// ──────────────────────────────────────────────────────────
// テキストイベント処理
// ──────────────────────────────────────────────────────────

type OaRecord = {
  id: string;
  title: string;
  channelSecret: string;
  channelAccessToken: string;
  // PR-1: OA単位のあいさつ設定（あれば OA優先・無ければ work フォールバック）。
  welcomeMessage?: string | null;
  followAction?: string | null;
};

type WorkRecord = {
  id: string;
  title: string;
  /** あいさつメッセージ。null のときはシステムデフォルト文を使う */
  welcomeMessage: string | null;
  /** 途中再開機能の有効/無効（作品単位）。false のとき再開選択肢を出さず最初から開始に寄せる。
   *  runtime の work は full row (fetchActiveWork) なのでこの列を保持する。undefined は従来=true 扱い。 */
  resumeEnabled?: boolean;
  /** あいさつメッセージ（複数件・text/image）の JSON。runtime の work は full row なので保持する。
   *  Prisma Json 型のため unknown 相当。parseWelcomeMessages で安全に正規化する。 */
  welcomeMessagesJson?: unknown;
  /** あいさつ送信前の「入力中…」演出の待機秒数（0〜8）。0=演出なし。full row なので保持する。 */
  welcomeLoadingSeconds?: number | null;
} | null;

// handleTextEvent / handlePostbackEvent / handleStart / handleContinue で共通使用
type HandlerCommon = {
  oa:           OaRecord;
  work:         WorkRecord;
  systemSender: LineSender | undefined;
  userId:       string;
  replyToken:   string;
  /** メッセージ本文のプレースホルダ置換変数（user_name / account_name） */
  vars:         import("@/lib/line").PlaceholderVars;
};

/**
 * 未開始ユーザー向けのあいさつメッセージを組み立てる。
 *
 * 優先順位:
 *  1. items（welcomeMessagesJson 由来・最大5件の text/image）があればそれを送る。
 *  2. 無ければ welcomeMessage（単一テキスト）を 1 吹き出し（互換）。
 *  3. どちらも無ければ作品名のあいさつ 1 吹き出し（送信可否は呼び出し側 decideFollowBehavior が判定）。
 *
 * 開始案内は固定文言「『はじめる』と送ってください」を廃止し、対象作品の開始応答キーワード
 * （startTrigger）がある場合のみ、**最後のメッセージ**（text/image いずれも quickReply 可）に
 * message-action の quick reply として付与する。押下すると startTrigger テキストが送信され、既存の
 * startTrigger 照合経路（handleTextEvent）で物語が開始する（postback は使わない）。startTrigger が
 * 無い場合は quick reply を付けない（固定「はじめる」を勝手に代用しない）。
 */
/**
 * あいさつ送信前の「入力中…」演出（PR-B1）。welcomeLoadingSeconds(1〜8) のとき、
 * loading アニメーション（メッセージ通数を消費しない）を表示し、設定秒だけ待ってから reply する。
 *  - 0/未設定 → 何もしない（即時 reply＝従来挙動）。
 *  - loading API が失敗（false/例外）しても reply は止めない（ログのみ）。sleep は設定どおり実施。
 *  - push は使わない。reply 一括のまま。
 */
async function applyWelcomeLoading(
  welcomeLoadingSeconds: number | null | undefined,
  userId: string,
  channelAccessToken: string,
): Promise<void> {
  const sec = welcomeLoadingSeconds ?? 0;
  if (sec <= 0 || !userId) return;
  try {
    await showLoadingAnimation(userId, sec, channelAccessToken);
  } catch (err) {
    console.warn(`[welcome-loading] showLoadingAnimation failed userId=${userId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await sleep(sec * 1000);
}

function buildWelcomeMessages(
  work: NonNullable<WorkRecord>,
  systemSender: LineSender | undefined,
  startTrigger?: string | null,
  items?: WelcomeMessageItem[],
): import("@/lib/line").LineMessage[] {
  let msgs: import("@/lib/line").LineMessage[];

  if (items && items.length > 0) {
    // welcomeMessagesJson 由来（最大5件）。text/image を LINE message に変換。
    msgs = items.slice(0, WELCOME_MESSAGES_MAX).map((it) =>
      it.type === "image"
        ? ({
            type:              "image",
            originalContentUrl: it.imageUrl,
            previewImageUrl:    it.previewImageUrl ?? it.imageUrl,
            sender:             systemSender,
          } as import("@/lib/line").LineMessage)
        : ({ type: "text", text: it.text, sender: systemSender } as import("@/lib/line").LineMessage),
    );
  } else {
    // 互換: 既存 welcomeMessage（無ければ作品名あいさつ）の単一テキスト。
    const body = work.welcomeMessage?.trim()
      ? work.welcomeMessage.trim()
      : `「${work.title}」へようこそ。`;
    msgs = [{ type: "text", text: body, sender: systemSender }];
  }

  // startTrigger があれば最後のメッセージ（text/image 問わず quickReply 可）に QR を付与。
  const trig = startTrigger?.trim();
  if (trig && msgs.length > 0) {
    const quickReply: import("@/lib/line").LineQuickReply = {
      items: [{
        type:   "action",
        action: { type: "message", label: trig.slice(0, 20), text: trig },
      }],
    };
    (msgs[msgs.length - 1] as { quickReply?: import("@/lib/line").LineQuickReply }).quickReply = quickReply;
  }

  return msgs;
}

/**
 * 「開始意図」(text の はじめる/スタート 等, リッチメニュー START, startTrigger 一致) を受けたときに、
 * 途中離脱ユーザーへ「途中から再開する / 最初からやり直す」の選択肢を出すべきか判定する共通ヘルパ。
 *
 * - 出すべき (= resumeEnabled≠false かつ 未エンディングで進行中) なら sendResumeChoice して true を返す。
 * - 出さない (新規 / 完了済み / resumeEnabled=false / work・progress なし) 場合は false を返し、
 *   呼び出し側が従来どおり handleStart / handleStartTrigger（= 最初から開始）に進む。
 *
 * 判定ロジックは shouldOfferResumeChoice (src/lib/message-flow.ts) に集約。DB / schema 変更なし。
 */
async function maybeOfferResumeChoice(
  args: { oa: OaRecord; work: WorkRecord; systemSender: LineSender | undefined; replyToken: string },
  progress: ProgressCached | null,
): Promise<boolean> {
  const { oa, work, systemSender, replyToken } = args;
  if (!work || !progress) return false;
  const offer = shouldOfferResumeChoice({
    resumeEnabled:  work.resumeEnabled,
    hasProgress:    true,
    reachedEnding:  !!progress.reachedEnding,
    currentPhaseId: progress.currentPhaseId ?? null,
  });
  if (!offer) return false;
  await sendResumeChoice({
    oa, work, systemSender, replyToken,
    workId: work.id, currentPhaseId: progress.currentPhaseId!,
  });
  return true;
}

/**
 * 開始キーワード一致時の作品開始（resume 導線を壊さない・既存 startTrigger 経路と同一）。
 *   1. 対象作品に未完了 progress（resumeEnabled≠false・未エンディング・進行中）があれば「続き/最初から」選択肢を提示して終了。
 *   2. それ以外（新規 / 完了済み / resumeEnabled=false）は handleStartTrigger で最初から開始。
 * 開始フェーズが無い作品は handleStart（"準備中" 応答）に委ねる。別作品の progress には触れない。
 */
async function startWorkByKeyword(args: {
  oa: OaRecord; work: NonNullable<WorkRecord>; systemSender: LineSender | undefined;
  userId: string; replyToken: string; vars: import("@/lib/line").PlaceholderVars;
}): Promise<void> {
  const { oa, work, systemSender, userId, replyToken, vars } = args;
  const startPhase = await getCachedStartPhase(work.id);
  if (!startPhase) {
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }
  const progress = await getCachedProgress(userId, work.id);
  // 未完了 progress があれば resume 選択肢（resume_work postback）。無条件初期化はしない。
  if (await maybeOfferResumeChoice({ oa, work, systemSender, replyToken }, progress)) return;
  await handleStartTrigger({ oa, work, systemSender, userId, replyToken, vars, startPhase });
}

/**
 * QR 分岐の送信（response_message / target_message / target_phase）を実行する共通処理。
 * text event（QR ラベル手入力 / 旧 message action QR）と postback（action=quick_reply）の両方から
 * 呼び出し、同じ送信経路（5通以内 reply / 6通以上 push・自由入力 post-effect・フェーズ遷移）を共有する。
 * 送信して完了したら true、何も送れずフォールスルーすべきとき（qrMsgs 空）は false を返す。
 */
async function deliverQrBranch(args: {
  matchedQrItem: import("@/types").QuickReplyItem;
  oa:            OaRecord;
  work:          NonNullable<WorkRecord>;
  progress:      ProgressCached | null;
  systemSender:  LineSender | undefined;
  userId:        string;
  replyToken:    string;
  token:         string;
  vars:          import("@/lib/line").PlaceholderVars;
  /** perf ログ用の起点時刻（呼び出し元イベントの t0）。 */
  startedAt:     number;
}): Promise<boolean> {
  const { matchedQrItem, oa, work, progress, systemSender, userId, replyToken, token, vars, startedAt: t0e } = args;
  console.log(`[Webhook][STEP] qrItem マッチ userId=${userId}`,
    `response_message_id=${matchedQrItem.response_message_id?.slice(0, 8) ?? "none"}`,
    `target_type=${matchedQrItem.target_type ?? "none"}`,
    `target_message_id=${matchedQrItem.target_message_id?.slice(0, 8) ?? "none"}`,
    `target_phase_id=${matchedQrItem.target_phase_id?.slice(0, 8) ?? "none"}`,
  );

  // Step 2 用の DB セレクト（buildMessageChain に渡す形式）
  // Phase 2c hotfix: 演出設定 (lagMs / readReceiptMode / typingEnabled 等) も fetch する。
  // これがないと response_message の per-message timing が runtime まで届かない。
  const MSG_SELECT = {
    id: true, messageType: true, body: true, assetUrl: true,
    assetPreviewUrl: true, assetUsage: true,
    altText: true, flexPayloadJson: true, quickReplies: true,
    nextMessageId: true, sortOrder: true,
    // 問題（puzzle）のヒント QR 合成用（target_message_id → puzzle で必須）
    kind: true, hintMode: true, incorrectQuickReplies: true,
    imageActionType: true, imageActionText: true, imageActionUrl: true,
    imageActionLiffPageId: true, imageActionPostbackData: true,
    // 自由入力受付フラグ (buildMessageChain で chain walk 停止判定に使う)
    freeInputEnabled: true,
    // 演出設定 (Phase 2c)
    lagMs: true,
    readReceiptMode: true, readDelayMs: true,
    typingEnabled: true, typingMinMs: true, typingMaxMs: true,
    loadingEnabled: true, loadingThresholdMs: true,
    loadingMinSeconds: true, loadingMaxSeconds: true,
    character: { select: { name: true, iconImageUrl: true } },
  } as const;

  const qrMsgs: import("@/lib/line").LineMessage[] = [];
  // 自由入力受付モード用: 実際にユーザーへ送信される全メッセージ ID
  const qrSentIds: string[] = [];

  // ── QR 分岐の送信仕様 ──
  //  target_message_id（target_type="message"）が設定されている場合は、
  //  「target chain」を正として送る = response_message_id のチェーンを target より前に
  //  自動で割り込ませない。これにより管理画面で「入力 → あっ」と設定したとおり
  //  「入力 → target → target の nextMessageId chain」の順で届く。
  //  target_message_id が無い場合は従来どおり response_message_id のチェーンを送る（既存互換）。
  //  （target_phase_id 遷移は別パス。response は従来どおり Step 3b の前段で送られる）
  const qrBranch = resolveQrBranchDelivery(matchedQrItem);
  const hasMessageTarget = !qrBranch.sendResponseChain;

  // 解決結果を構造化ログに残す（PII / 本文は出さない）。
  console.info("[line:qr-branch:resolved]", JSON.stringify({
    oaId: oa.id,
    workId: work.id,
    itemLabel: matchedQrItem.label ?? null,
    responseMessageId: matchedQrItem.response_message_id ?? null,
    targetMessageId: matchedQrItem.target_message_id ?? null,
    targetPhaseId: matchedQrItem.target_phase_id ?? null,
    selectedRootMessageId: qrBranch.selectedRootMessageId,
    mode: qrBranch.mode,
  }));

  // ── Step 2: 応答メッセージ（返す内容）──
  //  target_message_id がある場合は送らない（target chain を正とするため）。
  if (!hasMessageTarget && matchedQrItem.response_message_id) {
    try {
      const respMsg = await prisma.message.findUnique({
        where: { id: matchedQrItem.response_message_id, isActive: true },
        select: MSG_SELECT,
      });
      if (respMsg) {
        const { messages: chain, chainIds } = await buildMessageChain(respMsg, vars);
        qrMsgs.push(...chain);
        qrSentIds.push(...chainIds);
      }
    } catch (e) {
      console.warn("[Webhook] qrItem response_message fetch error:", e);
    }
  }

  // ── Step 3a: 遷移先メッセージ（フェーズ遷移なし）──
  if (hasMessageTarget) {
    try {
      const targetMsg = await prisma.message.findUnique({
        where: { id: matchedQrItem.target_message_id, isActive: true },
        select: MSG_SELECT,
      });
      if (targetMsg) {
        const { messages: chain, chainIds } = await buildMessageChain(targetMsg, vars);
        qrMsgs.push(...chain);
        qrSentIds.push(...chainIds);
      }
    } catch (e) {
      console.warn("[Webhook] qrItem target_message fetch error:", e);
    }
    if (qrMsgs.length > 0) {
      const tReplyQrMsg = Date.now();
      // Phase 2c hotfix: chain (= length > 1) でも per-message timing が効くよう、
      // replyWithLagToLine 経路に統一する。1 通でも replyWithLagToLine は内部で
      // replyToLine に委譲するため、挙動差は per-message timing の有無のみ。
      await replyWithLagToLine(replyToken, qrMsgs, userId, token);
      // qrItem_message パス: 応答 + 遷移先チェーンの末尾を自由入力候補とする
      await applyFreeInputPostEffect({
        sentMessageIds: qrSentIds,
        oaId: oa.id,
        route: "qr_target_message",
        userId,
        workId:    work.id,
        progressId: progress?.id,
      });
      console.log(`[perf][event] path=qrItem_message total=${Date.now() - t0e}ms reply:${Date.now() - tReplyQrMsg}ms`);
      return true;
    }
    // qrMsgs が空の場合はフォールスルー（keyword/transition へ）
  }

  // ── Step 3b: 遷移先フェーズ（フェーズ遷移あり）──
  //  progress が無い場合は phase 更新ができないため安全にスキップ（フォールスルー）。
  if (matchedQrItem.target_phase_id && progress) {
    try {
      const toPhaseRow = await getCachedPhase(matchedQrItem.target_phase_id);
      if (toPhaseRow) {
        const isEnding = toPhaseRow.phaseType === "ending";
        const updated  = await prisma.userProgress.update({
          where: { id: progress.id },
          data: {
            currentPhaseId:   matchedQrItem.target_phase_id,
            reachedEnding:    isEnding,
            lastInteractedAt: new Date(),
          },
        });
        await setCachedProgress(updated);
        fireResumeCompletedIfApplicable(updated, oa.id);
        const state     = await buildRuntimeState(updated, toPhaseRow);
        const phaseMsgs = buildPhaseMessages(state.phase, { systemSender, vars });
        qrMsgs.push(...phaseMsgs);
        // 遷移後フェーズのメッセージも自由入力候補に含める
        const phaseMessageIds = state.phase?.messages.map((m) => m.id) ?? [];
        const tReplyQrPh = Date.now();
        // 応答chain + 遷移先フェーズの全メッセージを切らずに渡す。
        // replyWithLagToLine が 5通以下=Reply / 6通以上=Reply+Push に分割するため、
        // 呼び出し側で slice(0,5) すると 6通目以降が破棄される（通常フェーズ遷移パスと挙動を揃える）。
        await replyWithLagToLine(replyToken, qrMsgs, userId, token);
        await applyFreeInputPostEffect({
          sentMessageIds: [...qrSentIds, ...phaseMessageIds],
          oaId: oa.id,
          route: "qr_target_phase",
          userId,
          workId:    work.id,
          progressId: updated.id,
        });
        console.log(`[perf][event] path=qrItem_phase total=${Date.now() - t0e}ms reply:${Date.now() - tReplyQrPh}ms`);
        void switchRichMenuForUser(oa, userId, toPhaseRow.phaseType);
        return true;
      }
    } catch (e) {
      console.warn("[Webhook] qrItem target_phase transition error:", e);
      // フォールバック: 通常フローへ
    }
  }

  // ── response_message のみ（遷移先なし）──
  if (qrMsgs.length > 0) {
    const tReplyQrResp = Date.now();
    // Phase 2c hotfix: chain 内 per-message timing を効かせるため replyWithLagToLine に変更
    await replyWithLagToLine(replyToken, qrMsgs, userId, token);
    await applyFreeInputPostEffect({
      sentMessageIds: qrSentIds,
      oaId: oa.id,
      route: "qr_response",
      userId,
      workId:    work.id,
      progressId: progress?.id,
    });
    console.log(`[perf][event] path=qrItem_response total=${Date.now() - t0e}ms reply:${Date.now() - tReplyQrResp}ms`);
    return true;
  }
  // qrMsgs が空（応答メッセージも遷移先も解決できなかった）→ フォールスルー
  return false;
}

async function handleTextEvent({
  oa,
  work,
  systemSender,
  userId,
  text,
  replyToken,
  vars,
}: HandlerCommon & { text: string }) {
  const token = oa.channelAccessToken;
  const t0e = Date.now();
  // perf tracking（各パスの終端 [perf][event] で使用）
  let progressFindMs   = -1;   // getCachedProgress の所要時間
  let progressHit      = false; // true = キャッシュ HIT / false = DB MISS
  let phaseHit         = false; // currentPhase キャッシュ HIT フラグ
  let progressUpdateMs = -1;   // userProgress.update の所要時間（transition パスのみ）

  // ── 診断ログ（挙動変更なし）: text イベント受信。Flex message action / QR / 手入力は
  //    すべてここを通る（= 通常 text event）。currentPhaseId 等は後段の context ログで出す。
  console.log(
    `[line-webhook:trigger-debug] reason=text_received`,
    `eventType=message messageType=text`,
    `oaId=${oa.id.slice(0, 8)} hasUserId=${!!userId} userId=${userId?.slice(0, 8) ?? "-"}`,
    `text="${text.slice(0, 60)}" normText="${normKw(text)}"`,
  );

  // ─ 公開中の作品がない ─
  if (!work) {
    await replyToLine(replyToken, [{
      type: "text",
      text: "現在、公開中のシナリオはありません。もうしばらくお待ちください。",
    }], token);
    return;
  }

  // ─ 「はじめる」系コマンド → 常に（再）開始 ─
  // isStartCommand: 厳密一致 ("はじめる", "スタート" 等)
  // isStartIntent:  ゆるい末尾一致 ("『作品名』をはじめる" 等、リッチメニュー message アクション対応)
  if (isStartCommand(text) || isStartIntent(text)) {
    console.log(
      `[Webhook][STEP] 開始コマンド検出`,
      `isStartCommand=${isStartCommand(text)}`,
      `isStartIntent=${isStartIntent(text)}`,
      `text="${text.slice(0, 60)}"`,
      `userId=${userId}`,
    );
    // 途中離脱ユーザー（resumeEnabled≠false・未エンディングで進行中）には再開選択肢を提示する。
    // 新規 / 完了済み / resumeEnabled=false は従来どおり handleStart（最初から開始）。
    const progressForStart = await getCachedProgress(userId, work.id);
    if (await maybeOfferResumeChoice({ oa, work, systemSender, replyToken }, progressForStart)) return;
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // ─ 「リセット」コマンド → 開始と同様にリセット後スタート ─
  if (isResetCommand(text)) {
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // ─ 「つづきから」コマンド → 現在の進行状態を表示 ─
  if (isContinueCommand(text)) {
    await handleContinue({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // ─ ① globalCmd(cache) + startTrigger(cache) + progress(cache) を並列取得 ─
  //   キャッシュ HIT 時はほぼゼロコスト。MISS 時でも 3 クエリ並列発行。
  //   progress は write-through キャッシュ（TTL 10秒）で DB ラウンドトリップを削減。
  const [cachedCmds, startPhaseForTrigger, progress] = await Promise.all([
    getCachedGlobalCmds(oa.id),
    getCachedStartPhase(work.id),
    (async () => {
      const t   = Date.now();
      const key = CACHE_KEY.progress(userId, work.id);
      // HIT/MISS を明示追跡（perf ログで可視化するためインライン展開）
      const cached = await activeCache.get<ProgressCached>(key);
      progressHit = cached !== null;
      if (cached) {
        progressFindMs = Date.now() - t;
        return cached;
      }
      // MISS: DB から全フィールド取得してキャッシュに保存
      console.log(`[cache] progress MISS userId=${userId.slice(0, 8)} workId=${work.id.slice(0, 8)}`);
      const r = await prisma.userProgress.findUnique({
        where: { lineUserId_workId: { lineUserId: userId, workId: work.id } },
      });
      progressFindMs = Date.now() - t;
      if (r) await activeCache.set(key, r, TTL.PROGRESS);
      return r ?? null;
    })(),
  ]);
  const globalCmd = matchGlobalCmdInMemory(cachedCmds, text);

  // ─ 自由入力受付モード (free text input) ─
  //
  //  仕様:
  //    - progress.waitingForInput が立っているなら、ユーザーの生入力を variables に保存し
  //      freeInputNextMessageId で指定された次メッセージを送信して return する
  //    - 通常のキーワード判定 / フェーズ遷移はスキップする (= 名前入力等で誤反応させない)
  //    - リセット / 「はじめる」/ 「つづきから」系は上で既に処理済みなので、ここには到達しない
  //
  //  保存先:
  //    - UserProgress.variables (JSON 文字列、最終的に Record<string, string>)
  //    - UserProgress.waitingForInput は受付後 null にクリア
  //
  //  次メッセージ送信時:
  //    - vars.userVariables に最新の variables を渡し、本文の {key} を展開する
  if (progress?.waitingForInput) {
    const waiting = safeParseWaitingForInput(progress.waitingForInput);
    if (waiting) {
      // ── QR タップ検出 (free_input 横取り防止) ─
      //
      // LINE の Quick Reply は action=message の場合、ユーザーが QR をタップすると
      // label がそのまま text メッセージとして webhook に届く。
      // waitingForInput が立っている状態でこれが起きると、free_input ハンドラが
      // QR タップを「自由入力の回答」として誤受領し、本来の QR action
      // (response_message_id / target_message_id / target_phase_id) が発火しない。
      //
      // ここで先に現在 phase の matchQrItem を評価し、ユーザー text が active な
      // QR にマッチするなら waitingForInput をクリアしてフォールスルー
      // (後段の matchedQrItem パス line 1983 で再評価される)。
      //
      // 注: ここで currentPhase を取得するが、後段 line 1880 の getCachedPhase は
      // 同一キャッシュキーを引くため DB ラウンドトリップは発生しない (cache HIT)。
      if (progress.currentPhaseId) {
        const earlyPhase = await getCachedPhase(progress.currentPhaseId);
        const earlyQrMatched = earlyPhase
          ? matchQrItem(earlyPhase, text, parseFrontier(progress.lastSentMessageIds), { oaId: oa.id, workId: work.id, userId })
          : null;
        if (earlyQrMatched !== null) {
          console.log(
            `[diag][qr] free_input skip — QR tap detected`,
            `userId=${userId.slice(0, 8)}`,
            `promptMessageId=${waiting.messageId.slice(0, 8)}`,
            `response_message_id=${earlyQrMatched.response_message_id?.slice(0, 8) ?? "none"}`,
            `target_type=${earlyQrMatched.target_type ?? "none"}`,
            `target_message_id=${earlyQrMatched.target_message_id?.slice(0, 8) ?? "none"}`,
            `target_phase_id=${earlyQrMatched.target_phase_id?.slice(0, 8) ?? "none"}`,
          );
          try {
            await prisma.userProgress.update({
              where: { id: progress.id },
              data:  { waitingForInput: null, lastInteractedAt: new Date() },
            });
            await activeCache.delete(CACHE_KEY.progress(userId, work.id));
            // フォールスルー後の参照も整合させる (= 後段で再度 progress.waitingForInput を見る箇所への安全策)
            (progress as { waitingForInput: string | null }).waitingForInput = null;
          } catch (err) {
            console.error(`[Webhook][free-input] waitingForInput クリア失敗 (QR fall through)`, err);
          }
          // ↓ return せず、後段 (globalCmd / startTrigger / matchedQrItem / keyword) にフォールスルー
        } else {
          // QR にマッチしなければ既存 free_input フローに進む (下の if-else)
        }
      }

      // QR タップでなければ既存 free_input フローを実行
      // (progress.waitingForInput が上で null にクリアされた場合は読み飛ばす)
      if (!progress.waitingForInput) {
        // QR fallthrough 済み → 後段へ
      } else {
      // 診断ログ（挙動変更なし）: ここで text は「自由入力の回答」として消費され、
      //   triggerKeyword 照合より前に return する（QR 一致ではなく自由入力扱い）。
      console.log(
        `[line-webhook:trigger-debug] reason=waiting_for_input_consumed`,
        `userId=${userId?.slice(0, 8) ?? "-"}`,
        `currentPhaseId=${progress.currentPhaseId?.slice(0, 8) ?? "-"}`,
        `promptMessageId=${waiting.messageId?.slice(0, 8) ?? "-"}`,
        `variableKey=${waiting.variableKey ?? "(none)"}`,
        `nextMessageId=${waiting.nextMessageId?.slice(0, 8) ?? "(none)"}`,
        `text="${text.slice(0, 60)}"`,
      );
      const currentVars = safeParseVariables(progress.variables);
      // variableKey が null/空 のときは variables に保存しない (= ログ用途・差し込み不要)。
      // ただし waitingForInput はクリアし、nextMessage は送信する。
      const nextVars = waiting.variableKey
        ? { ...currentVars, [waiting.variableKey]: text }
        : currentVars;
      const shouldUpdateVars = waiting.variableKey !== null;

      // DB 更新: variables を上書き (key が指定されている場合のみ)、waitingForInput をクリア
      try {
        await prisma.userProgress.update({
          where: { id: progress.id },
          data: {
            ...(shouldUpdateVars && { variables: JSON.stringify(nextVars) }),
            waitingForInput:  null,
            lastInteractedAt: new Date(),
          },
        });
        await activeCache.delete(CACHE_KEY.progress(userId, work.id));
      } catch (err) {
        console.error(`[Webhook][free-input] DB 更新失敗 userId=${userId} err=`, err);
        // 失敗しても LINE に応答は返したいので fallthrough しない (= 静かに ack)
      }

      console.log(
        `[Webhook][free-input] 受付完了`,
        `userId=${userId.slice(0, 8)}`,
        `key=${waiting.variableKey ?? "(none/log-only)"}`,
        `value="${text.slice(0, 40)}"`,
        `nextMessageId=${waiting.nextMessageId?.slice(0, 8) ?? "(none)"}`,
      );

      // 次メッセージを送信 (freeInputNextMessageId が指定されている場合)
      if (waiting.nextMessageId) {
        const nextMsg = await prisma.message.findUnique({
          where: { id: waiting.nextMessageId, isActive: true },
          select: {
            id: true, messageType: true, body: true, assetUrl: true,
            assetPreviewUrl: true, assetUsage: true,
            altText: true, flexPayloadJson: true, quickReplies: true,
            nextMessageId: true, sortOrder: true,
            // 問題のヒント QR 合成用（自由入力の次メッセージが puzzle のとき対応）
            kind: true, hintMode: true, incorrectQuickReplies: true,
            imageActionType: true, imageActionText: true, imageActionUrl: true,
            imageActionLiffPageId: true, imageActionPostbackData: true,
            // 自由入力受付フラグ (buildMessageChain で chain walk 停止判定に使う)
            freeInputEnabled: true,
            // 演出設定 (Phase 2c)
            lagMs: true,
            readReceiptMode: true, readDelayMs: true,
            typingEnabled: true, typingMinMs: true, typingMaxMs: true,
            loadingEnabled: true, loadingThresholdMs: true,
            loadingMinSeconds: true, loadingMaxSeconds: true,
            character: { select: { name: true, iconImageUrl: true } },
          },
        });
        if (nextMsg) {
          const replyVars: import("@/lib/line").PlaceholderVars = {
            ...vars,
            userVariables: nextVars,
          };
          const { messages: chain, chainIds } = await buildMessageChain(nextMsg, replyVars);
          if (chain.length > 0) {
            // Phase 2c hotfix: chain (= length > 1) でも per-message timing が効くよう
            // replyWithLagToLine に統一。
            await replyWithLagToLine(replyToken, chain, userId, token);
            // 連鎖した nextMessage の末尾も freeInputEnabled の対象にする
            await applyFreeInputPostEffect({
              sentMessageIds: chainIds,
              oaId: oa.id,
              route: "free_input_next",
              userId,
              workId:    work.id,
              progressId: progress?.id,
            });
            return;
          }
          console.warn(
            `[Webhook][free-input] nextMessage の変換が 0 件 userId=${userId.slice(0, 8)}`,
            `nextMessageId=${waiting.nextMessageId.slice(0, 8)}`,
          );
        } else {
          console.warn(
            `[Webhook][free-input] nextMessage が見つからない userId=${userId.slice(0, 8)}`,
            `nextMessageId=${waiting.nextMessageId.slice(0, 8)}`,
          );
        }
      }

      // nextMessage 未設定 / 取得失敗時のフォールバック: 静かに ack を返す
      await replyToLine(
        replyToken,
        [{ type: "text", text: "ありがとうございます。" }],
        token,
      );
      return;
      } // close: else (QR fallthrough 未該当 = 既存 free_input フロー)
    }
    // safeParseWaitingForInput が null を返した = JSON 不正。フォールスルーして通常処理に。
    console.warn(`[Webhook][free-input] waitingForInput JSON が不正 userId=${userId.slice(0, 8)} — フォールスルーします`);
  }

  // ─ globalCmd 判定（最優先）─
  if (globalCmd) {
    console.log(
      `[Webhook][global] コマンドマッチ`,
      `keyword="${globalCmd.keyword}"`,
      `action_type="${globalCmd.actionType}"`,
      `userId=${userId}`,
    );
    await handleGlobalCommand({ oa, work, systemSender, userId, replyToken, vars, command: globalCmd });
    return;
  }

  // ─ startTrigger 照合 ─
  //
  //  β仕様: startTrigger に一致したら progress をリセットして最初から開始。
  //  未開始・進行中・エンディング到達済みいずれの状態でも同じ挙動。
  //  優先順位: startTrigger > triggerKeyword > transition
  //
  if (startPhaseForTrigger?.startTrigger) {
    const triggerNorm  = normKw(startPhaseForTrigger.startTrigger);
    const triggerLoose = normKwLoose(startPhaseForTrigger.startTrigger);
    const triggerBare  = normKwBare(startPhaseForTrigger.startTrigger);
    const inputNorm    = normKw(text);
    const inputLoose   = normKwLoose(text);
    const inputBare    = normKwBare(text);

    if (inputNorm === triggerNorm || inputLoose === triggerLoose || inputBare === triggerBare) {
      console.log(
        `[Webhook][STEP] startTrigger マッチ`,
        `trigger="${startPhaseForTrigger.startTrigger}"`,
        `userId=${userId}`,
      );

      // 途中離脱ユーザーには即リセットせず「再開 or やり直し」の選択肢を提示する（共通ヘルパ）。
      // resumeEnabled=false / 未開始 / エンディング到達済みは選択肢を出さず、通常の startTrigger 処理
      // （= 最初からやり直す）に進む（undefined は従来挙動 = true 扱い）。
      if (await maybeOfferResumeChoice({ oa, work, systemSender, replyToken }, progress)) {
        console.log(
          `[Webhook][STEP] 途中離脱ユーザー検出 → 再開選択肢を提示`,
          `currentPhaseId=${progress?.currentPhaseId}`,
          `userId=${userId}`,
        );
        return;
      }

      // 未開始 / エンディング到達済み / resumeEnabled=false → 通常の startTrigger 処理（リセット + 開始）
      await handleStartTrigger({
        oa, work, systemSender, userId, replyToken, vars,
        startPhase: startPhaseForTrigger,
      });
      return;
    } else {
      console.log(
        `[Webhook][STEP] startTrigger 不一致`,
        `trigger="${startPhaseForTrigger.startTrigger}"`,
        `input="${text}"`,
        `normMatch=${inputNorm === triggerNorm}`,
        `looseMatch=${inputLoose === triggerLoose}`,
        `bareMatch=${inputBare === triggerBare}`,
      );
    }
  }

  console.log(`[Webhook][STEP] progress取得後 found=${!!progress} reachedEnding=${progress?.reachedEnding ?? "-"} currentPhaseId=${progress?.currentPhaseId ?? "-"}`);

  // ─ 未開始 → β 自動開始 ─
  if (!progress) {
    console.log(`[Webhook][STEP] 未開始ユーザー → 自動開始 userId=${userId}`);
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // ─ エンディング到達済み + 開始意図 → 再スタート（最優先・phase ロード前）─
  //   #243/案A: 開始意図以外のテキストはここで即 return せず、currentPhase + matchedQrItem を
  //   算出した後に判定する。ending 内でも frontier スコープの QR ナビゲーション（E→D 等）だけは
  //   許可したいため（reachedEnding 短絡で QR が評価されない不具合の対応）。
  if (progress.reachedEnding && isStartIntent(text)) {
    console.log(`[Webhook][STEP] エンディング到達済み + 開始意図あり → handleStart userId=${userId}`);
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // ─ 現在フェーズなし（異常状態） ─
  if (!progress.currentPhaseId) {
    console.log(`[Webhook][STEP] メッセージ送信前 (currentPhaseIdなし) userId=${userId}`);
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
    return;
  }

  // ─ currentPhase(cache) + globalKw(cache) を取得し、hint/kw/puzzle をインメモリ照合 ─
  //   キャッシュ HIT 時: DB クエリ 0。MISS 時: 2 クエリ並列（旧: 4 クエリ並列）。
  phaseHit = (await activeCache.get(CACHE_KEY.phase(progress.currentPhaseId))) !== null;
  const [currentPhase, globalKwMsgs] = await Promise.all([
    getCachedPhase(progress.currentPhaseId),
    getCachedGlobalKeywords(work.id),
  ]);

  // 診断ログ（挙動変更なし）: 照合実行前の context。原因 B(候補外)/C(ending)/D(waiting)/E(sheets) の切り分け基点。
  console.log(
    `[line-webhook:trigger-debug] reason=context_resolved`,
    `userId=${userId?.slice(0, 8) ?? "-"}`,
    `currentPhaseId=${progress.currentPhaseId?.slice(0, 8) ?? "-"}`,
    `currentPhaseLoaded=${!!currentPhase}`,
    `reachedEnding=${!!progress.reachedEnding}`,
    `waitingForInput=${!!progress.waitingForInput}`,
    `globalKwMsgs=${globalKwMsgs.length}`,
    `text="${text.slice(0, 60)}"`,
  );

  // フラグを早期に解析（解決済みパズル判定に使用）
  const currentFlags    = safeParseFlags(progress.flags);
  const solvedPuzzleIds = Array.isArray(currentFlags.solvedPuzzles)
    ? (currentFlags.solvedPuzzles as string[])
    : [];

  // ユーザーセグメントを進行状態から導出
  // ここに到達するユーザーは progress あり・reachedEnding=false 確定なので常に "in_progress"
  // 将来のリプレイ対応に備えて progress.reachedEnding から明示的に導出しておく
  const userSegment = (progress.reachedEnding ? "completed" : "in_progress") as
    "not_started" | "in_progress" | "completed";

  // DB クエリなしでインメモリ照合
  const hintResult     = currentPhase ? matchHintFromPhase(currentPhase, text, { oaId: oa.id, workId: work.id })          : null;
  const matchedQrItem  = currentPhase ? matchQrItem(currentPhase, text, parseFrontier(progress.lastSentMessageIds), { oaId: oa.id, workId: work.id, userId }) : null;
  const keywordMatched = currentPhase ? matchKeywordsInMemory(currentPhase.messages, globalKwMsgs, text)                 : [];
  const puzzleResult   = currentPhase ? matchPuzzleFromPhase(currentPhase, text, solvedPuzzleIds, userSegment)           : null;

  // QR マッチ時の送信処理（response_message / target_message / target_phase）。
  // 通常フローと「ending 到達後の frontier QR ナビ（案A）」、および postback（action=quick_reply）で
  // 共通の deliverQrBranch を共用し重複を避ける。送信できれば true、フォールスルー時は false。
  const deliverMatchedQr = (matchedQrItem: import("@/types").QuickReplyItem): Promise<boolean> =>
    deliverQrBranch({ matchedQrItem, oa, work, progress, systemSender, userId, replyToken, token, vars, startedAt: t0e });

  // triggerKeyword 応答の送信を共通化（通常フロー / reachedEnding 例外 で再利用し、照合・送信ロジックの二重化を避ける）。
  // 送信できたら true（呼び出し側は return）、変換結果 0 件でフォールスルーなら false（Transition へ）。
  // ℹ️ キーワード返答は userProgress の進行（currentPhaseId / reachedEnding）を変えない。
  //    applyFreeInputPostEffect が frontier / 自由入力 / 応答メッセージ側の明示 auto-transition のみ反映する。
  const deliverKeywordMatched = async (
    matched: (KeywordMessageRecord & { triggerKeyword: string })[],
  ): Promise<boolean> => {
    if (matched.length === 0) return false;
    console.log(
      `[Webhook][STEP] triggerKeyword マッチ`,
      `userId=${userId}`,
      `messages=${matched.length}件`,
      matched.map((m) => `id=${m.id.slice(0, 8)} kw="${m.triggerKeyword}" body="${(m.body ?? "").slice(0, 20)}"`).join(" / ")
    );
    // nextMessageId チェーンを展開してすべてのメッセージをまとめて返信する
    const chainedMsgs: import("@/lib/line").LineMessage[] = [];
    const chainedIds: string[] = [];
    for (const match of matched) {
      const { messages: chain, chainIds } = await buildMessageChain(match, vars);
      chainedMsgs.push(...chain);
      chainedIds.push(...chainIds);
    }
    const msgs = chainedMsgs.length > 0 ? chainedMsgs : buildKeywordMessages(matched, systemSender, vars);
    const sentIdsForFreeInput = chainedMsgs.length > 0 ? chainedIds : matched.map((m) => m.id);
    console.log(
      `[line-webhook:trigger-debug] reason=keyword_matched`,
      `userId=${userId?.slice(0, 8) ?? "-"}`,
      `currentPhaseId=${progress.currentPhaseId?.slice(0, 8) ?? "-"}`,
      `matchedIds=[${matched.map((m) => m.id.slice(0, 8)).join(",")}]`,
      `matchedKw=[${matched.map((m) => `"${m.triggerKeyword.replace(/\n/g, "\\n")}"`).join(",")}]`,
      `plannedMsgs=${msgs.length} transport=reply(replyWithLagToLine)`,
    );
    if (msgs.length === 0) return false; // 変換結果 0 件（画像URLなし等）→ 呼び出し側で Transition へフォールバック

    // ── キーワード応答後の後続 auto-send（フェーズ入場 / puzzle 正解後と同じ挙動） ──
    // buildMessageChain は nextMessageId チェーンしか辿らないため、同一フェーズ・表示順で後ろにある
    // 独立 head（別の吹き出し）が送られなかった。matchPuzzleFromPhase 正解後の drain（下記 4500 台）と
    // 同じく drainAutoSendableItems で「応答メッセージの sortOrder より後」の auto-sendable を続けて送る。
    //   - response/hint/別 triggerKeyword/QR分岐先/セグメント不一致 puzzle は isAutoSendableMessageNode で除外。
    //   - puzzle / QR 末尾 / trigger は requiresUserInteraction で停止。別フェーズは phase-local なので対象外。
    //   - reachedEnding では通常 auto-send を抑止する既存仕様に合わせ drain しない。
    //   - 対象は「現在フェーズに属する」matched のみ（global keyword は phase drain の起点にしない）。
    //   - 応答メッセージ（またはそのチェーン末尾）が quick_reply を持つ場合はユーザー選択待ちのため後続を送らない
    //     （＝ 実機の QR 停止仕様。moveQuickReplyToTail 後の最終吹き出しに QR が付く）。
    if (currentPhase && !progress.reachedEnding) {
      const responseAwaitsSelection = msgs.some((m) => !!(m as { quickReply?: unknown }).quickReply);
      const inPhaseSortOrders = matched
        .map((m) => currentPhase.messages.find((pm) => pm.id === m.id)?.sortOrder)
        .filter((s): s is number => typeof s === "number");
      const followups = drainKeywordResponseFollowups(
        currentPhase.messages, inPhaseSortOrders, userSegment, responseAwaitsSelection,
      );
      if (followups.length > 0) {
        const continuationPhase: import("@/types").RuntimePhase = {
          id:          currentPhase.id,
          phase_type:  currentPhase.phaseType as import("@/types").PhaseType,
          name:        currentPhase.name,
          description: currentPhase.description,
          messages:    followups,
          transitions: null, // 継続送信では遷移 QR を付けない（puzzle 正解後 drain と同仕様）
        };
        const followupLineMsgs = buildPhaseMessages(continuationPhase, { systemSender, vars });
        if (followupLineMsgs.length > 0) {
          console.log(
            `[Webhook][keyword] 応答後の自動連続送信 followups=${followups.length}件`,
            followups.map((m) => `id=${m.id.slice(0, 8)} type=${m.message_type} sort=${m.sort_order}`).join(" / "),
          );
          msgs.push(...followupLineMsgs);
        }
      }
    }

    // 複数 match の chain を concat した後・followup を push した後は、QR が末尾以外の吹き出しに
    // 残る可能性がある（LINE は最終メッセージの quickReply のみ表示）。最終 msgs 全体で末尾へ集約する。
    // buildKeywordMessages 内でも chain 単位で moveQuickReplyToTail 済みだが、concat/followup を跨いだ
    // 集約はここでしか行えない（＝ 応答末尾の「分かった」QR が実機で出ない事象の保険）。
    moveQuickReplyToTail(msgs);

    // 診断ログ（PII なし）: 実送信 payload の各メッセージに quickReply が付いているか・item のラベル/action。
    // 「CMS プレビューには QR が出るが実機に出ない」調査用。keyword 応答経路で QR が落ちていないか可視化する。
    console.info("[line:kw:qr-diag]", JSON.stringify({
      userIdPrefix: userId?.slice(0, 8) ?? null,
      count: msgs.length,
      messages: msgs.map((m, i) => {
        const qr = (m as { quickReply?: { items?: { action?: { type?: string; label?: string; data?: string } }[] } }).quickReply;
        return {
          i,
          type: (m as { type?: string }).type ?? null,
          hasQuickReply: !!qr,
          qrItems: qr?.items?.map((it) => ({ action: it.action?.type ?? null, label: it.action?.label ?? null })) ?? null,
          isLast: i === msgs.length - 1,
        };
      }),
    }));

    const tReplyKw = Date.now();
    // Phase 2c hotfix: chain (= length > 1) で per-message timing が効くよう replyWithLagToLine に統一
    await replyWithLagToLine(replyToken, msgs, userId, token);
    // 自由入力受付モード: チェーン展開後の全送信メッセージから freeInputEnabled を検出する。
    await applyFreeInputPostEffect({
      sentMessageIds: sentIdsForFreeInput,
      oaId: oa.id,
      route: "keyword",
      userId,
      workId:    work.id,
      progressId: progress?.id,
    });
    console.log(
      `[perf][event] path=keyword total=${Date.now() - t0e}ms` +
      ` progress=${progressHit ? "HIT" : "MISS"}:${progressFindMs}ms` +
      ` phase=${phaseHit ? "hit" : "miss"}` +
      ` reply:${Date.now() - tReplyKw}ms`,
    );
    return true;
  };

  // ─ エンディング到達済み（startIntent は phase ロード前に処理済み）─
  //   案A: frontier がある場合のみ matchedQrItem を評価し、ending 内 QR ナビ（E→D 等）だけ許可する。
  //   frontier=null（レガシー/空）や無関係テキストは従来どおり無視し、
  //   hint / keyword / puzzle / transition には進めない（reachedEnding の意味を維持）。
  if (progress.reachedEnding) {
    const endingFrontier = parseFrontier(progress.lastSentMessageIds);
    if (endingFrontier && matchedQrItem && (await deliverMatchedQr(matchedQrItem))) {
      console.log(`[Webhook][STEP] エンディング到達済み + frontier QR ナビ実行 userId=${userId}`);
      return;
    }
    // ── 案2: reachedEnding でも「現在(ending)フェーズ内の kind=response 応答キーワード一致」だけは応答を許可 ──
    //   スコープを厳格に限定する:
    //     - 既存 keyword 照合(matchKeywordsInMemory・同じ正規化)の結果 keywordMatched を再利用。
    //     - そのうち「現在の currentPhase に属し」かつ「kind=response」のメッセージだけを対象にする。
    //       → global keyword / 他フェーズ / kind=normal は対象外（従来どおり無視）。
    //   応答は進行状態を変えない（reachedEnding は維持）。応答メッセージ側に明示 auto-transition があれば既存仕様に従う。
    const endingResponseMatched = currentPhase
      ? keywordMatched.filter((m) =>
          currentPhase.messages.some((pm) => pm.id === m.id && pm.kind === "response"))
      : [];
    if (endingResponseMatched.length > 0 && (await deliverKeywordMatched(endingResponseMatched))) {
      console.log(
        `[Webhook][STEP] エンディング到達済み + 現在フェーズ応答キーワード実行`,
        `userId=${userId}`,
        `currentPhaseId=${progress.currentPhaseId?.slice(0, 8) ?? "-"}`,
        `matchedIds=[${endingResponseMatched.map((m) => m.id.slice(0, 8)).join(",")}]`,
      );
      return;
    }
    console.log(`[Webhook][STEP] エンディング到達済み → 無視 userId=${userId} text="${text.slice(0, 40)}"`);
    // 診断ログ（挙動変更なし）: reachedEnding により frontier QR ナビ以外のテキストを無視（triggerKeyword 照合に進まない）。
    console.log(
      `[line-webhook:trigger-debug] reason=reached_ending_ignore_text`,
      `userId=${userId?.slice(0, 8) ?? "-"}`,
      `currentPhaseId=${progress.currentPhaseId?.slice(0, 8) ?? "-"}`,
      `reachedEnding=true`,
      `hasFrontier=${!!endingFrontier} matchedQrItem=${!!matchedQrItem}`,
      `text="${text.slice(0, 60)}"`,
    );
    return;
  }

  if (!currentPhase) {
    console.log(`[Webhook][STEP] メッセージ送信前 (currentPhaseなし) userId=${userId}`);
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
    return;
  }

  // ─ hint quickReply 照合（最優先）─
  // ℹ️ ヒント返答は進行状態（currentPhaseId / reachedEnding）を変えない。
  //    ただしヒント使用率の集計のため、初回タップ時のみ flags.hint_used = true をセットする。
  if (hintResult !== null) {
    console.log(`[Webhook][STEP] hint quickReply マッチ userId=${userId} hintText="${hintResult.hintText.slice(0, 40)}"`);

    // ヒント使用フラグを flags に記録（初回のみ書き込み。レスポンス遅延を避けるため fire-and-forget）
    if (!currentFlags.hint_used) {
      const newFlagsWithHint = applySetFlags(currentFlags, '{"hint_used": true}');
      prisma.userProgress.update({
        where: { id: progress.id },
        data:  { flags: JSON.stringify(newFlagsWithHint) },
      }).catch((e) => console.warn("[Webhook] hint_used flag update failed:", e));
    }

    // ヒント話者を解決する（hint_character_id が設定されていればそのキャラクター、なければ systemSender）
    const hintCharId = (hintResult.matchedItem as { hint_character_id?: string | null }).hint_character_id;
    let hintSender = systemSender;
    if (hintCharId) {
      const hintChar = await getCachedCharacter(hintCharId);
      if (hintChar) hintSender = buildSenderFromCharacter(hintChar);
    }

    // 表示順（resolveHintItems と同順）のヒント並び + matchedIndex を求め、共通ヘルパで組み立てる。
    // legacy（旧テキスト QR タップ）経路だが、返答後の「さらにヒント」「問題に戻る」はいずれも postback 化され、
    // 以降の解決はラベル非依存になる（同名ヒントを持つ別問題への混線を防ぐ）。
    const displayHints = hintResult.qrItems.filter((i) => i.action === "hint" && i.enabled !== false);
    const matchedIndex = displayHints.indexOf(hintResult.matchedItem);
    const hintMsgs = composeHintMessages({
      sourceMessageId: hintResult.messageId,
      displayHints,
      matchedIndex:    matchedIndex >= 0 ? matchedIndex : 0,
      sender:          hintSender,
    });

    const tReplyHint = Date.now();
    await replyToLine(replyToken, hintMsgs, token);
    console.log(
      `[perf][event] path=hint total=${Date.now() - t0e}ms` +
      ` progress=${progressHit ? "HIT" : "MISS"}:${progressFindMs}ms` +
      ` phase=${phaseHit ? "hit" : "miss"}` +
      ` reply:${Date.now() - tReplyHint}ms`,
    );
    return;
  }

  // ─ 統合 QR アイテム処理（ヒント照合の次）─
  //
  //  QR タップ時の処理フロー:
  //    Step 1 — ユーザー入力として QR ラベルを送信（LINE が自動で行う）
  //    Step 2 — response_message_id が設定されていれば応答メッセージを返す
  //    Step 3 — target_message_id / target_phase_id が設定されていれば遷移先へ進む
  //
  // QR マッチ時は共通の deliverMatchedQr で送信（ending 内ナビと処理を共用）。
  // 送信できれば終了、フォールスルー（qrMsgs 空）時のみ keyword/transition へ進む。
  if (matchedQrItem !== null) {
    if (await deliverMatchedQr(matchedQrItem)) return;
  }

  // ─ 画像タップ「メッセージを送信する＋フェーズ遷移」照合 ─
  //   画像タップは制作者が配置した明示 UI アクション。hint/QR の後・通常キーワード/謎/transition の前に評価し、
  //   現在フェーズ内の画像 message_with_phase の image_action_text と一致したら image_action_phase_id へ遷移する。
  //   ※ 同一テキストを手入力した場合も一致しうる（仕様）。作品外/他フェーズの画像には反応しない。
  if (currentPhase) {
    const imgPhaseMatch = matchImageMessagePhaseTransition(currentPhase, text);
    if (imgPhaseMatch) {
      try {
        const toPhaseRow = await getCachedPhase(imgPhaseMatch.targetPhaseId);
        if (toPhaseRow) {
          const isEnding = toPhaseRow.phaseType === "ending";
          const updated  = await prisma.userProgress.update({
            where: { id: progress.id },
            data: { currentPhaseId: imgPhaseMatch.targetPhaseId, reachedEnding: isEnding, lastInteractedAt: new Date() },
          });
          await setCachedProgress(updated);
          fireResumeCompletedIfApplicable(updated, oa.id);
          const state     = await buildRuntimeState(updated, toPhaseRow);
          const phaseMsgs = buildPhaseMessages(state.phase, { systemSender, vars });
          const phaseMessageIds = state.phase?.messages.map((m) => m.id) ?? [];
          console.log(`[Webhook][STEP] 画像 message_with_phase マッチ → phase 遷移 userId=${userId} msgId=${imgPhaseMatch.messageId.slice(0, 8)} → phase=${imgPhaseMatch.targetPhaseId.slice(0, 8)}`);
          await replyWithLagToLine(replyToken, phaseMsgs, userId, token);
          await applyFreeInputPostEffect({
            sentMessageIds: phaseMessageIds,
            oaId: oa.id, route: "image_message_with_phase", userId, workId: work.id, progressId: updated.id,
          });
          void switchRichMenuForUser(oa, userId, toPhaseRow.phaseType);
          return;
        }
        console.warn(`[Webhook] 画像 message_with_phase: 遷移先フェーズ未取得 phase=${imgPhaseMatch.targetPhaseId.slice(0, 8)} → フォールスルー`);
      } catch (e) {
        console.warn("[Webhook] 画像 message_with_phase 遷移エラー:", e);
        // フォールバック: 通常フローへ
      }
    }
  }

  // ─ ヒント導線「問題に戻る」message action フォールバック（回答判定より前）─
  //   新規 QR は postback（messageId 付き）で正確に戻すが、デプロイ前にチャット履歴へ送られた
  //   旧テキスト QR「問題に戻る」をタップしたケースの互換として、ここでも処理する。
  //   複数問題が同じラベルのときは frontier（直近送信）で「直前に出題された問題」に絞り、
  //   特定できなければ先頭固定にせず通常フローへ流す（誤った問題を再表示しない）。
  //   不正解・回数加算・遷移・push は一切行わない。
  if (currentPhase) {
    const backMatch = matchBackToPuzzle(
      currentPhase.messages as unknown as import("@/lib/hint-back-to-puzzle").BackToPuzzleCandidate[],
      text,
      { strict: normKw, loose: normKwLoose },
      parseFrontier(progress.lastSentMessageIds) ?? undefined,
    );
    if (backMatch) {
      try {
        if (await reshowPuzzleById({ messageId: backMatch.messageId, workId: work.id, replyToken, userId, channelAccessToken: token, vars })) {
          console.log(`[Webhook][STEP] ヒント「問題に戻る」(text fallback) → 問題再表示 userId=${userId} msgId=${backMatch.messageId.slice(0, 8)} label="${backMatch.cancelLabel}"`);
          return;
        }
        console.warn(`[Webhook] 「問題に戻る」: 問題メッセージ再構築不可 msgId=${backMatch.messageId.slice(0, 8)} → フォールスルー`);
      } catch (e) {
        console.warn("[Webhook] 「問題に戻る」処理エラー:", e);
        // フォールバック: 通常フローへ
      }
    }
  }

  // ─ triggerKeyword 照合 ─
  // ℹ️ キーワード返答は userProgress を更新しない（進行状態に影響しない）。
  //    送信ロジックは deliverKeywordMatched に共通化（reachedEnding 例外と同一経路）。
  if (keywordMatched.length > 0) {
    if (await deliverKeywordMatched(keywordMatched)) return;
    // メッセージ変換結果が 0 件（画像URLなどが無い）の場合は Transition へフォールバック
  }

  // ─ パズル照合 ─
  if (puzzleResult !== null) {
    if (puzzleResult.type === "correct") {
      await handlePuzzleCorrect({
        oa, work, systemSender, userId, replyToken, vars,
        progress,
        puzzle: puzzleResult.puzzle,
        currentPhase,
      });
    } else {
      // ℹ️ パズル不正解は userProgress を更新しない（フェーズを進めない）
      const incorrectMsg = puzzleResult.incorrectText?.trim()
        ?? "答えが違います。もう一度考えてみてください。";
      // 不正解時クイックリプライ（設定されていれば添付）
      let incorrectQr: ReturnType<typeof buildQuickReplyFromItems> | undefined;
      if (puzzleResult.incorrectQuickReplies) {
        try {
          const qrItems = JSON.parse(puzzleResult.incorrectQuickReplies);
          if (Array.isArray(qrItems) && qrItems.length > 0) {
            // always モードの不正解ヒント QR は postback 化（messageId + hintIndex で解決・ラベル非依存）。
            //   → 同名ヒントの問題が複数あっても、表示中ヒント（puzzles[0]）のヒントへ正しく解決する。
            //   on_wrong モードは resolveHintItems が hint を表示しない（quickReplies 由来）ため postback 不可。
            //   その場合は legacy（message action）のまま matchHintFromPhase に委ねる。
            incorrectQr = buildQuickReplyFromItems(
              qrItems,
              (puzzleResult.messageId && puzzleResult.hintMode !== "on_wrong")
                ? { sourceMessageId: puzzleResult.messageId }
                : undefined,
            );
          }
        } catch {
          console.warn("[Webhook][puzzle] incorrectQuickReplies JSON parse error");
        }
      }
      // on_wrong モード: 不正解時にヒント QR を追加
      if (puzzleResult.hintMode === "on_wrong" && puzzleResult.hintQrItems) {
        try {
          const allQrItems = JSON.parse(puzzleResult.hintQrItems) as import("@/types").QuickReplyItem[];
          const hintOnlyItems = allQrItems.filter((i) => i.action === "hint" && i.enabled !== false);
          if (hintOnlyItems.length > 0) {
            // 既存の incorrectQr と hint アイテムをマージ
            let existingItems: import("@/types").QuickReplyItem[] = [];
            if (puzzleResult.incorrectQuickReplies) {
              try { existingItems = JSON.parse(puzzleResult.incorrectQuickReplies); } catch { /* ignore */ }
            }
            const mergedItems = [...existingItems, ...hintOnlyItems];
            incorrectQr = buildQuickReplyFromItems(mergedItems);
          }
        } catch {
          console.warn("[Webhook][puzzle] on_wrong hintQrItems parse error");
        }
      }
      // 不正解メッセージの話者: incorrectCharacterId → 問題本文 characterId → systemSender。
      const incorrectSender = await resolvePuzzleSender(
        puzzleResult.incorrectCharacterId,
        puzzleResult.characterId,
        systemSender,
      );
      const tReplyPuzzle = Date.now();
      await replyToLine(replyToken, [{
        type:        "text",
        text:        incorrectMsg,
        sender:      incorrectSender,
        ...(incorrectQr && { quickReply: incorrectQr }),
      }], token);
      console.log(
        `[perf][event] path=puzzle_incorrect total=${Date.now() - t0e}ms` +
        ` progress=${progressHit ? "HIT" : "MISS"}:${progressFindMs}ms` +
        ` phase=${phaseHit ? "hit" : "miss"}` +
        ` reply:${Date.now() - tReplyPuzzle}ms`,
      );
    }
    return;
  }

  // ── [transition] 診断ログ ──
  console.log(
    `[Webhook][transition] currentPhaseId=${progress.currentPhaseId}`,
    `input="${text}"`,
    `candidates=${currentPhase.transitionsFrom.length}件`,
  );
  for (const t of currentPhase.transitionsFrom) {
    console.log(
      `[Webhook][transition]   candidate`,
      `id=${t.id.slice(0, 8)}`,
      `label="${t.label}"`,
      `condition=${t.condition ? `"${t.condition}"` : "なし"}`,
      `flagCondition=${t.flagCondition ? `"${t.flagCondition}"` : "なし"}`,
      `toPhaseId=${t.toPhaseId.slice(0, 8)}`,
      `isActive=${t.isActive}`,
    );
  }

  const matched = matchTransition(currentPhase.transitionsFrom, {
    label: text,
    flags: currentFlags,
  });

  if (matched) {
    console.log(
      `[Webhook][transition] matched ✓`,
      `label="${matched.label}"`,
      `toPhaseId=${matched.toPhaseId.slice(0, 8)}`,
    );
  } else {
    const inputNormDbg = text.trim().toLowerCase().normalize("NFKC");
    console.log(
      `[Webhook][transition] not matched ✗`,
      `inputNorm="${inputNormDbg}"`,
      `labelNorms=[${currentPhase.transitionsFrom.map((t) => `"${t.label.trim().toLowerCase().normalize("NFKC")}"`).join(", ")}]`,
    );
  }

  // ─ マッチなし → 無視（制作者定義の fallback に委ねる） ─
  if (!matched) {
    console.log(`[Webhook][STEP] マッチなし → 無視 userId=${userId}`);
    return;
  }

  // ─ 遷移先フェーズへ移動 + setFlags を適用 ─
  // transitionsFrom に toPhase を include 済みのため追加クエリ不要
  const toPhaseRef = matched.toPhase;
  const isEnding   = toPhaseRef.phaseType === "ending";
  const newFlags   = applySetFlags(currentFlags, matched.setFlags);

  console.log(`[Webhook][STEP] progress更新 + 遷移先phase取得（並列） progressId=${progress.id} toPhaseId=${toPhaseRef.id}`);

  // progress 更新と遷移先フェーズのメッセージ取得を並列発行（フェーズはキャッシュ優先）
  const [updated, toPhaseRow] = await Promise.all([
    (async () => {
      const t = Date.now();
      const r = await prisma.userProgress.update({
        where: { id: progress.id },
        data: {
          currentPhaseId:   toPhaseRef.id,
          reachedEnding:    isEnding,
          flags:            JSON.stringify(newFlags),
          lastInteractedAt: new Date(),
        },
      });
      progressUpdateMs = Date.now() - t;
      return r;
    })(),
    getCachedPhase(toPhaseRef.id),
  ]);

  // write-through: 更新後の progress をキャッシュに反映（次の read が最新値を返すため）
  await setCachedProgress(updated);
  fireResumeCompletedIfApplicable(updated, oa.id);

  // プリフェッチ済みフェーズを渡すことで buildRuntimeState の追加クエリを省略
  const state = await buildRuntimeState(updated, toPhaseRow);
  const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
  console.log(`[Webhook][STEP] メッセージ送信前 (遷移後) msgs件数=${msgs.length} userId=${userId}`);
  const tReply = Date.now();
  await replyWithLagToLine(replyToken, msgs, userId, token);
  // 遷移後フェーズメッセージの末尾も自由入力候補にする
  const transitionSentIds = state.phase?.messages.map((m) => m.id) ?? [];
  if (transitionSentIds.length > 0) {
    await applyFreeInputPostEffect({
      sentMessageIds: transitionSentIds,
      oaId: oa.id,
      route: "transition",
      userId,
      workId:    work.id,
      progressId: updated.id,
    });
  }
  console.log(
    `[perf][event] path=transition total=${Date.now() - t0e}ms` +
    ` progress=${progressHit ? "HIT" : "MISS"}:${progressFindMs}ms` +
    ` phase=${phaseHit ? "hit" : "miss"}` +
    (progressUpdateMs >= 0 ? ` update:${progressUpdateMs}ms` : "") +
    ` reply:${Date.now() - tReply}ms`,
  );

  // リッチメニュー切り替えは返信後にバックグラウンド実行（体感速度に影響しない）
  void switchRichMenuForUser(oa, userId, toPhaseRef.phaseType);
}

// ──────────────────────────────────────────────────────────
// postback イベント処理（リッチメニューアクション）
// ──────────────────────────────────────────────────────────

async function handlePostbackEvent({
  oa, work, systemSender, userId, data, replyToken, vars,
}: HandlerCommon & { data: string }) {
  // ── URLSearchParams 形式の postback（例: action=resume_work&workId=...&mode=resume）──
  const params = new URLSearchParams(data);

  // ヒント「問題に戻る」postback: 出題中の問題を再表示する（回答判定に流さない＝不正解にしない）。
  //   data="action=hint_back_to_puzzle&messageId=<出題中の問題 messageId>"。
  //   不正解・回数加算・履歴・遷移・push は一切行わない（reshowPuzzleById = reply のみ・kind=puzzle のみ）。
  const backToPuzzle = parseBackToPuzzlePostback(data);
  if (backToPuzzle) {
    if (work) {
      try {
        if (await reshowPuzzleById({ messageId: backToPuzzle.messageId, workId: work.id, replyToken, userId, channelAccessToken: oa.channelAccessToken, vars })) {
          console.log(`[Webhook][STEP] postback hint_back_to_puzzle → 問題再表示 userId=${userId} msgId=${backToPuzzle.messageId.slice(0, 8)}`);
          return;
        }
        console.warn(`[Webhook] hint_back_to_puzzle: 問題メッセージ再構築不可/非問題 msgId=${backToPuzzle.messageId.slice(0, 8)}`);
      } catch (e) {
        console.warn("[Webhook] hint_back_to_puzzle postback エラー:", e);
      }
    } else {
      console.warn(`[Webhook] hint_back_to_puzzle: work 未解決 data="${data}"`);
    }
    return;
  }

  // ── 問題ヒント postback（puzzle_hint）: data="action=puzzle_hint&messageId=<問題>&hintIndex=<n>"。
  //   同一フェーズに同名ヒントの問題が複数あっても、messageId + hintIndex で「タップ元の問題のヒント」を返す。
  //   ラベル一致に依存しない。reply のみ・誤答カウント/履歴/遷移/push なし。範囲外/非問題は安全に無視。
  const puzzleHint = parsePuzzleHintPostback(data);
  if (puzzleHint) {
    if (work) {
      try {
        if (await sendPuzzleHintById({
          messageId: puzzleHint.messageId, hintIndex: puzzleHint.hintIndex,
          workId: work.id, replyToken, userId, channelAccessToken: oa.channelAccessToken, systemSender,
        })) {
          console.log(`[Webhook][STEP] postback puzzle_hint → ヒント返答 userId=${userId} msgId=${puzzleHint.messageId.slice(0, 8)} idx=${puzzleHint.hintIndex}`);
          return;
        }
        console.warn(`[Webhook] puzzle_hint: ヒント解決不可（非問題/範囲外/不存在）msgId=${puzzleHint.messageId.slice(0, 8)} idx=${puzzleHint.hintIndex}`);
      } catch (e) {
        console.warn("[Webhook] puzzle_hint postback エラー:", e);
      }
    } else {
      console.warn(`[Webhook] puzzle_hint: work 未解決 data="${data}"`);
    }
    return;
  }

  // ── 通常 QR postback（quick_reply）: data="action=quick_reply&sourceMessageId=<元msg>&qrIndex=<n>"。
  //   同一フェーズに同名 QR（「次へ」等）が複数あっても、sourceMessageId + qrIndex で「タップ元 QR」を
  //   特定し、その QR に紐づく送信先（target_message_id / response_message_id / target_phase_id）へ送る。
  //   ラベル一致（matchQrItem）に依存しない。不正 data / 元 message 不存在 / 範囲外 / 送信先なしは安全に無視。
  const qrPostback = parseQuickReplyPostback(data);
  if (qrPostback) {
    if (!work) {
      console.warn(`[Webhook] quick_reply: work 未解決 data="${data}"`);
      return;
    }
    try {
      const progress = await getCachedProgress(userId, work.id);

      // ── frontier ガード（text 経路 matchQrItem と同じく「現在地の QR のみ有効」）──
      //   過去 LINE 履歴上の古いボタン（B 表示後の A の「次へ」等）の再タップは無視する。
      //   frontier=null（レガシー progress）なら従来どおり全体許可（後方互換）。
      //   現在表示中の QR（例 B）は frontier に含まれるため B→C は通る。
      const frontier = parseFrontier(progress?.lastSentMessageIds);
      if (frontier && !frontier.has(qrPostback.sourceMessageId)) {
        console.log(
          `[Webhook] quick_reply: frontier 外の古い QR を無視`,
          `userId=${userId.slice(0, 8)} srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)} idx=${qrPostback.qrIndex}`,
        );
        return;
      }

      // 防御的に workId スコープで元 message を取得（他 work の message を解決しない・puzzle_hint 系と同思想）。
      const srcMsg = await prisma.message.findFirst({
        where: { id: qrPostback.sourceMessageId, workId: work.id, isActive: true },
        select: { id: true, kind: true, hintMode: true, quickReplies: true, incorrectQuickReplies: true },
      });
      if (!srcMsg) {
        console.warn(`[Webhook] quick_reply: 元 message 不存在/非active/別work srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)}`);
        return;
      }
      const item = resolveQuickReplyItem(srcMsg, qrPostback.qrIndex);
      if (!item) {
        console.warn(`[Webhook] quick_reply: QR 解決不可（範囲外/disabled/送信先なし）srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)} idx=${qrPostback.qrIndex}`);
        return;
      }

      // ── 自由入力受付中の QR タップ（free_input 横取り防止・text 経路と同型）──
      //   freeInputEnabled プロンプトに付いた送信先付き QR をタップした場合、QR の送信先へ進む前に
      //   waitingForInput をクリアする。残すと次のユーザー通常テキストが旧プロンプトの自由入力回答として
      //   誤消費される（リグレッション防止）。新しい送信先 chain に free-input があれば
      //   deliverQrBranch 内の applyFreeInputPostEffect が改めて waitingForInput を立て直す。
      if (progress?.waitingForInput) {
        try {
          await prisma.userProgress.update({
            where: { id: progress.id },
            data:  { waitingForInput: null, lastInteractedAt: new Date() },
          });
          await activeCache.delete(CACHE_KEY.progress(userId, work.id));
          // フォールスルー後の参照整合（deliverQrBranch に渡す progress も同期）。
          (progress as { waitingForInput: string | null }).waitingForInput = null;
          console.log(`[diag][qr] free_input skip — quick_reply postback tap userId=${userId.slice(0, 8)} srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)}`);
        } catch (err) {
          console.error(`[Webhook][free-input] waitingForInput クリア失敗 (quick_reply postback)`, err);
        }
      }

      const delivered = await deliverQrBranch({
        matchedQrItem: item, oa, work, progress,
        systemSender, userId, replyToken, token: oa.channelAccessToken, vars,
        startedAt: Date.now(),
      });
      if (delivered) {
        console.log(`[Webhook][STEP] postback quick_reply → 送信先へ送信 userId=${userId} srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)} idx=${qrPostback.qrIndex}`);
      } else {
        console.warn(`[Webhook] quick_reply: 送信先解決できず（qrMsgs 空）srcMsgId=${qrPostback.sourceMessageId.slice(0, 8)} idx=${qrPostback.qrIndex}`);
      }
    } catch (e) {
      console.warn("[Webhook] quick_reply postback エラー:", e);
    }
    return;
  }

  if (params.get("action") === "resume_work") {
    const mode   = params.get("mode");
    const wid    = params.get("workId");
    if ((mode === "resume" || mode === "restart") && wid && work && work.id === wid) {
      // resumeEnabled=false の作品では再開選択肢を出さない方針のため、
      // 万一 stale な resume postback が届いても "resume" を "restart"（最初から）に倒す。
      // action=resume_work は ON 時のみ意味を持つ、という仕様に揃える。
      const effectiveMode = work.resumeEnabled === false ? "restart" : mode;
      await handleResumeChoice({ oa, work, systemSender, userId, replyToken, vars, mode: effectiveMode });
      return;
    }
    // workId 不一致や不正パラメータは無視してログのみ
    console.warn(`[Webhook] resume_work postback: パラメータ不正 data="${data}"`);
    return;
  }

  switch (data) {
    case RICHMENU_ACTIONS.START: {
      if (!work) {
        await replyToLine(replyToken, [{
          type:   "text",
          text:   "現在、公開中のシナリオはありません。しばらくお待ちください。",
          sender: systemSender,
        }], oa.channelAccessToken);
        return;
      }
      // リッチメニュー「START」: 途中離脱ユーザーには再開選択肢を提示（RESET は明示リセットのため対象外）。
      const progressForStart = await getCachedProgress(userId, work.id);
      if (await maybeOfferResumeChoice({ oa, work, systemSender, replyToken }, progressForStart)) break;
      await handleStart({ oa, work, systemSender, userId, replyToken, vars });
      break;
    }
    case RICHMENU_ACTIONS.RESET:
      if (!work) {
        await replyToLine(replyToken, [{
          type:   "text",
          text:   "現在、公開中のシナリオはありません。しばらくお待ちください。",
          sender: systemSender,
        }], oa.channelAccessToken);
        return;
      }
      // 明示リセット: 途中再開の選択肢は出さず、常に最初から開始。
      await handleStart({ oa, work, systemSender, userId, replyToken, vars });
      break;

    case RICHMENU_ACTIONS.CONTINUE:
      await handleContinue({ oa, work, systemSender, userId, replyToken, vars });
      break;

    default:
      // 未知の postback data は無視（ログのみ）
      console.info(`[Webhook] 未知の postback data: "${data}" oaId=${oa.id}`);
  }
}

// ─ シナリオ（再）開始 ─────────────────────────────────────
async function handleStart({
  oa, work, systemSender, userId, replyToken, vars,
}: Omit<HandlerCommon, "work"> & { work: NonNullable<WorkRecord> }) {
  const token = oa.channelAccessToken;

  const tStart = Date.now();
  console.log(`[Webhook][STEP] handleStart: startPhase取得前 workId=${work.id} userId=${userId}`);
  const startPhase = await getCachedStartPhase(work.id);
  console.log(`[perf][handleStart/startPhase] ${Date.now() - tStart}ms found=${!!startPhase}`);

  if (!startPhase) {
    console.log(`[Webhook][STEP] メッセージ送信前 (startPhaseなし) userId=${userId}`);
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "まだシナリオの準備中です。もうしばらくお待ちください。",
      sender: systemSender,
    }], token);
    return;
  }

  // progress upsert と startPhase のメッセージ取得を並列発行（フェーズはキャッシュ優先）
  const tUpsert = Date.now();
  const [progress, startPhaseRow] = await Promise.all([
    prisma.userProgress.upsert({
      where: {
        lineUserId_workId: { lineUserId: userId, workId: work.id },
      },
      create: {
        lineUserId:       userId,
        workId:           work.id,
        currentPhaseId:   startPhase.id,
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
      },
      update: {
        currentPhaseId:   startPhase.id,
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
      },
    }),
    getCachedPhase(startPhase.id),
  ]);
  console.log(`[perf][handleStart/upsert+phaseRow] ${Date.now() - tUpsert}ms progressId=${progress.id}`);

  // write-through: upsert 後の progress をキャッシュに反映
  await setCachedProgress(progress);

  // プリフェッチ済みフェーズを渡すことで buildRuntimeState の追加クエリを省略
  const state = await buildRuntimeState(progress, startPhaseRow);

  // ── デバッグ: phase 内容とトランジションを詳細出力 ──
  if (state.phase) {
    console.log(
      `[Webhook][DEBUG] startPhase詳細`,
      `phaseId=${state.phase.id}`,
      `phaseType=${state.phase.phase_type}`,
      `messages件数=${state.phase.messages.length}`,
      `transitions=${state.phase.transitions === null ? "null(ending)" : `${state.phase.transitions.length}件`}`
    );
    // メッセージ内容（先頭40文字）
    for (const m of state.phase.messages) {
      console.log(
        `[Webhook][DEBUG]   msg id=${m.id.slice(0, 8)}`,
        `type=${m.message_type}`,
        `sortOrder=${m.sort_order}`,
        `body="${(m.body ?? "").slice(0, 40)}"`
      );
    }
    // 遷移一覧
    if (state.phase.transitions && state.phase.transitions.length > 0) {
      for (const t of state.phase.transitions) {
        console.log(
          `[Webhook][DEBUG]   transition label="${t.label}"`,
          `→ toPhase="${t.to_phase.name}"(${t.to_phase.phase_type})`,
          `sortOrder=${t.sort_order}`
        );
      }
    } else if (state.phase.transitions !== null) {
      console.warn(
        `[Webhook][DEBUG] ⚠️ transitions=[] — startPhaseに有効な遷移がありません。`,
        `管理画面でstartPhaseに遷移（次のフェーズへのボタン）を追加してください。`
      );
    }
  } else {
    console.warn(`[Webhook][DEBUG] buildRuntimeState が phase=null を返しました progressId=${progress.id}`);
  }

  const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
  console.log(
    `[Webhook][STEP] メッセージ送信前 (開始) msgs件数=${msgs.length} userId=${userId}`,
    msgs.map((m, i) => `[${i}]type=${m.type} text="${"text" in m ? String(m.text ?? "").slice(0, 30) : "(non-text)"}"`).join(" / ")
  );
  const tReplyStart = Date.now();
  await replyWithLagToLine(replyToken, msgs, userId, token);
  // startPhase のメッセージも自由入力候補に含める
  const startSentIds = state.phase?.messages.map((m) => m.id) ?? [];
  if (startSentIds.length > 0) {
    await applyFreeInputPostEffect({
      sentMessageIds: startSentIds,
      oaId: oa.id,
      route: "start",
      userId,
      workId:    work.id,
      progressId: progress.id,
    });
  }
  console.log(`[perf][handleStart/reply] ${Date.now() - tReplyStart}ms total=${Date.now() - tStart}ms`);

  // リッチメニュー切り替えは返信後にバックグラウンド実行
  void switchRichMenuForUser(oa, userId, startPhase.phaseType);
}

// ─ start フェーズトリガー発火時の開始処理 ────────────────────
//
// Phase.startTrigger が設定された startPhase に対して未開始ユーザーが
// トリガーキーワードを送信した場合に呼ばれる。
//
// 処理フロー:
//   1. progress を startPhase.id（序章）にリセット／作成
//   2. visible_phase に対応したリッチメニューへ切り替え
//   3. startPhase に紐づく kind="start" メッセージを送信（開始演出として機能）
//      kind="start" が 0 件の場合は startPhase の通常メッセージへフォールバック
//   ※ ユーザーが次のメッセージを送ると matchTransition で startPhase の遷移が発火する
//
type StartPhaseRecord = {
  id:            string;
  phaseType:     string;
  startTrigger:  string | null;
  resumeSummary: string | null;
};

async function handleStartTrigger({
  oa, work, systemSender, userId, replyToken, vars,
  startPhase,
}: Omit<HandlerCommon, "work"> & {
  work:       NonNullable<WorkRecord>;
  startPhase: StartPhaseRecord;
}) {
  const token  = oa.channelAccessToken;
  const t0st   = Date.now();

  // 初期フェーズの決定:
  //   handleStart と同様に startPhase 自体を初期フェーズとする。
  //   startPhase の遷移（"わかった、助けるよ" → 謎解きパート1 など）は
  //   ユーザーが次のメッセージを送ることで matchTransition によって発火させる。
  //   ※ 以前は firstTransition.toPhaseId へ自動スキップしていたが、
  //      startPhase の遷移が照合されなくなるため廃止。
  const initialPhaseId = startPhase.id;

  console.log(
    `[Webhook][STEP] handleStartTrigger`,
    `userId=${userId}`,
    `initialPhaseId=${initialPhaseId}`,
    `（startPhase.id に留まる）`,
  );

  // ── upsert + kind="start" メッセージ取得を並列発行（キャッシュ優先）──
  const tUpsert = Date.now();
  const [progress, startKindMessages] = await Promise.all([
    prisma.userProgress.upsert({
      where: {
        lineUserId_workId: { lineUserId: userId, workId: work.id },
      },
      create: {
        lineUserId:       userId,
        workId:           work.id,
        currentPhaseId:   initialPhaseId,
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
      },
      update: {
        currentPhaseId:   initialPhaseId,
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
      },
      select: { id: true },
    }),
    getCachedStartMsgs(work.id, startPhase.id),
  ]);
  const upsertMs = Date.now() - tUpsert;
  console.log(
    `[Webhook][STEP] handleStartTrigger: upsert完了 progressId=${progress.id}`,
    `kind="start" msgs=${startKindMessages.length}件 userId=${userId}`,
  );

  // write-through: upsert で設定した状態をキャッシュに書き込む
  // （select: {id} なので合成オブジェクトを作成。タイムスタンプは表示用のみで論理に影響しない）
  const now = new Date();
  const syntheticProgress: ProgressCached = {
    id:               progress.id,
    lineUserId:       userId,
    workId:           work.id,
    currentPhaseId:   initialPhaseId,
    reachedEnding:    false,
    flags:            "{}",
    variables:        "{}",
    waitingForInput:  null,
    lastSentMessageIds: null,
    lastInteractedAt: now,
    isPreview:        false,
    previewBy:        null,
    createdAt:        now,
    updatedAt:        now,
  };
  await setCachedProgress(syntheticProgress);

  if (startKindMessages.length > 0) {
    const tBuild = Date.now();
    const msgs = buildKeywordMessages(startKindMessages, systemSender, vars);
    const buildMs = Date.now() - tBuild;
    if (msgs.length > 0) {
      const tReply = Date.now();
      await replyWithLagToLine(replyToken, msgs, userId, token);
      // kind="start" メッセージも自由入力候補に含める
      await applyFreeInputPostEffect({
        sentMessageIds: startKindMessages.map((m) => m.id),
        oaId: oa.id,
        route: "start_trigger_kind",
        userId,
        workId:    work.id,
        progressId: progress.id,
      });
      console.log(
        `[perf][startTrigger] total=${Date.now() - t0st}ms` +
        ` upsert=${upsertMs}ms build=${buildMs}ms reply=${Date.now() - tReply}ms`,
      );
      // リッチメニュー切り替えは返信後にバックグラウンド実行
      void switchRichMenuForUser(oa, userId, startPhase.phaseType);
      return;
    }
  }

  // kind="start" が 0 件 → startPhase の通常メッセージへフォールバック
  console.log(`[Webhook][STEP] handleStartTrigger: kind=start 0件 → 通常 startPhase メッセージへフォールバック`);
  const tBuildFallback = Date.now();
  const cachedStartPhaseForTrigger = await getCachedPhase(initialPhaseId);
  const state = await buildRuntimeState(syntheticProgress, cachedStartPhaseForTrigger);
  const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
  const buildFallbackMs = Date.now() - tBuildFallback;
  if (msgs.length > 0) {
    const tReply = Date.now();
    await replyWithLagToLine(replyToken, msgs, userId, token);
    // startPhase フォールバックメッセージも自由入力候補に含める
    const startTriggerFallbackIds = state.phase?.messages.map((m) => m.id) ?? [];
    if (startTriggerFallbackIds.length > 0) {
      await applyFreeInputPostEffect({
        sentMessageIds: startTriggerFallbackIds,
        oaId: oa.id,
        route: "start_trigger_fallback",
        userId,
        workId:    work.id,
        progressId: progress.id,
      });
    }
    console.log(
      `[perf][startTrigger] total=${Date.now() - t0st}ms` +
      ` upsert=${upsertMs}ms build=${buildFallbackMs}ms reply=${Date.now() - tReply}ms (fallback)`,
    );
  } else {
    console.log(
      `[perf][startTrigger] total=${Date.now() - t0st}ms` +
      ` upsert=${upsertMs}ms build=${buildFallbackMs}ms reply=0ms (no-msgs)`,
    );
  }
  // リッチメニュー切り替えは返信後にバックグラウンド実行
  void switchRichMenuForUser(oa, userId, startPhase.phaseType);
}

// ─ 現在の進行状態を表示（つづきから）──────────────────────
async function handleContinue({
  oa, work, systemSender, userId, replyToken, vars,
}: HandlerCommon) {
  const token = oa.channelAccessToken;

  if (!work) {
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "現在、公開中のシナリオはありません。しばらくお待ちください。",
      sender: systemSender,
    }], token);
    return;
  }

  const progress = await getCachedProgress(userId, work.id);

  // 未開始 — あいさつメッセージ（設定があれば）＋ startTrigger 開始 quick reply
  // PR-1: あいさつ文は OA 単位優先 + active Work フォールバック（follow 時と一貫）。
  if (!progress) {
    const effWelcome = resolveFollowSettings(oa, work).welcomeMessage;
    const welcomeItems = parseWelcomeMessages(work.welcomeMessagesJson);
    const startTrigger = (await getCachedStartPhase(work.id))?.startTrigger?.trim() || null;
    if (!startTrigger) {
      console.warn(`[Webhook] 未開始あいさつ: startTrigger 未設定 → 開始 quickReply なし workId=${work.id.slice(0, 8)} userId=${userId.slice(0, 8)}`);
    }
    // 送信前の「入力中…」演出（welcomeLoadingSeconds>0 のとき）。reply 一括は維持。
    await applyWelcomeLoading(work.welcomeLoadingSeconds, userId, token);
    await replyToLine(replyToken, buildWelcomeMessages({ ...work, welcomeMessage: effWelcome }, systemSender, startTrigger, welcomeItems), token);
    return;
  }

  // エンディング到達済み → 自動返信なし（シナリオ定義に委ねる）
  if (progress.reachedEnding) {
    return;
  }

  // 現在フェーズを表示（prefix なし）
  const cachedContinuePhase = progress.currentPhaseId
    ? await getCachedPhase(progress.currentPhaseId)
    : null;
  const state = await buildRuntimeState(progress, cachedContinuePhase);
  const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
  await replyWithLagToLine(replyToken, msgs, userId, token);
}

// ─ 途中離脱ユーザーへ再開 or やり直しの選択肢を送る ─────────
//
// LINE postback quick reply で 2 択を提示する。
// タップ後は handlePostbackEvent → handleResumeChoice に引き継がれる。
//
async function sendResumeChoice({
  oa,
  work,
  systemSender,
  replyToken,
  workId,
  currentPhaseId,
}: {
  oa:             OaRecord;
  work:           NonNullable<WorkRecord>;
  systemSender:   LineSender | undefined;
  replyToken:     string;
  workId:         string;
  currentPhaseId: string;
}): Promise<void> {
  // フェーズの resumeSummary 有無を取得（キャッシュ済みのためレイテンシ微小）
  const shownPhase       = await getCachedPhase(currentPhaseId);
  const hasResumeSummary = !!(shownPhase?.resumeSummary?.trim());

  // 計測: 再開選択肢の表示（fire-and-forget）
  logEvent("resume_choice_shown", {
    work_id:            workId,
    current_phase_id:   currentPhaseId,
    has_resume_summary: hasResumeSummary,
  }, { oaId: oa.id }).catch(() => {});

  const quickReply: import("@/lib/line").LineQuickReply = {
    items: [
      {
        type:   "action",
        action: {
          type:        "postback",
          label:       "途中から再開する",
          data:        `action=resume_work&workId=${workId}&mode=resume`,
          displayText: "途中から再開する",
        },
      },
      {
        type:   "action",
        action: {
          type:        "postback",
          label:       "最初からやり直す",
          data:        `action=resume_work&workId=${workId}&mode=restart`,
          displayText: "最初からやり直す",
        },
      },
    ],
  };

  await replyToLine(
    replyToken,
    [{
      type:       "text",
      text:       `「${work.title}」の途中です。どうしますか？`,
      sender:     systemSender,
      quickReply,
    }],
    oa.channelAccessToken,
  );
}

// ─ 再開 / やり直し選択後の処理 ──────────────────────────────
//
//  mode=resume  → 現在フェーズ先頭から再実行。
//                 Phase.resumeSummary が設定されていれば先頭メッセージ前に送信する。
//  mode=restart → startPhase にリセットして最初から開始（handleStartTrigger 委譲）。
//
async function handleResumeChoice({
  oa, work, systemSender, userId, replyToken, vars, mode,
}: Omit<HandlerCommon, "work"> & {
  work: NonNullable<WorkRecord>;
  mode: "resume" | "restart";
}) {
  const token = oa.channelAccessToken;

  // ── やり直し: start フェーズへリセット ──────────────────────
  if (mode === "restart") {
    // 計測: 再開選択 → restart（fire-and-forget）
    // currentPhaseId は postback パラメータから取れないためキャッシュから取得
    getCachedProgress(userId, work.id).then(async (prog) => {
      if (prog?.currentPhaseId) {
        const restartPhase      = await getCachedPhase(prog.currentPhaseId);
        const hasResumeSummary  = !!(restartPhase?.resumeSummary?.trim());
        logEvent("resume_choice_selected", {
          work_id:            work.id,
          current_phase_id:   prog.currentPhaseId,
          mode:               "restart",
          has_resume_summary: hasResumeSummary,
        }, { oaId: oa.id }).catch(() => {});
      }
    }).catch(() => {});

    const startPhase = await getCachedStartPhase(work.id);
    if (!startPhase) {
      await replyToLine(replyToken, [{
        type:   "text",
        text:   "まだシナリオの準備中です。もうしばらくお待ちください。",
        sender: systemSender,
      }], token);
      return;
    }
    await handleStartTrigger({ oa, work, systemSender, userId, replyToken, vars, startPhase });
    return;
  }

  // ── 再開: 現在フェーズ先頭から再実行 ────────────────────────
  const progress = await getCachedProgress(userId, work.id);

  if (!progress || !progress.currentPhaseId) {
    // 進行記録がない場合は通常開始にフォールバック
    await handleStart({ oa, work, systemSender, userId, replyToken, vars });
    return;
  }

  // 計測: 再開選択 → resume（fire-and-forget）
  // has_resume_summary はこの後 getCachedPhase で判明するが、
  // ログ順序を崩さないためフェーズ取得前に非同期で送出する
  const resumePhaseForLog      = await getCachedPhase(progress.currentPhaseId);
  const hasResumeSummaryResume = !!(resumePhaseForLog?.resumeSummary?.trim());
  logEvent("resume_choice_selected", {
    work_id:            work.id,
    current_phase_id:   progress.currentPhaseId,
    mode:               "resume",
    has_resume_summary: hasResumeSummaryResume,
  }, { oaId: oa.id }).catch(() => {});

  // flags に resume_phase_id を記録（完走率計測のため write-through）。
  // エンディング到達時に fireResumeCompletedIfApplicable でこの値を参照する。
  const prevFlags = safeParseFlags(progress.flags);
  const newFlags  = { ...prevFlags, resume_phase_id: progress.currentPhaseId };
  const updatedProgress = await prisma.userProgress.update({
    where: { id: progress.id },
    data:  { flags: JSON.stringify(newFlags), lastInteractedAt: new Date() },
  });
  await setCachedProgress(updatedProgress);

  // resumePhaseForLog で既に取得済み（再度キャッシュ参照するが同一オブジェクト）
  const currentPhase = resumePhaseForLog;
  const outMsgs: import("@/lib/line").LineMessage[] = [];

  // resumeSummary が設定されていれば先頭に挿入（あらすじ・補足）
  if (currentPhase?.resumeSummary?.trim()) {
    outMsgs.push({
      type:   "text",
      text:   currentPhase.resumeSummary.trim(),
      sender: systemSender,
    });
  }

  const state     = await buildRuntimeState(updatedProgress, currentPhase);
  const phaseMsgs = buildPhaseMessages(state.phase, { systemSender, vars });
  outMsgs.push(...phaseMsgs);

  if (outMsgs.length > 0) {
    await replyWithLagToLine(replyToken, outMsgs, userId, token);
  } else {
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
  }
}

// ── 再開後の完走計測ヘルパー ──────────────────────────────────
//
// UserProgress が reachedEnding=true になったとき、
// flags.resume_phase_id が存在すれば resume_completed イベントを発火する。
// 呼び出し元は void で fire-and-forget してよい。
//
function fireResumeCompletedIfApplicable(
  updated: ProgressCached,
  oaId:    string,
): void {
  if (!updated.reachedEnding) return;
  const flags         = safeParseFlags(updated.flags);
  const resumePhaseId = typeof flags.resume_phase_id === "string" ? flags.resume_phase_id : null;
  if (!resumePhaseId) return;

  // Phase の resumeSummary 有無もペイロードに含める（summary 効果の完走率計測のため）
  getCachedPhase(resumePhaseId).then((phase) => {
    logEvent("resume_completed", {
      work_id:               updated.workId,
      resumed_from_phase_id: resumePhaseId,
      has_resume_summary:    !!(phase?.resumeSummary?.trim()),
    }, { oaId }).catch(() => {});
  }).catch(() => {});
}

// ────────────────────────────────────────────────
// トラッキング帰属（follow イベント）
// ────────────────────────────────────────────────

/**
 * follow イベント時: 直近 30 分以内のクリックイベントを探し
 * 最もアクセスが近い tracking を user_trackings に記録する。
 * （ヒューリスティック帰属 — LIFF 未使用時のベストエフォート）
 */
async function attributeFollowToTracking(
  oaId:       string,
  lineUserId: string,
): Promise<void> {
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000); // 30 分前

    // この OA に紐づくすべての tracking_id を取得
    const trackings = await prisma.tracking.findMany({
      where: { oaId },
      select: { trackingId: true },
    });
    if (trackings.length === 0) return;

    const tids = trackings.map((t) => t.trackingId);

    // 直近のクリックイベントを 1 件取得
    const latestClick = await prisma.trackingEvent.findFirst({
      where: {
        trackingId: { in: tids },
        clickedAt:  { gte: since },
      },
      orderBy: { clickedAt: "desc" },
    });
    if (!latestClick) return;

    // user_trackings に upsert（同一ユーザーは最新クリックで上書き）
    await prisma.userTracking.upsert({
      where:  { oaId_lineUserId: { oaId, lineUserId } },
      create: { oaId, lineUserId, trackingId: latestClick.trackingId },
      update: { trackingId: latestClick.trackingId, createdAt: new Date() },
    });

    console.info(
      `[Webhook] follow 帰属: userId=${lineUserId} → trackingId=${latestClick.trackingId}`
    );
  } catch (e) {
    console.warn("[Webhook] トラッキング帰属エラー:", e);
  }
}

// ──────────────────────────────────────────────────────────
// グローバルコマンド
// ──────────────────────────────────────────────────────────

type GlobalCommandRecord = {
  id:         string;
  keyword:    string;
  actionType: string;
  payload:    string | null;
};

/**
 * OA に登録されたグローバルコマンドとユーザー入力を照合する。
 * - NFKC 正規化 + 末尾句読点ゆるい比較の両方を試みる
 * - sortOrder 昇順で最初にマッチしたコマンドを返す
 */
async function findGlobalCommand(
  oaId:      string,
  inputText: string,
): Promise<GlobalCommandRecord | null> {
  const commands = await prisma.globalCommand.findMany({
    where:   { oaId, isActive: true },
    select:  { id: true, keyword: true, actionType: true, payload: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (commands.length === 0) return null;

  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);

  for (const cmd of commands) {
    const kwNorm  = normKw(cmd.keyword);
    const kwLoose = normKwLoose(cmd.keyword);
    if (inputNorm === kwNorm || inputLoose === kwLoose) {
      return cmd;
    }
  }
  return null;
}

/**
 * グローバルコマンドを実行する。
 *
 * HINT   — 現在フェーズのパズルヒントを返す（未設定なら payload / デフォルト文）
 * RESET  — progress をリセットして最初から開始
 * HELP   — payload に設定したガイドテキスト（未設定はデフォルト文）を返す
 * REPEAT — 現在フェーズのメッセージを再送（handleContinue と同等）
 * CUSTOM — payload のテキストを返す
 */
async function handleGlobalCommand({
  oa, work, systemSender, userId, replyToken, vars, command,
}: HandlerCommon & { command: GlobalCommandRecord }) {
  const token = oa.channelAccessToken;

  switch (command.actionType) {
    // ── RESET: progress をリセットして最初から ──
    case "RESET": {
      if (!work) break;
      await handleStart({ oa, work, systemSender, userId, replyToken, vars });
      return;
    }

    // ── HELP: ガイドテキストを返す ──
    case "HELP": {
      const helpText = command.payload?.trim() ||
        "【ヘルプ】\n「ヒント」→ ヒントを表示\n「やめる」→ 最初からやり直し\n「もう一度」→ メッセージ再送";
      await replyToLine(replyToken, [{
        type: "text", text: helpText, sender: systemSender,
      }], token);
      return;
    }

    // ── REPEAT: 現在フェーズのメッセージを再送 ──
    case "REPEAT": {
      if (!work) break;
      const progress = await getCachedProgress(userId, work.id);
      if (!progress) {
        await handleStart({ oa, work, systemSender, userId, replyToken, vars });
        return;
      }
      const cachedRepeatPhase = progress.currentPhaseId
        ? await getCachedPhase(progress.currentPhaseId)
        : null;
      const state = await buildRuntimeState(progress, cachedRepeatPhase);
      const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
      if (msgs.length > 0) {
        await replyWithLagToLine(replyToken, msgs, userId, token);
      } else {
        await replyToLine(replyToken, [{
          type: "text",
          text: "現在のメッセージを再送できませんでした。「はじめる」でスタートしてください。",
          sender: systemSender,
        }], token);
      }
      return;
    }

    // ── HINT: 現在フェーズのパズルヒントを返す ──
    case "HINT": {
      if (!work) break;
      const progress = await getCachedProgress(userId, work.id);
      if (!progress?.currentPhaseId) {
        await replyToLine(replyToken, [{
          type: "text",
          text: "現在進行中のシナリオがありません。「はじめる」と送ってスタートしてください。",
          sender: systemSender,
        }], token);
        return;
      }
      // 現在フェーズのパズルメッセージからヒントテキストを取得（キャッシュ利用）
      const cachedHintPhase = await getCachedPhase(progress.currentPhaseId);
      const puzzleMsg = cachedHintPhase?.messages.find(
        (m) => m.kind === "puzzle" && m.puzzleHintText !== null,
      ) ?? null;
      const hintText =
        puzzleMsg?.puzzleHintText?.trim() ||
        command.payload?.trim() ||
        "このフェーズにはヒントが設定されていません。";
      console.log(
        `[Webhook][global/HINT] phaseId=${progress.currentPhaseId}`,
        `hint="${hintText.slice(0, 40)}"`,
      );
      await replyToLine(replyToken, [{
        type: "text", text: hintText, sender: systemSender,
      }], token);
      return;
    }

    // ── CUSTOM: payload テキストをそのまま返す ──
    case "CUSTOM": {
      const customText = command.payload?.trim();
      if (customText) {
        await replyToLine(replyToken, [{
          type: "text", text: customText, sender: systemSender,
        }], token);
        return;
      }
      break;
    }
  }

  // フォールバック（CUSTOM に payload がない等）
  await replyToLine(replyToken, [{
    type: "text",
    text: "このコマンドは現在利用できません。",
    sender: systemSender,
  }], token);
}

// ──────────────────────────────────────────────────────────
// triggerKeyword 照合
// ──────────────────────────────────────────────────────────

/**
 * テキスト入力を正規化する（前後空白除去 + NFKC 全角→半角）
 */
function normKw(s: string): string {
  return s.trim().normalize("NFKC");
}

/**
 * 末尾の句読点・感嘆符・疑問符を除去した「ゆるい」正規化
 * 例: "既読無視しないで。" → "既読無視しないで"
 */
function normKwLoose(s: string): string {
  return normKw(s).replace(/[。！？!?．…\s]+$/u, "").trimEnd();
}

/**
 * 括弧類をすべて除去した「最ゆるい」正規化。
 * リッチメニューの message テキストと DB startTrigger の括弧ズレを吸収する。
 */
function normKwBare(s: string): string {
  return normKwLoose(s).replace(/[「」『』【】（）()""'']/gu, "");
}

// ──────────────────────────────────────────────────────────
// ヒント quickReply 照合
// ──────────────────────────────────────────────────────────

/**
 * 現在フェーズのメッセージに設定された action="hint" quick reply と
 * ユーザー入力テキストを照合する。
 *
 * マッチ判定:
 *   - item.value（省略時は item.label）を normKw で正規化して比較
 *   - NFKC 正規化 + 末尾句読点ゆるい比較の両方を試みる
 *
 * @returns マッチした hint_text（設定済み）、"ヒントはまだ設定されていません"（hint_text 未設定）、null（マッチなし）
 */
async function matchHintQuickReply(
  workId:         string,
  currentPhaseId: string,
  inputText:      string,
): Promise<{ hintText: string; hintFollowup?: string; qrItems: import("@/types").QuickReplyItem[] } | null> {
  // 現在フェーズのアクティブなメッセージの quickReplies を取得
  const messages = await prisma.message.findMany({
    where: {
      workId,
      phaseId:  currentPhaseId,
      isActive: true,
      quickReplies: { not: null },
    },
    select: { id: true, quickReplies: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (messages.length === 0) return null;

  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);

  for (const msg of messages) {
    if (!msg.quickReplies) continue;

    let items: import("@/types").QuickReplyItem[];
    try {
      const parsed = JSON.parse(msg.quickReplies);
      if (!Array.isArray(parsed)) continue;
      items = parsed as import("@/types").QuickReplyItem[];
    } catch {
      continue;
    }

    for (const item of items) {
      if (item.action !== "hint") continue;
      if (item.enabled === false) continue; // 無効アイテムはスキップ

      // value と label の両方を照合キーとして試みる（LINE では label がそのまま送信される）
      const keys = [item.value?.trim(), item.label].filter(Boolean) as string[];
      const matched = keys.some(
        (k) => normKw(k) === inputNorm || normKwLoose(k) === inputLoose,
      );

      if (matched) {
        const hintText     = item.hint_text?.trim() || "ヒントはまだ設定されていません。";
        const hintFollowup = item.hint_followup?.trim() || undefined;
        console.log(
          `[Webhook][hint] マッチ msgId=${msg.id.slice(0, 8)}`,
          `key="${item.value ?? item.label}"`,
          `hint_text="${hintText.slice(0, 30)}..."`,
          hintFollowup ? `hint_followup="${hintFollowup.slice(0, 20)}..."` : "",
        );
        return { hintText, hintFollowup, qrItems: items };
      }
    }
  }

  return null; // マッチなし
}

// ──────────────────────────────────────────────────────────
// パズル（謎）照合
// ──────────────────────────────────────────────────────────

type PuzzleRecord = {
  id:                    string;
  answer:                string;
  answers:               string | null;
  answerMatchType:       string | null;
  correctAction:         string | null;
  correctText:           string | null;
  correctCharacterId:    string | null;
  incorrectText:         string | null;
  incorrectCharacterId:  string | null;
  incorrectQuickReplies: string | null;
  correctNextPhaseId:    string | null;
  characterId:           string | null;
};

type PuzzleMatchResult =
  | null                                                                                                    // このフェーズにパズルなし（遷移照合へ進む）
  | { type: "incorrect"; messageId: string | null; incorrectText: string | null; incorrectCharacterId: string | null; characterId: string | null; incorrectQuickReplies: string | null; hintMode: string; hintQrItems: string | null }              // パズルあり・不正解（messageId = 表示中ヒントの紐づく問題 = puzzles[0]）
  | { type: "correct";   puzzle: PuzzleRecord };                                                           // 正解

// 回答照合は @/lib/puzzle-answer に共通化済み（checkPuzzleAnswer / parseAnswerMatchType）。
const parsePuzzleMatchType = parseAnswerMatchType;

/**
 * 現在フェーズのパズルメッセージを照合する。
 * - パズルが 0 件 → null（遷移照合へフォールバック）
 * - パズルあり・正解 → { type:"correct", puzzle }
 * - パズルあり・不正解 → { type:"incorrect", incorrectText }
 */
async function matchPuzzleAnswer(
  workId:      string,
  phaseId:     string,
  inputText:   string,
): Promise<PuzzleMatchResult> {
  const puzzles = await prisma.message.findMany({
    where: {
      workId,
      phaseId,
      kind:     "puzzle",
      isActive: true,
      answer:   { not: null },
    },
    select: {
      id:                    true,
      answer:                true,
      answers:               true,
      answerMatchType:       true,
      correctAction:         true,
      correctText:           true,
      correctCharacterId:    true,
      incorrectText:         true,
      incorrectCharacterId:  true,
      incorrectQuickReplies: true,
      correctNextPhaseId:    true,
      hintMode:              true,
      quickReplies:          true,
      characterId:           true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (puzzles.length === 0) return null; // パズルなし → 遷移照合へ

  for (const puzzle of puzzles) {
    const candidates = resolveAnswerCandidates(puzzle.answer, puzzle.answers);
    if (candidates.length === 0) continue;
    const matchTypes = parsePuzzleMatchType(puzzle.answerMatchType);
    if (checkPuzzleAnswerAny(inputText, candidates, matchTypes)) {
      console.log(
        `[Webhook][puzzle] 正解 puzzleId=${puzzle.id.slice(0, 8)}`,
        `input="${inputText}"`,
        `candidates=${candidates.length}件`,
        `matchTypes=${JSON.stringify(matchTypes)}`,
      );
      return { type: "correct", puzzle: puzzle as PuzzleRecord };
    }
  }

  console.log(
    `[Webhook][puzzle] 不正解 input="${inputText}"`,
    `puzzles=${puzzles.length}件`,
  );
  return {
    type:                  "incorrect",
    messageId:             puzzles[0]?.id ?? null,
    incorrectText:         puzzles[0]?.incorrectText ?? null,
    incorrectCharacterId:  puzzles[0]?.incorrectCharacterId ?? null,
    characterId:           puzzles[0]?.characterId ?? null,
    incorrectQuickReplies: puzzles[0]?.incorrectQuickReplies ?? null,
    hintMode:              puzzles[0]?.hintMode ?? "always",
    hintQrItems:           puzzles[0]?.quickReplies ?? null,
  };
}

/**
 * パズル正解時の処理。
 * correct_action に応じて:
 *   "text"             → correctText を返信するのみ
 *   "transition"       → correctNextPhase へ遷移してフェーズメッセージを返信
 *   "text_and_transition" → correctText ＋ 遷移先フェーズメッセージを一括返信
 */
async function handlePuzzleCorrect({
  oa, work, systemSender, userId, replyToken, vars,
  progress, puzzle, currentPhase,
}: Omit<HandlerCommon, "work"> & {
  work:         NonNullable<WorkRecord>;
  progress:     { id: string; flags: string };
  puzzle:       PuzzleRecord;
  currentPhase: PhaseRow;
}) {
  const token  = oa.channelAccessToken;
  const action = puzzle.correctAction ?? "text";

  // ─ 解決済みパズルを flags に記録（再解答防止）─
  const prevFlags     = safeParseFlags(progress.flags);
  const solvedPuzzles = Array.isArray(prevFlags.solvedPuzzles)
    ? [...(prevFlags.solvedPuzzles as string[])]
    : [];
  if (!solvedPuzzles.includes(puzzle.id)) {
    solvedPuzzles.push(puzzle.id);
  }
  const flagsWithSolved = { ...prevFlags, solvedPuzzles };

  const messagesToSend: import("@/lib/line").LineMessage[] = [];

  // ─ correctText を先頭に追加（text / text_and_transition）─
  // 正解メッセージの話者: correctCharacterId → 問題本文 characterId → systemSender。
  if ((action === "text" || action === "text_and_transition") && puzzle.correctText) {
    const correctSender = await resolvePuzzleSender(puzzle.correctCharacterId, puzzle.characterId, systemSender);
    messagesToSend.push({ type: "text", text: puzzle.correctText, sender: correctSender });
  }

  // ─ フェーズ遷移（transition / text_and_transition）─
  if (action === "transition" || action === "text_and_transition") {
    if (puzzle.correctNextPhaseId) {
      const nextPhase = await getCachedPhase(puzzle.correctNextPhaseId);
      if (nextPhase) {
        const isEnding = nextPhase.phaseType === "ending";
        const updated  = await prisma.userProgress.update({
          where: { id: progress.id },
          data: {
            currentPhaseId:   nextPhase.id,
            reachedEnding:    isEnding,
            flags:            JSON.stringify(flagsWithSolved),
            lastInteractedAt: new Date(),
          },
        });
        // write-through: パズル正解遷移後のキャッシュを更新
        await setCachedProgress(updated);
        fireResumeCompletedIfApplicable(updated, oa.id);
        console.log(
          `[Webhook][puzzle] 遷移 → phaseId=${nextPhase.id.slice(0, 8)}`,
          `phaseType=${nextPhase.phaseType}`,
          `isEnding=${isEnding}`,
        );
        const state     = await buildRuntimeState(updated, nextPhase);
        console.log(
          `[Webhook][puzzle] 遷移先phase messages=${state.phase?.messages.length ?? 0}件`,
          state.phase?.messages.map((m, i) => `[${i}]id=${m.id.slice(0, 8)} kind=${m.kind} type=${m.message_type} body=${m.body ? "あり" : "なし"} sort=${m.sort_order}`).join(" / ") ?? "(null)",
        );
        const nextMsgs  = buildPhaseMessages(state.phase, { systemSender, vars });
        console.log(
          `[Webhook][puzzle] buildPhaseMessages結果=${nextMsgs.length}件`,
          nextMsgs.map((m, i) => `[${i}]type=${m.type}`).join(" / "),
        );
        messagesToSend.push(...nextMsgs);

        // #243 frontier 更新漏れ修正: puzzle 正解で新 phase へ遷移したら、QR target_phase 経路と同様に
        // frontier(lastSentMessageIds) を新 phase の送信 message ids へ更新する。これを行わないと
        // frontier が前 phase のまま stale になり、新 phase の QR が matchQrItem の frontier スコープ外と
        // なって照合されない（正解後に新 phase の QR をタップしても無反応になる）。
        // frontier guard の思想は維持し「正しい現在地」へ更新するのみ（スコープ拡大はしない）。
        await applyFreeInputPostEffect({
          sentMessageIds: state.phase?.messages.map((m) => m.id) ?? [],
          oaId:           oa.id,
          route:          "puzzle_correct_phase",
          userId,
          workId:         work.id,
          progressId:     updated.id,
        });
      } else {
        // correctNextPhaseId が存在するが取得できなかった場合: solved だけ保存
        const updated = await prisma.userProgress.update({
          where: { id: progress.id },
          data: { flags: JSON.stringify(flagsWithSolved), lastInteractedAt: new Date() },
        });
        await setCachedProgress(updated);
        console.warn(`[Webhook][puzzle] correctNextPhaseId=${puzzle.correctNextPhaseId} が見つかりません（solved フラグのみ保存）`);
      }
    } else {
      // correctNextPhaseId 未設定: フェーズ遷移なし。solved フラグのみ保存して再解答を防ぐ
      const updated = await prisma.userProgress.update({
        where: { id: progress.id },
        data: { flags: JSON.stringify(flagsWithSolved), lastInteractedAt: new Date() },
      });
      await setCachedProgress(updated);
      console.warn(`[Webhook][puzzle] correctNextPhaseId 未設定 action=${action}（solved フラグのみ保存）`);
    }
  } else {
    // action = "text": フェーズ遷移なし。solved フラグを保存して再解答を防ぐ
    const updated = await prisma.userProgress.update({
      where: { id: progress.id },
      data: { flags: JSON.stringify(flagsWithSolved), lastInteractedAt: new Date() },
    });
    await setCachedProgress(updated);

    // ─ パズル正解後の自動連続送信（フェーズ遷移なしの場合） ─
    // パズルの sortOrder 以降にある通常メッセージを drainAutoSendableItems で取得し送信する
    const puzzleMsg = currentPhase.messages.find((m) => m.id === puzzle.id);
    if (puzzleMsg) {
      const remaining = drainAutoSendableItems(currentPhase.messages, "in_progress", puzzleMsg.sortOrder);
      if (remaining.length > 0) {
        console.log(
          `[Webhook][puzzle] 正解後の自動連続送信`,
          `remaining=${remaining.length}件`,
          remaining.map((m) => `id=${m.id.slice(0, 8)} type=${m.message_type}`).join(" / "),
        );
        // RuntimePhaseMessage[] → LINE メッセージに変換するため、最小限の RuntimePhase を構築
        const continuationPhase: import("@/types").RuntimePhase = {
          id:          currentPhase.id,
          phase_type:  currentPhase.phaseType as import("@/types").PhaseType,
          name:        currentPhase.name,
          description: currentPhase.description,
          messages:    remaining,
          transitions: null, // 継続送信では遷移 QR を付けない（パズル正解後の自動送信）
        };
        const remainingLineMsgs = buildPhaseMessages(continuationPhase, { systemSender, vars });
        messagesToSend.push(...remainingLineMsgs);
      }
    }
  }

  // ─ フォールバック: メッセージが組み立てられなかった場合 ─
  if (messagesToSend.length === 0) {
    messagesToSend.push({ type: "text", text: "正解！", sender: systemSender });
  }

  console.log(
    `[Webhook][puzzle] 送信 total=${messagesToSend.length}件`,
    messagesToSend.map((m, i) => `[${i}]type=${m.type}`).join(" / "),
  );

  // replyWithLagToLine で送信（1件目を reply、2件目以降を push でラグ付き送信）
  // これにより LINE reply API の 5 件上限を超えるメッセージも全件送信される
  await replyWithLagToLine(replyToken, messagesToSend, userId, token);

  // 遷移が発生した場合のみリッチメニューを切り替え（fire-and-forget、キャッシュ利用）
  if ((puzzle.correctAction === "transition" || puzzle.correctAction === "text_and_transition")
      && puzzle.correctNextPhaseId) {
    void getCachedPhase(puzzle.correctNextPhaseId).then((phaseRow) => {
      if (phaseRow) void switchRichMenuForUser(oa, userId, phaseRow.phaseType);
    });
  }
}

/**
 * ユーザー入力に対して triggerKeyword が一致する Message レコードを返す。
 *
 * 検索範囲:
 *   - phaseId が currentPhaseId に一致する（フェーズ限定キーワード）
 *   - または phaseId が null（全フェーズ共通キーワード）
 *
 * マッチ条件（いずれかを満たせばマッチ）:
 *   1. NFKC 正規化後の完全一致
 *   2. 末尾句読点除去後の完全一致（例: 句点ありキーワード vs 句点なし入力）
 *
 * 返り値: sortOrder 昇順のマッチ済み Message レコード（0件の場合は空配列）
 */
async function matchTriggerKeyword(
  workId:         string,
  currentPhaseId: string | null,
  inputText:      string,
): Promise<(KeywordMessageRecord & { triggerKeyword: string })[]> {
  if (!currentPhaseId) return [];

  // phaseId 一致 または null（全体共通）のキーワード付きメッセージを取得
  // kind="start" は未開始ユーザー専用 / kind="puzzle" はパズル照合で処理するので除外
  const candidates = await prisma.message.findMany({
    where: {
      workId,
      isActive:       true,
      triggerKeyword: { not: null },
      kind:           { notIn: ["start", "puzzle", "system_notice"] },
      OR: [
        { phaseId: currentPhaseId },
        { phaseId: null },
      ],
    },
    select: {
      id:              true,
      phaseId:         true,
      kind:            true,
      triggerKeyword:  true,
      messageType:     true,
      body:            true,
      assetUrl:        true,
      altText:         true,
      flexPayloadJson: true,
      quickReplies:    true,
      nextMessageId:   true,
      sortOrder:       true,
      character: {
        select: { name: true, iconImageUrl: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  console.log(
    `[Webhook][kw] matchTriggerKeyword`,
    `currentPhaseId=${currentPhaseId}`,
    `input="${inputText}"`,
    `candidates=${candidates.length}件`,
  );
  for (const c of candidates) {
    console.log(
      `[Webhook][kw]   candidate`,
      `id=${c.id.slice(0, 8)}`,
      `phaseId=${c.phaseId?.slice(0, 8) ?? "null（全体共通）"}`,
      `kind=${c.kind ?? "-"}`,
      `triggerKeyword="${c.triggerKeyword}"`,
    );
  }

  if (candidates.length === 0) return [];

  const inputNorm  = normKw(inputText);
  const inputLoose = normKwLoose(inputText);

  // マッチしたキーワード文字列を収集（同一キーワードで複数メッセージ可）
  const matchedKeywords = new Set<string>();
  for (const msg of candidates) {
    const kw      = msg.triggerKeyword!;
    const kwNorm  = normKw(kw);
    const kwLoose = normKwLoose(kw);

    if (inputNorm === kwNorm || inputLoose === kwLoose) {
      matchedKeywords.add(kw);
      console.log(
        `[Webhook][kw] マッチ keyword="${kw}"`,
        `input="${inputText}"`,
        `normMatch=${inputNorm === kwNorm}`,
        `looseMatch=${inputLoose === kwLoose}`
      );
    } else {
      console.log(
        `[Webhook][kw] スキップ keyword="${kw}"`,
        `normKw="${kwNorm}" vs inputNorm="${inputNorm}"`,
        `looseKw="${kwLoose}" vs inputLoose="${inputLoose}"`
      );
    }
  }

  if (matchedKeywords.size === 0) return [];

  return candidates.filter(
    (m): m is typeof m & { triggerKeyword: string } =>
      m.triggerKeyword !== null && matchedKeywords.has(m.triggerKeyword)
  );
}
