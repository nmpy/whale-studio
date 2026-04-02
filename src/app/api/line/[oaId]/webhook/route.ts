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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyLineSignature,
  isStartCommand, isResetCommand, isContinueCommand,
  replyToLine, buildPhaseMessages, buildQuickReply, buildKeywordMessages,
  RICHMENU_ACTIONS,
  type LineWebhookBody, type LineEvent, type LineSender, type KeywordMessageRecord,
} from "@/lib/line";
import { buildRuntimeState, matchTransition, applySetFlags, safeParseFlags } from "@/lib/runtime";
import { linkRichMenuToUser } from "@/lib/line-richmenu";
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
    return await handleWebhook(req, params.oaId);
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
  // ── デバッグ: oaId を最初に記録 ──
  console.log(`[Webhook] 受信 oaId=${oaId}`);

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

  // lineOaId で検索（@ 付き・なし両方を試す）
  const oa =
    await prisma.oa.findFirst({ where: { lineOaId: normalizedOaId } }) ??
    await prisma.oa.findFirst({ where: { lineOaId: `@${normalizedOaId}` } });

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

  // ── 5-a. userId をログ出力（開発時の確認用）+ テストモードフィルタリング ──
  const testModeActive = isTestModeActive();

  const textEvents = rawTextEvents.filter((e) => {
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

  // ── 6. Sheets モード: oa.spreadsheetId が設定されている場合は Sheets から読み込む ──
  if (oa.spreadsheetId) {
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

  // デバッグ: OA に紐づく全作品の件数・status を確認
  const allWorks = await prisma.work.findMany({
    where:   { oaId: oa.id },
    select:  { id: true, title: true, publishStatus: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log(
    `[Webhook][DEBUG] work検索 oaId=${oa.id}`,
    `全件数=${allWorks.length}`,
    allWorks.length > 0
      ? allWorks.map((w) => `id=${w.id.slice(0, 8)} title="${w.title}" publishStatus="${w.publishStatus}" sortOrder=${w.sortOrder}`).join(" / ")
      : "(作品なし)"
  );

  const work = await prisma.work.findFirst({
    where:   { oaId: oa.id, publishStatus: "active" },
    orderBy: { sortOrder: "asc" },
    include: {
      systemCharacter: {
        select: { name: true, iconImageUrl: true },
      },
    },
  });
  console.log(
    `[Webhook][DEBUG] activeWork=${work ? `id=${work.id.slice(0, 8)} title="${work.title}"` : "null (active な作品なし)"}`
  );
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

  // ── 6-b. follow 自動開始（β: 友だち追加直後に作品を開始）──
  if (followEvents.length > 0 && work) {
    await Promise.allSettled(
      followEvents.map((e) => {
        console.log(`[Webhook] follow → 自動開始 userId=${e.source.userId}`);
        return handleStart({ oa, work, systemSender, userId: e.source.userId, replyToken: e.replyToken });
      })
    );
  }

  // ── 7. 各イベントを並列処理（エラーが出ても他のイベントに影響させない）──
  await Promise.allSettled([
    // テキストメッセージ
    ...textEvents.map((event) =>
      handleTextEvent({
        oa,
        work:         work ?? null,
        systemSender,
        userId:       event.source.userId,
        text:         event.message.text.trim(),
        replyToken:   event.replyToken,
      })
    ),
    // postback（リッチメニューアクション）
    ...postbackEvents.map((event) =>
      handlePostbackEvent({
        oa,
        work:         work ?? null,
        systemSender,
        userId:       event.source.userId,
        data:         event.postback.data,
        replyToken:   event.replyToken,
      })
    ),
  ]);

  // LINE には常に 200 OK を返す
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
};

type WorkRecord = {
  id: string;
  title: string;
  /** あいさつメッセージ。null のときはシステムデフォルト文を使う */
  welcomeMessage: string | null;
} | null;

// handleTextEvent / handlePostbackEvent / handleStart / handleContinue で共通使用
type HandlerCommon = {
  oa:           OaRecord;
  work:         WorkRecord;
  systemSender: LineSender | undefined;
  userId:       string;
  replyToken:   string;
};

/**
 * 未開始ユーザー向けのあいさつ＋開始案内メッセージを組み立てる。
 * work.welcomeMessage が設定されている場合はそれを先頭に送り、
 * 続けて「はじめる」開始案内を別吹き出しで添える。
 * welcomeMessage が未設定の場合はシステムデフォルト文のみ。
 */
function buildWelcomeMessages(
  work: NonNullable<WorkRecord>,
  systemSender: LineSender | undefined
): import("@/lib/line").LineMessage[] {
  const startHint = `「はじめる」と送ってください。`;

  if (work.welcomeMessage?.trim()) {
    return [
      { type: "text", text: work.welcomeMessage.trim(), sender: systemSender },
      { type: "text", text: startHint,                  sender: systemSender },
    ];
  }

  // フォールバック: welcomeMessage 未設定
  return [{
    type:   "text",
    text:   `「${work.title}」へようこそ。\n準備ができたら「はじめる」と送ってください。`,
    sender: systemSender,
  }];
}

async function handleTextEvent({
  oa,
  work,
  systemSender,
  userId,
  text,
  replyToken,
}: HandlerCommon & { text: string }) {
  const token = oa.channelAccessToken;

  // ─ 公開中の作品がない ─
  if (!work) {
    await replyToLine(replyToken, [{
      type: "text",
      text: "現在、公開中のシナリオはありません。もうしばらくお待ちください。",
    }], token);
    return;
  }

  // ─ 「はじめる」系コマンド → 常に（再）開始 ─
  if (isStartCommand(text)) {
    await handleStart({ oa, work, systemSender, userId, replyToken });
    return;
  }

  // ─ 「リセット」コマンド → 開始と同様にリセット後スタート ─
  if (isResetCommand(text)) {
    await handleStart({ oa, work, systemSender, userId, replyToken });
    return;
  }

  // ─ 「つづきから」コマンド → 現在の進行状態を表示 ─
  if (isContinueCommand(text)) {
    await handleContinue({ oa, work, systemSender, userId, replyToken });
    return;
  }

  // ─ ① グローバルコマンド判定（フェーズ分岐より最優先）─
  const globalCmd = await findGlobalCommand(oa.id, text);
  if (globalCmd) {
    console.log(
      `[Webhook][global] コマンドマッチ`,
      `keyword="${globalCmd.keyword}"`,
      `action_type="${globalCmd.actionType}"`,
      `userId=${userId}`,
    );
    await handleGlobalCommand({ oa, work, systemSender, userId, replyToken, command: globalCmd });
    return;
  }

  // ─ startTrigger 照合（progress の有無に関わらず最優先で評価）─
  //
  //  β仕様: startTrigger に一致したら progress をリセットして最初から開始。
  //  未開始・進行中・エンディング到達済みいずれの状態でも同じ挙動。
  //  優先順位: startTrigger > triggerKeyword > transition
  //
  const startPhaseForTrigger = await prisma.phase.findFirst({
    where:   { workId: work.id, phaseType: "start", isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (startPhaseForTrigger?.startTrigger) {
    const triggerNorm  = normKw(startPhaseForTrigger.startTrigger);
    const triggerLoose = normKwLoose(startPhaseForTrigger.startTrigger);
    const inputNorm    = normKw(text);
    const inputLoose   = normKwLoose(text);

    if (inputNorm === triggerNorm || inputLoose === triggerLoose) {
      console.log(
        `[Webhook][STEP] startTrigger マッチ（progress有無問わず）`,
        `trigger="${startPhaseForTrigger.startTrigger}"`,
        `userId=${userId}`,
      );
      await handleStartTrigger({
        oa, work, systemSender, userId, replyToken,
        startPhase: startPhaseForTrigger,
      });
      return;
    } else {
      console.log(
        `[Webhook][STEP] startTrigger 不一致 trigger="${startPhaseForTrigger.startTrigger}" input="${text}"`,
      );
    }
  }

  // ─ 進行状態を取得 ─
  console.log(`[Webhook][STEP] progress取得前 userId=${userId} workId=${work.id}`);
  const progress = await prisma.userProgress.findUnique({
    where: {
      lineUserId_workId: { lineUserId: userId, workId: work.id },
    },
  });
  console.log(`[Webhook][STEP] progress取得後 found=${!!progress} reachedEnding=${progress?.reachedEnding ?? "-"} currentPhaseId=${progress?.currentPhaseId ?? "-"}`);

  // ─ 未開始 → β 自動開始 ─
  if (!progress) {
    console.log(`[Webhook][STEP] 未開始ユーザー → 自動開始 userId=${userId}`);
    await handleStart({ oa, work, systemSender, userId, replyToken });
    return;
  }

  // ─ エンディング到達済み → 自動返信なし（シナリオ定義に委ねる） ─
  if (progress.reachedEnding) {
    console.log(`[Webhook][STEP] エンディング到達済み → 無視 userId=${userId}`);
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

  // ─ 遷移マッチング ─
  console.log(`[Webhook][STEP] currentPhase取得前 phaseId=${progress.currentPhaseId}`);
  const currentPhase = await prisma.phase.findUnique({
    where:   { id: progress.currentPhaseId },
    include: {
      transitionsFrom: {
        where:   { isActive: true },
        orderBy: [{ sortOrder: "asc" }],
      },
    },
  });
  console.log(`[Webhook][STEP] currentPhase取得後 found=${!!currentPhase} transitions=${currentPhase?.transitionsFrom.length ?? "-"}`);

  if (!currentPhase) {
    console.log(`[Webhook][STEP] メッセージ送信前 (currentPhaseなし) userId=${userId}`);
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
    return;
  }

  // ─ hint quickReply 照合（triggerKeyword より先に評価）─
  const hintResult = await matchHintQuickReply(work.id, progress.currentPhaseId, text);
  if (hintResult !== null) {
    console.log(`[Webhook][STEP] hint quickReply マッチ userId=${userId} hintText="${hintResult.hintText.slice(0, 40)}"`);
    const hintMsgs = [
      { type: "text" as const, text: hintResult.hintText, sender: systemSender },
      ...(hintResult.hintFollowup
        ? [{ type: "text" as const, text: hintResult.hintFollowup, sender: systemSender }]
        : []),
    ];
    await replyToLine(replyToken, hintMsgs, token);
    return;
  }

  // ─ triggerKeyword 照合（フェーズ進行なし・Transition より先に評価）─
  const keywordMatched = await matchTriggerKeyword(work.id, progress.currentPhaseId, text);
  if (keywordMatched.length > 0) {
    console.log(
      `[Webhook][STEP] triggerKeyword マッチ`,
      `userId=${userId}`,
      `messages=${keywordMatched.length}件`,
      keywordMatched.map((m) => `id=${m.id.slice(0, 8)} kw="${m.triggerKeyword}" body="${(m.body ?? "").slice(0, 20)}"`).join(" / ")
    );
    const msgs = buildKeywordMessages(keywordMatched, systemSender);
    if (msgs.length > 0) {
      await replyToLine(replyToken, msgs, token);
      return;
    }
    // メッセージ変換結果が 0 件（画像URLなしなど）の場合は Transition へフォールバック
  }

  // ─ パズル照合（triggerKeyword の後・Transition の前に評価）─
  const puzzleResult = await matchPuzzleAnswer(work.id, progress.currentPhaseId, text);
  if (puzzleResult !== null) {
    if (puzzleResult.type === "correct") {
      await handlePuzzleCorrect({
        oa, work, systemSender, userId, replyToken,
        progress,
        puzzle: puzzleResult.puzzle,
      });
    } else {
      // パズルあり・不正解
      const incorrectMsg = puzzleResult.incorrectText?.trim()
        ?? "答えが違います。もう一度考えてみてください。";
      await replyToLine(replyToken, [{
        type:   "text",
        text:   incorrectMsg,
        sender: systemSender,
      }], token);
    }
    return;
  }

  // ─ 現在の flags を取得してフラグ条件付き遷移マッチング ─
  const currentFlags = safeParseFlags(progress.flags);

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
  console.log(`[Webhook][STEP] 遷移先phase取得前 toPhaseId=${matched.toPhaseId}`);
  const toPhase = await prisma.phase.findUnique({ where: { id: matched.toPhaseId } });
  console.log(`[Webhook][STEP] 遷移先phase取得後 found=${!!toPhase} phaseType=${toPhase?.phaseType ?? "-"}`);
  if (!toPhase) return;

  const isEnding = toPhase.phaseType === "ending";
  const newFlags = applySetFlags(currentFlags, matched.setFlags);

  console.log(`[Webhook][STEP] progress更新前 progressId=${progress.id} toPhaseId=${toPhase.id} isEnding=${isEnding}`);
  const updated = await prisma.userProgress.update({
    where: { id: progress.id },
    data: {
      currentPhaseId:   toPhase.id,
      reachedEnding:    isEnding,
      flags:            JSON.stringify(newFlags),
      lastInteractedAt: new Date(),
    },
  });
  console.log(
    `[Webhook][transition] progress updated`,
    `progressId=${updated.id}`,
    `currentPhaseId=${updated.currentPhaseId}`,
    `reachedEnding=${updated.reachedEnding}`,
  );

  // visible_phase によるリッチメニュー切り替え
  await switchRichMenuForUser(oa, userId, toPhase.phaseType);

  const state = await buildRuntimeState(updated);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  console.log(`[Webhook][STEP] メッセージ送信前 (遷移後) msgs件数=${msgs.length} userId=${userId}`);
  await replyToLine(replyToken, msgs, token);
}

// ──────────────────────────────────────────────────────────
// postback イベント処理（リッチメニューアクション）
// ──────────────────────────────────────────────────────────

async function handlePostbackEvent({
  oa, work, systemSender, userId, data, replyToken,
}: HandlerCommon & { data: string }) {
  switch (data) {
    case RICHMENU_ACTIONS.START:
    case RICHMENU_ACTIONS.RESET:
      if (!work) {
        await replyToLine(replyToken, [{
          type:   "text",
          text:   "現在、公開中のシナリオはありません。しばらくお待ちください。",
          sender: systemSender,
        }], oa.channelAccessToken);
        return;
      }
      await handleStart({ oa, work, systemSender, userId, replyToken });
      break;

    case RICHMENU_ACTIONS.CONTINUE:
      await handleContinue({ oa, work, systemSender, userId, replyToken });
      break;

    default:
      // 未知の postback data は無視（ログのみ）
      console.info(`[Webhook] 未知の postback data: "${data}" oaId=${oa.id}`);
  }
}

// ─ シナリオ（再）開始 ─────────────────────────────────────
async function handleStart({
  oa, work, systemSender, userId, replyToken,
}: Omit<HandlerCommon, "work"> & { work: NonNullable<WorkRecord> }) {
  const token = oa.channelAccessToken;

  console.log(`[Webhook][STEP] handleStart: startPhase取得前 workId=${work.id} userId=${userId}`);
  const startPhase = await prisma.phase.findFirst({
    where:   { workId: work.id, phaseType: "start", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log(`[Webhook][STEP] handleStart: startPhase取得後 found=${!!startPhase} phaseId=${startPhase?.id ?? "-"}`);

  if (!startPhase) {
    console.log(`[Webhook][STEP] メッセージ送信前 (startPhaseなし) userId=${userId}`);
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "まだシナリオの準備中です。もうしばらくお待ちください。",
      sender: systemSender,
    }], token);
    return;
  }

  console.log(`[Webhook][STEP] handleStart: progress upsert前 userId=${userId} workId=${work.id}`);
  const progress = await prisma.userProgress.upsert({
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
  });
  console.log(`[Webhook][STEP] handleStart: progress upsert後 progressId=${progress.id}`);

  const state = await buildRuntimeState(progress);

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

  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  console.log(
    `[Webhook][STEP] メッセージ送信前 (開始) msgs件数=${msgs.length} userId=${userId}`,
    msgs.map((m, i) => `[${i}]type=${m.type} text="${"text" in m ? String(m.text ?? "").slice(0, 30) : "(non-text)"}"`).join(" / ")
  );
  await replyToLine(replyToken, msgs, token);
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
  id:           string;
  phaseType:    string;
  startTrigger: string | null;
};

async function handleStartTrigger({
  oa, work, systemSender, userId, replyToken,
  startPhase,
}: Omit<HandlerCommon, "work"> & {
  work:       NonNullable<WorkRecord>;
  startPhase: StartPhaseRecord;
}) {
  const token = oa.channelAccessToken;

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

  // progress upsert（未開始なら新規作成 / 開始済みなら最初からリセット）
  const progress = await prisma.userProgress.upsert({
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
  });
  console.log(
    `[Webhook][STEP] handleStartTrigger: progress upsert完了`,
    `progressId=${progress.id}`,
    `currentPhaseId=${progress.currentPhaseId}`,
  );

  // 初期フェーズの phaseType を取得してリッチメニューを切り替え
  const initialPhase = await prisma.phase.findUnique({
    where:  { id: initialPhaseId },
    select: { phaseType: true },
  });
  if (initialPhase) {
    await switchRichMenuForUser(oa, userId, initialPhase.phaseType);
  }

  // kind="start" メッセージを startPhase から取得して送信（物語演出として）
  const startKindMessages = await prisma.message.findMany({
    where: {
      workId:   work.id,
      phaseId:  startPhase.id,
      kind:     "start",
      isActive: true,
    },
    select: {
      id:              true,
      triggerKeyword:  true,
      messageType:     true,
      body:            true,
      assetUrl:        true,
      altText:         true,
      flexPayloadJson: true,
      quickReplies:    true,
      sortOrder:       true,
      character: {
        select: { name: true, iconImageUrl: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  console.log(
    `[Webhook][STEP] handleStartTrigger: kind="start" msgs=${startKindMessages.length}件 userId=${userId}`
  );

  if (startKindMessages.length > 0) {
    const msgs = buildKeywordMessages(startKindMessages, systemSender);
    if (msgs.length > 0) {
      await replyToLine(replyToken, msgs, token);
      return;
    }
  }

  // kind="start" が 0 件 → startPhase の通常メッセージへフォールバック
  console.log(`[Webhook][STEP] handleStartTrigger: kind=start 0件 → 通常 startPhase メッセージへフォールバック`);
  const state = await buildRuntimeState(progress);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  if (msgs.length > 0) {
    await replyToLine(replyToken, msgs, token);
  }
}

// ─ 現在の進行状態を表示（つづきから）──────────────────────
async function handleContinue({
  oa, work, systemSender, userId, replyToken,
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

  const progress = await prisma.userProgress.findUnique({
    where: { lineUserId_workId: { lineUserId: userId, workId: work.id } },
  });

  // 未開始 — あいさつメッセージ（設定があれば）＋開始案内
  if (!progress) {
    await replyToLine(replyToken, buildWelcomeMessages(work, systemSender), token);
    return;
  }

  // エンディング到達済み → 自動返信なし（シナリオ定義に委ねる）
  if (progress.reachedEnding) {
    return;
  }

  // 現在フェーズを表示（prefix なし）
  const state = await buildRuntimeState(progress);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  await replyToLine(replyToken, msgs, token);
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
  oa, work, systemSender, userId, replyToken, command,
}: HandlerCommon & { command: GlobalCommandRecord }) {
  const token = oa.channelAccessToken;

  switch (command.actionType) {
    // ── RESET: progress をリセットして最初から ──
    case "RESET": {
      if (!work) break;
      await handleStart({ oa, work, systemSender, userId, replyToken });
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
      const progress = await prisma.userProgress.findUnique({
        where: { lineUserId_workId: { lineUserId: userId, workId: work.id } },
      });
      if (!progress) {
        await handleStart({ oa, work, systemSender, userId, replyToken });
        return;
      }
      const state = await buildRuntimeState(progress);
      const msgs  = buildPhaseMessages(state.phase, { systemSender });
      if (msgs.length > 0) {
        await replyToLine(replyToken, msgs, token);
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
      const progress = await prisma.userProgress.findUnique({
        where: { lineUserId_workId: { lineUserId: userId, workId: work.id } },
      });
      if (!progress?.currentPhaseId) {
        await replyToLine(replyToken, [{
          type: "text",
          text: "現在進行中のシナリオがありません。「はじめる」と送ってスタートしてください。",
          sender: systemSender,
        }], token);
        return;
      }
      // 現在フェーズのパズルメッセージからヒントテキストを取得
      const puzzleMsg = await prisma.message.findFirst({
        where: {
          workId:   work.id,
          phaseId:  progress.currentPhaseId,
          kind:     "puzzle",
          isActive: true,
          puzzleHintText: { not: null },
        },
        orderBy: { sortOrder: "asc" },
      });
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
): Promise<{ hintText: string; hintFollowup?: string } | null> {
  // 現在フェーズのアクティブなメッセージの quickReplies を取得
  const messages = await prisma.message.findMany({
    where: {
      workId,
      phaseId:  currentPhaseId,
      isActive: true,
      quickReplies: { not: null },
    },
    select: { id: true, quickReplies: true },
    orderBy: { sortOrder: "asc" },
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

      // value が設定されていればそちらを照合キーとして使う。なければ label を使う
      const matchKey    = item.value?.trim() || item.label;
      const matchNorm   = normKw(matchKey);
      const matchLoose  = normKwLoose(matchKey);

      if (inputNorm === matchNorm || inputLoose === matchLoose) {
        const hintText     = item.hint_text?.trim() || "ヒントはまだ設定されていません。";
        const hintFollowup = item.hint_followup?.trim() || undefined;
        console.log(
          `[Webhook][hint] マッチ msgId=${msg.id.slice(0, 8)}`,
          `key="${matchKey}"`,
          `hint_text="${hintText.slice(0, 30)}..."`,
          hintFollowup ? `hint_followup="${hintFollowup.slice(0, 20)}..."` : "",
        );
        return { hintText, hintFollowup };
      }
    }
  }

  return null; // マッチなし
}

// ──────────────────────────────────────────────────────────
// パズル（謎）照合
// ──────────────────────────────────────────────────────────

type PuzzleRecord = {
  id:                 string;
  answer:             string;
  answerMatchType:    string | null;
  correctAction:      string | null;
  correctText:        string | null;
  incorrectText:      string | null;
  correctNextPhaseId: string | null;
};

type PuzzleMatchResult =
  | null                                                        // このフェーズにパズルなし（遷移照合へ進む）
  | { type: "incorrect"; incorrectText: string | null }         // パズルあり・不正解
  | { type: "correct";   puzzle: PuzzleRecord };               // 正解

/**
 * 句読点・記号類を除去する（ignore_punctuation マッチ用）
 */
function removePunct(s: string): string {
  return s.replace(/[!?,.　\u0020\t、。，．・：；！？…‥〜ー\u3000-\u303F]+/gu, "").trim();
}

/**
 * 入力テキストとパズルの答えを answer_match_type に基づいて照合する
 */
function checkPuzzleAnswer(
  input:      string,
  answer:     string,
  matchTypes: string[],
): boolean {
  const inputNorm  = normKw(input);
  const answerNorm = normKw(answer);

  for (const mt of matchTypes) {
    if (mt === "exact" || mt === "normalize_width") {
      // normalize_width は NFKC で解決済み
      if (inputNorm === answerNorm) return true;
    }
    if (mt === "ignore_punctuation") {
      if (removePunct(inputNorm) === removePunct(answerNorm)) return true;
    }
  }
  return false;
}

/**
 * DB の answerMatchType（JSON 文字列）を string[] に変換する
 */
function parsePuzzleMatchType(raw: string | null): string[] {
  if (!raw) return ["exact"];
  try { return JSON.parse(raw); } catch { return ["exact"]; }
}

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
      id:                 true,
      answer:             true,
      answerMatchType:    true,
      correctAction:      true,
      correctText:        true,
      incorrectText:      true,
      correctNextPhaseId: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  if (puzzles.length === 0) return null; // パズルなし → 遷移照合へ

  for (const puzzle of puzzles) {
    if (!puzzle.answer) continue;
    const matchTypes = parsePuzzleMatchType(puzzle.answerMatchType);
    if (checkPuzzleAnswer(inputText, puzzle.answer, matchTypes)) {
      console.log(
        `[Webhook][puzzle] 正解 puzzleId=${puzzle.id.slice(0, 8)}`,
        `input="${inputText}"`,
        `answer="${puzzle.answer}"`,
        `matchTypes=${JSON.stringify(matchTypes)}`,
      );
      return { type: "correct", puzzle: puzzle as PuzzleRecord };
    }
  }

  console.log(
    `[Webhook][puzzle] 不正解 input="${inputText}"`,
    `puzzles=${puzzles.length}件`,
    puzzles.map((p) => `answer="${p.answer}"`).join(", "),
  );
  return { type: "incorrect", incorrectText: puzzles[0]?.incorrectText ?? null };
}

/**
 * パズル正解時の処理。
 * correct_action に応じて:
 *   "text"             → correctText を返信するのみ
 *   "transition"       → correctNextPhase へ遷移してフェーズメッセージを返信
 *   "text_and_transition" → correctText ＋ 遷移先フェーズメッセージを一括返信
 */
async function handlePuzzleCorrect({
  oa, work, systemSender, userId, replyToken,
  progress, puzzle,
}: Omit<HandlerCommon, "work"> & {
  work:     NonNullable<WorkRecord>;
  progress: { id: string; flags: string };
  puzzle:   PuzzleRecord;
}) {
  const token  = oa.channelAccessToken;
  const action = puzzle.correctAction ?? "text";

  const messagesToSend: import("@/lib/line").LineMessage[] = [];

  // ─ correctText を先頭に追加（text / text_and_transition）─
  if ((action === "text" || action === "text_and_transition") && puzzle.correctText) {
    messagesToSend.push({ type: "text", text: puzzle.correctText, sender: systemSender });
  }

  // ─ フェーズ遷移（transition / text_and_transition）─
  if (action === "transition" || action === "text_and_transition") {
    if (puzzle.correctNextPhaseId) {
      const nextPhase = await prisma.phase.findUnique({ where: { id: puzzle.correctNextPhaseId } });
      if (nextPhase) {
        const isEnding = nextPhase.phaseType === "ending";
        const updated  = await prisma.userProgress.update({
          where: { id: progress.id },
          data: {
            currentPhaseId:   nextPhase.id,
            reachedEnding:    isEnding,
            lastInteractedAt: new Date(),
          },
        });
        console.log(
          `[Webhook][puzzle] 遷移 → phaseId=${nextPhase.id.slice(0, 8)}`,
          `phaseType=${nextPhase.phaseType}`,
          `isEnding=${isEnding}`,
        );
        await switchRichMenuForUser(oa, userId, nextPhase.phaseType);
        const state     = await buildRuntimeState(updated);
        const nextMsgs  = buildPhaseMessages(state.phase, { systemSender });
        messagesToSend.push(...nextMsgs);
      }
    }
  }

  // ─ フォールバック: メッセージが組み立てられなかった場合 ─
  if (messagesToSend.length === 0) {
    messagesToSend.push({ type: "text", text: "正解！", sender: systemSender });
  }

  // LINE reply は最大 5 件
  await replyToLine(replyToken, messagesToSend.slice(0, 5), token);
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
      kind:           { notIn: ["start", "puzzle"] },
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
      sortOrder:       true,
      character: {
        select: { name: true, iconImageUrl: true },
      },
    },
    orderBy: { sortOrder: "asc" },
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
