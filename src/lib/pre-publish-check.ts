// src/lib/pre-publish-check.ts
//
// 作品の「公開前チェック」判定ロジック（サーバー専用・UI から分離）。
// 設定漏れ・導線切れ・権限不整合を 1 回のバッチ取得で集計する（N+1 を作らない）。
// 既存のプラン判定(getCurrentPlanTierForOa + getPlanAccessState + FEATURE.location)を再利用する。
//
// 返り値は UI 非依存の純データ。API 化・将来の他画面流用を想定。

import { prisma } from "@/lib/prisma";
import { getCurrentPlanTierForOa } from "@/lib/plan-guard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";

export type CheckSeverity = "error" | "warning";
export type CheckStatus = "ok" | "fail" | "skip";

export interface PrePublishCheckItem {
  /** チェック識別キー */
  key: string;
  /** 表示名 */
  label: string;
  /** 失敗時の重大度（error=致命的 / warning=注意） */
  severity: CheckSeverity;
  /** 判定結果（ok=問題なし / fail=要確認 / skip=対象外） */
  status: CheckStatus;
  /** 補足メッセージ（fail 時に理由を示す） */
  message: string;
  /** 該当設定画面への相対リンク（fail 時の導線。null = リンクなし） */
  fixHref?: string | null;
}

export interface PrePublishCheckResult {
  /** error 重大度の fail が 0 件なら true（= 公開しても致命的問題なし） */
  ok: boolean;
  errorCount: number;
  warningCount: number;
  items: PrePublishCheckItem[];
}

/** quick_replies JSON を安全に parse。 */
function parseQuickReplies(json: string | null): Array<{ action?: string; value?: string }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const VAR_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 作品の公開前チェックを実行する。workId が見つからなければ null。
 */
