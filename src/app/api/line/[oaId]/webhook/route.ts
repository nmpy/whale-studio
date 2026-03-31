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
  replyToLine, buildPhaseMessages, buildQuickReply,
  RICHMENU_ACTIONS,
  type LineWebhookBody, type LineEvent, type LineSender,
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
  // ── 1. Raw body 取得（署名検証に必要）──
  const rawBody  = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  // ── 2. OA 取得 ──
  const oa = await prisma.oa.findUnique({ where: { id: params.oaId } });
  if (!oa) {
    // 存在しない OA ID への Webhook は 404
    return NextResponse.json({ error: "OA not found" }, { status: 404 });
  }

  // ── 3. 署名検証 ──
  if (signature) {
    // ヘッダーがあれば必ず検証（開発・本番共通）
    if (!verifyLineSignature(rawBody, signature, oa.channelSecret)) {
      console.warn(`[Webhook] 署名検証失敗 oaId=${params.oaId}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (!isDev) {
    // 本番では署名必須
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  } else {
    // 開発環境 + 署名なし → スキップ（curl テスト用）
    console.warn("[Webhook] 署名なし — 開発環境のためスキップします");
  }

  // ── 4. JSON パース ──
  let webhookBody: LineWebhookBody;
  try {
    webhookBody = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // events が空のとき（LINE の疎通確認）は即 200 を返す
  if (!webhookBody.events || webhookBody.events.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // ── 5. follow イベント処理（友達追加 → トラッキング帰属）──
  const followEvents = webhookBody.events.filter(
    (e): e is LineEvent & { source: { userId: string } } =>
      e.type === "follow" && typeof e.source?.userId === "string"
  );

  if (followEvents.length > 0) {
    await Promise.allSettled(
      followEvents.map((e) => attributeFollowToTracking(params.oaId, e.source.userId))
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
  const work = await prisma.work.findFirst({
    where:   { oaId: params.oaId, publishStatus: "active" },
    orderBy: { sortOrder: "asc" },
    include: {
      systemCharacter: {
        select: { name: true, iconImageUrl: true },
      },
    },
  });
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

  // ─ 進行状態を取得 ─
  const progress = await prisma.userProgress.findUnique({
    where: {
      lineUserId_workId: { lineUserId: userId, workId: work.id },
    },
  });

  // ─ 未開始 — あいさつメッセージ（設定があれば）＋開始案内 ─
  if (!progress) {
    await replyToLine(replyToken, buildWelcomeMessages(work, systemSender), token);
    return;
  }

  // ─ エンディング到達済み ─
  if (progress.reachedEnding) {
    const state = await buildRuntimeState(progress);
    const msgs = state.phase
      ? buildPhaseMessages(state.phase, { systemSender })
      : [{ type: "text" as const, text: `すでにエンディングに到達しています。\n「はじめる」と送ると最初から楽しめます。`, sender: systemSender }];
    await replyToLine(replyToken, msgs, token);
    return;
  }

  // ─ 現在フェーズなし（異常状態） ─
  if (!progress.currentPhaseId) {
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
    return;
  }

  // ─ 遷移マッチング ─
  const currentPhase = await prisma.phase.findUnique({
    where:   { id: progress.currentPhaseId },
    include: {
      transitionsFrom: {
        where:   { isActive: true },
        orderBy: [{ sortOrder: "asc" }],
      },
    },
  });

  if (!currentPhase) {
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "「はじめる」と送ってシナリオをスタートしてください。",
      sender: systemSender,
    }], token);
    return;
  }

  // ─ 現在の flags を取得してフラグ条件付き遷移マッチング ─
  const currentFlags = safeParseFlags(progress.flags);
  const matched = matchTransition(currentPhase.transitionsFrom, {
    label: text,
    flags: currentFlags,
  });

  // ─ マッチなし → 現在の選択肢をクイックリプライで再表示 ─
  if (!matched) {
    const availableLabels = currentPhase.transitionsFrom
      .filter((t) => t.isActive)
      .map((t) => t.label);
    const qr = availableLabels.length > 0 ? buildQuickReply(availableLabels) : undefined;
    await replyToLine(replyToken, [{
      type:       "text",
      text:       availableLabels.length > 0
        ? "うまく聞き取れませんでした。\n下のボタンから選んでください。"
        : "その言葉には応答できません。",
      quickReply: qr,
      sender:     systemSender,
    }], token);
    return;
  }

  // ─ 遷移先フェーズへ移動 + setFlags を適用 ─
  const toPhase = await prisma.phase.findUnique({ where: { id: matched.toPhaseId } });
  if (!toPhase) return;

  const isEnding = toPhase.phaseType === "ending";
  const newFlags = applySetFlags(currentFlags, matched.setFlags);

  const updated = await prisma.userProgress.update({
    where: { id: progress.id },
    data: {
      currentPhaseId:   toPhase.id,
      reachedEnding:    isEnding,
      flags:            JSON.stringify(newFlags),
      lastInteractedAt: new Date(),
    },
  });

  // visible_phase によるリッチメニュー切り替え
  await switchRichMenuForUser(oa, userId, toPhase.phaseType);

  const state = await buildRuntimeState(updated);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
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

  const startPhase = await prisma.phase.findFirst({
    where:   { workId: work.id, phaseType: "start", isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (!startPhase) {
    await replyToLine(replyToken, [{
      type:   "text",
      text:   "まだシナリオの準備中です。もうしばらくお待ちください。",
      sender: systemSender,
    }], token);
    return;
  }

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

  const state = await buildRuntimeState(progress);
  // prefix なし: 開始テキストは作品の開始フェーズメッセージで表現する
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  await replyToLine(replyToken, msgs, token);
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

  // エンディング到達済み
  if (progress.reachedEnding) {
    const state = await buildRuntimeState(progress);
    const msgs  = state.phase
      ? buildPhaseMessages(state.phase, { systemSender })
      : [{ type: "text" as const, text: `すでにエンディングに到達しています。\n「はじめる」と送ると最初から楽しめます。`, sender: systemSender }];
    await replyToLine(replyToken, msgs, token);
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
