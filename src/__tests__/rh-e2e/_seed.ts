// src/__tests__/rh-e2e/_seed.ts
// 完全合成データ（PII なし）で 1 つの OA/Work を構築する。実 docker PG に書き込む。
// 返り値の id 群を E2E テストが利用する。実在の名前/番号は一切使わない。
import { prisma } from "@/lib/prisma";

export const TEST_USER_ID = "rh-test-user-0001";
export const TEST_LINE_USER = "U_TEST_RELEASE_HARDENING_001";
export const TEST_LINE_USER_2 = "U_TEST_RELEASE_HARDENING_002";
/** 合成 Channel Secret（ローカル署名生成用のダミー・本番値ではない）。 */
export const SYNTHETIC_CHANNEL_SECRET = "synthetic_secret_local_only";
/** lineOaId は seedSynthetic の tag から `rhtest-${tag}` で決まる。 */
export const lineOaIdFor = (tag: string) => `rhtest-${tag}`;

export interface SeedIds {
  oaId: string;
  workId: string;
  globalPhaseId: string;
  startPhaseId: string;
  normalPhaseId: string;
  endingPhaseId: string;
  characterId: string;
  startMsgId: string;
  normalMsgId: string;
  responseMsgId: string;
  freeInputMsgId: string;
  puzzleExactMsgId: string;
  puzzlePartialMsgId: string;
  hintMsgId: string;
  qrPostbackMsgId: string;
  qrTargetMsgId: string;
  callRequestMsgId: string;
  transitionStartToNormal: string;
  transitionNormalToEnding: string;
}

/** 一意な合成 OA/Work を作る。テストごとに呼び、テスト後に cleanup(oaId) する。 */
export async function seedSynthetic(tag: string): Promise<SeedIds> {
  // profile（auth スタブ user）
  await prisma.profile.upsert({
    where: { userId: TEST_USER_ID },
    update: {},
    create: { userId: TEST_USER_ID, username: "rh-test" },
  });

  const oa = await prisma.oa.create({
    data: {
      title: `RH-TEST-OA-${tag}`,
      channelId: "0000000000",
      channelSecret: SYNTHETIC_CHANNEL_SECRET,
      channelAccessToken: "synthetic_token_local_only",
      publishStatus: "active",
      ownerKey: TEST_USER_ID,
      mode: "content",
      lineOaId: `rhtest-${tag}`, // webhook は [oaId]=lineOaId で OA 解決
    },
  });

  // owner membership（tenant テスト用）
  await prisma.workspaceMember.create({
    data: { workspaceId: oa.id, userId: TEST_USER_ID, role: "owner", status: "active" },
  });

  const work = await prisma.work.create({
    data: { oaId: oa.id, title: `RH-TEST-WORK-${tag}`, publishStatus: "active", startTriggerMode: "keyword", startKeyword: "はじめる" },
  });

  const character = await prisma.character.create({
    data: { workId: work.id, name: "テスト話者" },
  });

  const mkPhase = (phaseType: string, name: string, sortOrder: number) =>
    prisma.phase.create({ data: { workId: work.id, phaseType, name, sortOrder, isActive: true } });

  const globalPhase = await mkPhase("global", "全体共通", -1);
  const startPhase = await mkPhase("start", "序章", 0);
  const normalPhase = await mkPhase("normal", "本編", 1);
  const endingPhase = await mkPhase("ending", "結末", 2);

  const mkMsg = (data: Record<string, unknown>) =>
    prisma.message.create({ data: { workId: work.id, characterId: character.id, isActive: true, ...data } as never });

  // start phase messages
  const startMsg = await mkMsg({ phaseId: startPhase.id, kind: "start", messageType: "text", body: "ようこそ。", sortOrder: 0, triggerKeyword: "はじめる" });
  const normalMsg = await mkMsg({ phaseId: normalPhase.id, kind: "normal", messageType: "text", body: "本編です。", sortOrder: 0 });
  const responseMsg = await mkMsg({ phaseId: normalPhase.id, kind: "response", messageType: "text", body: "応答です。", sortOrder: 1, triggerKeyword: "あいことば" });
  const freeInputMsg = await mkMsg({ phaseId: normalPhase.id, kind: "normal", messageType: "text", body: "お名前は？", sortOrder: 2, freeInputEnabled: true, freeInputVariableKey: "userName" });

  // puzzle exact（正解で ending へ遷移する構成）
  const puzzleExact = await mkMsg({
    phaseId: normalPhase.id, kind: "puzzle", messageType: "riddle", body: "合言葉は？", sortOrder: 3,
    answer: "さくら", answerMatchType: JSON.stringify(["exact"]), correctText: "正解！", incorrectText: "ちがう",
    correctAction: "transition", correctNextPhaseId: endingPhase.id,
  });
  // puzzle partial（5〜7文字閾値検証用の 6 文字 answer）
  const puzzlePartial = await mkMsg({
    phaseId: normalPhase.id, kind: "puzzle", messageType: "riddle", body: "長い答えは？", sortOrder: 4,
    answer: "あいうえおか", answerMatchType: JSON.stringify(["partial"]), correctText: "OK", incorrectText: "NG",
  });
  const hintMsg = await mkMsg({ phaseId: normalPhase.id, kind: "hint", messageType: "text", body: "ヒント: 花です", sortOrder: 5, triggerKeyword: "ヒント" });

  // QR postback: qrTarget is the message that qrPostback's "次へ" points to
  const qrTarget = await mkMsg({ phaseId: normalPhase.id, kind: "normal", messageType: "text", body: "次のバブル。", sortOrder: 7 });
  const qrPostback = await mkMsg({
    phaseId: normalPhase.id, kind: "normal", messageType: "text", body: "最初のバブル。", sortOrder: 6,
    quickReplies: JSON.stringify([{ label: "次へ", action: "text", target_message_id: qrTarget.id }]),
  });

  // call_request（head として保存・flex_payload_json に設定）
  const callReq = await mkMsg({
    phaseId: normalPhase.id, kind: "normal", messageType: "call_request", sortOrder: 8,
    flexPayloadJson: JSON.stringify({ title: "電話する", callType: "tel", tel: "0000000000", buttonLabel: "発信" }),
  });

  // transitions
  const trStartNormal = await prisma.transition.create({
    data: { workId: work.id, fromPhaseId: startPhase.id, toPhaseId: normalPhase.id, label: "進む" },
  });
  const trNormalEnding = await prisma.transition.create({
    data: { workId: work.id, fromPhaseId: normalPhase.id, toPhaseId: endingPhase.id, label: "終わる" },
  });

  // progress rows: completed + in-progress
  await prisma.userProgress.create({
    data: { lineUserId: `${TEST_LINE_USER}_done`, workId: work.id, currentPhaseId: endingPhase.id, reachedEnding: true },
  });
  await prisma.userProgress.create({
    data: { lineUserId: `${TEST_LINE_USER}_wip`, workId: work.id, currentPhaseId: normalPhase.id, reachedEnding: false },
  });

  return {
    oaId: oa.id, workId: work.id,
    globalPhaseId: globalPhase.id, startPhaseId: startPhase.id, normalPhaseId: normalPhase.id, endingPhaseId: endingPhase.id,
    characterId: character.id,
    startMsgId: startMsg.id, normalMsgId: normalMsg.id, responseMsgId: responseMsg.id, freeInputMsgId: freeInputMsg.id,
    puzzleExactMsgId: puzzleExact.id, puzzlePartialMsgId: puzzlePartial.id, hintMsgId: hintMsg.id,
    qrPostbackMsgId: qrPostback.id, qrTargetMsgId: qrTarget.id, callRequestMsgId: callReq.id,
    transitionStartToNormal: trStartNormal.id, transitionNormalToEnding: trNormalEnding.id,
  };
}