export async function runPrePublishCheck(workId: string): Promise<PrePublishCheckResult | null> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: {
      oa: { select: { id: true, serviceSuspendedAt: true, liffId: true } },
      messages: {
        where: { isActive: true },
        select: {
          id: true, kind: true, messageType: true, triggerKeyword: true,
          nextMessageId: true, correctAction: true, correctNextPhaseId: true,
          freeInputEnabled: true, freeInputVariableKey: true, freeInputNextMessageId: true,
          checkinTriggerType: true, checkinTriggerLocationId: true,
          checkinTriggerNextMessageId: true, checkinTriggerNextPhaseId: true,
          imageActionType: true, imageActionText: true, imageActionUrl: true,
          imageActionLiffPageId: true, imageActionPostbackData: true,
          quickReplies: true,
        },
      },
      phases:    { select: { id: true } },
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!work) return null;

  const oaId = work.oaId;
  const base = `/oas/${oaId}/works/${workId}`;
  const messagesHref = `${base}/messages`;

  const [liffPages, beaconCount] = await Promise.all([
    prisma.liffPageConfig.findMany({ where: { workId, isEnabled: true }, select: { id: true } }),
    prisma.beaconTrigger.count({ where: { workId } }),
  ]);

  const msgs = work.messages;
  const msgIds = new Set(msgs.map((m) => m.id));
  const phaseIds = new Set(work.phases.map((p) => p.id));

  const items: PrePublishCheckItem[] = [];
  const add = (i: PrePublishCheckItem) => items.push(i);

  // 1. 開始メッセージ（kind=start）が存在するか（致命的）
  const hasStart = msgs.some((m) => m.kind === "start");
  add({
    key: "start_message", label: "開始メッセージ", severity: "error",
    status: hasStart ? "ok" : "fail",
    message: hasStart ? "開始メッセージが設定されています。" : "開始演出（kind=start）のメッセージがありません。作品を開始できません。",
    fixHref: hasStart ? null : messagesHref,
  });

  // 2. メッセージ遷移の未設定（参照先が存在しない）遷移先（致命的）
  let brokenTransitions = 0;
  for (const m of msgs) {
    if (m.nextMessageId && !msgIds.has(m.nextMessageId)) brokenTransitions++;
    if (m.checkinTriggerNextMessageId && !msgIds.has(m.checkinTriggerNextMessageId)) brokenTransitions++;
    if (m.checkinTriggerNextPhaseId && !phaseIds.has(m.checkinTriggerNextPhaseId)) brokenTransitions++;
    // puzzle: 遷移系 correct_action なのに遷移先フェーズ未設定/不在
    if ((m.correctAction === "transition" || m.correctAction === "text_and_transition")) {
      if (!m.correctNextPhaseId || !phaseIds.has(m.correctNextPhaseId)) brokenTransitions++;
    } else if (m.correctNextPhaseId && !phaseIds.has(m.correctNextPhaseId)) {
      brokenTransitions++;
    }
  }
  add({
    key: "broken_transitions", label: "メッセージの遷移先", severity: "error",
    status: brokenTransitions === 0 ? "ok" : "fail",
    message: brokenTransitions === 0 ? "未設定・不正な遷移先はありません。" : `遷移先が未設定または存在しないメッセージが ${brokenTransitions} 件あります。`,
    fixHref: brokenTransitions === 0 ? null : messagesHref,
  });

  // 3. 応答キーワード必須（start / response / global）でキーワードが空（致命的）
  const missingKeyword = msgs.filter(
    (m) => (m.kind === "start" || m.kind === "response" || m.kind === "global") && !(m.triggerKeyword ?? "").trim(),
  ).length;
  add({
    key: "trigger_keyword", label: "応答キーワード", severity: "error",
    status: missingKeyword === 0 ? "ok" : "fail",
    message: missingKeyword === 0 ? "キーワードが必要なメッセージはすべて設定済みです。" : `キーワードが必須なのに未入力のメッセージが ${missingKeyword} 件あります（開始演出/応答/共通）。`,
    fixHref: missingKeyword === 0 ? null : messagesHref,
  });

  // 4. LIFF を利用している場合、LIFF 設定（liffId / 環境変数）が有効か（致命的）
  const usesLiff = work.liffEnabled && liffPages.length > 0;
  const liffConfigured = !!work.oa.liffId || !!process.env.NEXT_PUBLIC_LIFF_ID;
  add({
    key: "liff_config", label: "LIFF 設定", severity: "error",
    status: !usesLiff ? "skip" : liffConfigured ? "ok" : "fail",
    message: !usesLiff
      ? "LIFF ページを利用していません（対象外）。"
      : liffConfigured ? "LIFF が利用可能です。" : "LIFF ページを公開していますが、LIFF ID が未設定です。LINE 設定で LIFF ID を設定してください。",
    fixHref: !usesLiff || liffConfigured ? null : `/oas/${oaId}/settings`,
  });

  // 5. ロケーション/GPS/QR/Beacon 利用時に OA プランが Pro Max 相当か（致命的）
  const usesLocation =
    work.locations.length > 0 ||
    beaconCount > 0 ||
    msgs.some((m) => !!m.checkinTriggerType);
  let locationItem: PrePublishCheckItem;
  if (!usesLocation) {
    locationItem = { key: "location_plan", label: "ロケーション機能の権限", severity: "error", status: "skip", message: "ロケーション/GPS/QR/Beacon を利用していません（対象外）。", fixHref: null };
  } else {
    const plan = await getCurrentPlanTierForOa(oaId);
    const access = getPlanAccessState({ plan, featureKey: FEATURE.location });
    locationItem = {
      key: "location_plan", label: "ロケーション機能の権限", severity: "error",
      status: access.allowed ? "ok" : "fail",
      message: access.allowed
        ? "ロケーション機能が利用可能なプランです。"
        : "ロケーション/GPS/QR/Beacon を利用していますが、現在のプランでは利用できません（Pro Max 相当が必要）。",
      fixHref: access.allowed ? null : `/oas/${oaId}/works/${workId}/locations`,
    };
  }
  add(locationItem);

  // 6. OA が稼働中か（致命的）
  const suspended = !!work.oa.serviceSuspendedAt;
  add({
    key: "oa_active", label: "アカウント稼働状態", severity: "error",
    status: suspended ? "fail" : "ok",
    message: suspended ? "このアカウント（OA）は現在停止中です。公開しても配信されません。" : "アカウントは稼働中です。",
    fixHref: null,
  });

  // 7. followAction が明確（auto_start / welcome_wait / none）か（注意）
  const validFollow = ["auto_start", "welcome_wait", "none"].includes(work.followAction);
  add({
    key: "follow_action", label: "友だち追加時の動作", severity: "warning",
    status: validFollow ? "ok" : "fail",
    message: validFollow ? `友だち追加時の動作: ${work.followAction}` : "友だち追加時の動作が未確認です。設定を確認してください。",
    fixHref: validFollow ? null : `${base}/edit`,
  });

  // 8. 自由入力メッセージ: 次の遷移先が壊れている=致命的 / 保存先も次もない=注意
  let freeInputBroken = 0;   // 次メッセージ指定が不在
  let freeInputDeadEnd = 0;  // 保存先変数も次メッセージも無い
  for (const m of msgs) {
    if (!m.freeInputEnabled) continue;
    if (m.freeInputNextMessageId) {
      if (!msgIds.has(m.freeInputNextMessageId)) freeInputBroken++;
    } else {
      const hasVarKey = !!(m.freeInputVariableKey && VAR_KEY_RE.test(m.freeInputVariableKey));
      if (!hasVarKey) freeInputDeadEnd++;
    }
  }
  add({
    key: "free_input", label: "自由入力の設定",
    severity: freeInputBroken > 0 ? "error" : "warning",
    status: freeInputBroken > 0 || freeInputDeadEnd > 0 ? "fail" : "ok",
    message: freeInputBroken > 0
      ? `自由入力後の遷移先が存在しないメッセージが ${freeInputBroken} 件あります。`
      : freeInputDeadEnd > 0
        ? `自由入力で保存先変数名も次の遷移先も未設定のメッセージが ${freeInputDeadEnd} 件あります（入力が活用されません）。`
        : "自由入力の設定に問題はありません。",
    fixHref: freeInputBroken > 0 || freeInputDeadEnd > 0 ? messagesHref : null,
  });

  // 9. 画像タップ応答 / クイックリプライの遷移先未設定（致命的）
  let brokenActions = 0;
  for (const m of msgs) {
    // 画像タップアクション
    const t = m.imageActionType;
    if (t && t !== "none") {
      if (t === "message" && !(m.imageActionText ?? "").trim()) brokenActions++;
      else if (t === "uri" && !(m.imageActionUrl ?? "").trim()) brokenActions++;
      else if (t === "liff" && !(m.imageActionLiffPageId ?? "").trim()) brokenActions++;
      else if (t === "postback" && !(m.imageActionPostbackData ?? "").trim()) brokenActions++;
    }
    // クイックリプライ: action が value 必須なのに空 / next が不在メッセージ
    for (const qr of parseQuickReplies(m.quickReplies)) {
      const action = qr.action;
      const value = (qr.value ?? "").trim();
      if (action === "url" || action === "custom") {
        if (!value) brokenActions++;
      } else if (action === "next") {
        if (!value || !msgIds.has(value)) brokenActions++;
      }
    }
  }
  add({
    key: "action_targets", label: "操作後の遷移先（画像タップ / クイックリプライ）", severity: "error",
    status: brokenActions === 0 ? "ok" : "fail",
    message: brokenActions === 0 ? "操作後の遷移先はすべて設定済みです。" : `遷移先が未設定または存在しない操作（画像タップ / クイックリプライ）が ${brokenActions} 件あります。`,
    fixHref: brokenActions === 0 ? null : messagesHref,
  });

  const errorCount = items.filter((i) => i.status === "fail" && i.severity === "error").length;
  const warningCount = items.filter((i) => i.status === "fail" && i.severity === "warning").length;
  return { ok: errorCount === 0, errorCount, warningCount, items };
}