/** テスト OA を FK CASCADE で丸ごと破棄（work/phase/message/transition/progress も消える）。 */
export async function cleanupOa(oaId: string): Promise<void> {
  await prisma.oa.deleteMany({ where: { id: oaId } });
}

export interface FreeTextSeedIds {
  oaId: string;
  workId: string;
  startPhaseId: string;
  startMsgId: string;
  responseMsgId: string;
  puzzleMsgId: string;
}

/** startTriggerMode="free_text" の work を1つだけ持つ OA を作る（free_text 開始検証用）。 */
export async function seedFreeText(tag: string): Promise<FreeTextSeedIds> {
  await prisma.profile.upsert({ where: { userId: TEST_USER_ID }, update: {}, create: { userId: TEST_USER_ID, username: "rh-test" } });
  const oa = await prisma.oa.create({
    data: {
      title: `RH-TEST-FT-OA-${tag}`, channelId: "0", channelSecret: SYNTHETIC_CHANNEL_SECRET,
      channelAccessToken: "synthetic_token_local_only", publishStatus: "active", ownerKey: TEST_USER_ID,
      mode: "content", lineOaId: `rhtest-${tag}`,
    },
  });
  const work = await prisma.work.create({
    data: { oaId: oa.id, title: `RH-TEST-FT-WORK-${tag}`, publishStatus: "active", startTriggerMode: "free_text", startKeyword: null },
  });
  const character = await prisma.character.create({ data: { workId: work.id, name: "話者" } });
  const startPhase = await prisma.phase.create({ data: { workId: work.id, phaseType: "start", name: "序章", sortOrder: 0, isActive: true } });
  const mk = (d: Record<string, unknown>) => prisma.message.create({ data: { workId: work.id, characterId: character.id, phaseId: startPhase.id, isActive: true, ...d } as never });
  const startMsg = await mk({ kind: "start", messageType: "text", body: "開始しました。", sortOrder: 0 });
  // 開始フェーズ内の response（初回入力が誤って応答判定されないことの検証用）
  const responseMsg = await mk({ kind: "response", messageType: "text", body: "応答", sortOrder: 1, triggerKeyword: "こんにちは" });
  // 開始フェーズ内の puzzle（初回入力が誤って正解判定されないことの検証用）
  const puzzleMsg = await mk({ kind: "puzzle", messageType: "riddle", body: "謎", sortOrder: 2, answer: "こんにちは", answerMatchType: JSON.stringify(["exact"]), correctText: "正解" });
  return { oaId: oa.id, workId: work.id, startPhaseId: startPhase.id, startMsgId: startMsg.id, responseMsgId: responseMsg.id, puzzleMsgId: puzzleMsg.id };
}
