// src/lib/constants/plans.ts
//
// プラン (= subscription tier) と機能 (= feature key) の対応関係を定義する constants + helpers。
//
// ## このファイルが扱うもの
//
// - 4 段階のプランティア (Basic / Standard / Plus / Pro) の定義 + 表示名
// - 管理メニューに並ぶ機能ごとの最小プラン要件
// - 「このプランでこの機能が使えるか」を判定する getPlanAccessState
// - 将来の role / 権限制御に拡張可能な getAccessState (= plan + role 同時判定)
//
// ## このファイルが扱わないもの
//
// - 既存の `Plan` (DB の prisma model) スキーマ変更 — 触らない
// - 既存の `Subscription` モデル変更 — 触らない
// - 既存の `tester` / `editor` プラン名の意味変更 — 触らない (= mapPlanNameToTier で吸収)
//
// ## DB スキーマとの関係
//
// 既存 Prisma スキーマには `Plan` モデル (`plans` テーブル) があり、`name` カラムは
// 文字列で `"tester"` / `"editor"` 等の plan key を持つ。今回はその値を「ティア」
// (= 4 段階のうちどれに該当するか) へマッピングする思想で実装する。
//
// 既存 plan name と ティア の対応は `mapPlanNameToTier` で定義する。新しい plan
// (e.g. "basic_plan" / "standard_plan" を DB に追加するケース) は同関数の switch を
// 拡張するだけで済む。DB schema を変えずにビジネス側のプラン階段を表現できる。
//
// ## API 側制御について (= TODO)
//
// 現在この constants は UI のグレーアウト用 (= read-only 表示制御)。将来的に API 側でも
// 必ず制御を入れる必要がある:
//   - plan 不足 → 403 + code: "PLAN_REQUIRED"
//   - role 不足 → 403 + code: "PERMISSION_DENIED"
// UI 側と API 側で同じ helper / constants を参照する設計のため、本ファイルは
// `"use client"` を含めず、サーバー / クライアント両方から import できるよう保つこと。
//
// ## 将来の URL 設計メモ (= TODO)
//
// 将来的に管理者 / クライアント / 運用者で異なる URL を発行する想定:
//   - 管理者用: /works/[workId]
//   - クライアント確認用: /share/[shareToken]
//   - 運用者用: /operate/[shareToken]
//   - LIFF 公開 URL: /liff/[slug]
//   - Preview URL: /liff/preview/[workId]
//
// AccessLink モデル (将来) のフィールド想定:
//   workId / workspaceId / role / scope / expiresAt / createdBy / revokedAt
//
// ## 想定する role (= 将来の getAccessState 拡張)
//
//   owner / admin / editor / operator / viewer / client_operator
//
// client_operator は外部クライアント (= けんぴちゃん等) を想定:
//   - 閲覧は OK / 編集・削除・請求・メンバー管理は不可
//   - plan が Pro でも、role が client_operator なら編集操作は不可
//

// ────────────────────────────────────────────────
// プランティア定義
// ────────────────────────────────────────────────

/** 4 段階のプランティア (= 内部値、API / DB / コードで利用する小文字キー) */
export const PLAN_TIER = {
  basic:    "basic",
  standard: "standard",
  plus:     "plus",
  pro:      "pro",
} as const;

/** PlanTier 型 (= "basic" | "standard" | "plus" | "pro") */
export type PlanTier = typeof PLAN_TIER[keyof typeof PLAN_TIER];

/** プランティアの順序 (= index でランクを表す。basic=0, pro=3) */
export const PLAN_TIER_ORDER: readonly PlanTier[] = ["basic", "standard", "plus", "pro"];

/** ユーザー向け表示名 (= UI 文言用)。内部キーから分離して別変更を許容する。 */
export const PLAN_LABELS: Record<PlanTier, string> = {
  basic:    "Basic",
  standard: "Standard",
  plus:     "Plus",
  pro:      "Pro Max",
};

// ────────────────────────────────────────────────
// 機能 (feature) 定義
// ────────────────────────────────────────────────

/** 管理メニューの各カードに対応する feature key。
 *  HUB_CARDS の card.key と「機能」概念を分離するために定数化する。 */
export const FEATURE = {
  workInfo:     "work.info",
  characters:   "characters",
  messages:     "messages",
  scenarioFlow: "scenarioFlow",
  audience:     "audience",
  liffDisplay:  "liffDisplay",
  destinations: "destinations",
  location:     "location",
} as const;

/** FeatureKey 型 */
export type FeatureKey = typeof FEATURE[keyof typeof FEATURE];

/** HUB_CARDS の card.key を feature key へマップする。
 *  card.key は UI 側のルーティングと一致しているため変更しづらく、
 *  概念分離のためここで明示的に対応を取る。 */
export const HUB_CARD_TO_FEATURE: Record<string, FeatureKey> = {
  edit:         FEATURE.workInfo,
  characters:   FEATURE.characters,
  messages:     FEATURE.messages,
  scenario:     FEATURE.scenarioFlow,
  audience:     FEATURE.audience,
  liff:         FEATURE.liffDisplay,
  destinations: FEATURE.destinations,
  locations:    FEATURE.location,
};

// ────────────────────────────────────────────────
// プラン → 利用可能機能
// ────────────────────────────────────────────────

/** 各プランで利用できる feature の集合 (= 上位プランは下位プランの機能を全て含む)。
 *  仕様:
 *    Basic    : work.info / characters / messages / scenarioFlow
 *    Standard : + audience
 *    Plus     : + liffDisplay / destinations
 *    Pro      : + location (= 全機能) */
export const PLAN_FEATURES: Record<PlanTier, readonly FeatureKey[]> = {
  basic: [
    FEATURE.workInfo,
    FEATURE.characters,
    FEATURE.messages,
    FEATURE.scenarioFlow,
  ],
  standard: [
    FEATURE.workInfo,
    FEATURE.characters,
    FEATURE.messages,
    FEATURE.scenarioFlow,
    FEATURE.audience,
  ],
  plus: [
    FEATURE.workInfo,
    FEATURE.characters,
    FEATURE.messages,
    FEATURE.scenarioFlow,
    FEATURE.audience,
    FEATURE.liffDisplay,
    FEATURE.destinations,
  ],
  pro: [
    FEATURE.workInfo,
    FEATURE.characters,
    FEATURE.messages,
    FEATURE.scenarioFlow,
    FEATURE.audience,
    FEATURE.liffDisplay,
    FEATURE.destinations,
    FEATURE.location,
  ],
};

// ────────────────────────────────────────────────
// プラン → 説明文 (= UI 下部の補足表示)
// ────────────────────────────────────────────────

/** 管理メニュー下部に表示する「このプランで使える機能」の説明文。
 *  プラン名 (= 表示名) を含めない短いバージョンも欲しい場合は別途追加する。 */
export const PLAN_DESCRIPTIONS: Record<PlanTier, string> = {
  basic:
    "Basicプランでは、作品情報・キャラクター・メッセージ・シナリオフローをご利用いただけます。" +
    "オーディエンス、LIFF表示設定、遷移先URL設定、ロケーションは上位プランで利用できます。",
  standard:
    "Standardプランでは、作品情報・キャラクター・メッセージ・シナリオフロー・オーディエンスをご利用いただけます。" +
    "LIFF表示設定、遷移先URL設定、ロケーションは上位プランで利用できます。",
  plus:
    "Plusプランでは、作品情報・キャラクター・メッセージ・シナリオフロー・オーディエンス・LIFF表示設定・遷移先URL設定をご利用いただけます。" +
    "ロケーション機能はPro Maxプランで利用できます。",
  pro:
    "Pro Maxプランでは、すべての管理機能をご利用いただけます。",
};

// ────────────────────────────────────────────────
// 既存 Plan.name → PlanTier マッピング
// ────────────────────────────────────────────────

/** 既存 DB の `plans.name` カラム値 (= "tester" / "editor" 等) を PlanTier にマップする。
 *
 *  既存の MVP プランは tester / editor の 2 種のみで、4 段階のティアと完全一致しない。
 *  以下のマッピングは初期値であり、新しいプラン (= "basic_plan" 等) を DB に追加した場合は
 *  本 switch を更新するだけで済む。
 *
 *  - "tester"     : Basic (= 入門プラン)
 *  - "editor"     : Pro   (= 制作者向けで上位機能を全て使う想定)
 *  - "enterprise" : Pro
 *  - "basic"      : Basic
 *  - "standard"   : Standard
 *  - "plus"       : Plus
 *  - "pro"        : Pro
 *  - null / 不明  : Basic (= 安全側 fallback、Subscription 未設定の OA でも最低限の機能が使える)
 *
 *  null fallback の理由: Subscription 未設定 OA は seed 未実行などのケースで発生するが、
 *  「何も操作できなくなる」より「Basic 相当で動く」方が運用上の影響が小さいため。 */
export function mapPlanNameToTier(planName: string | null | undefined): PlanTier {
  if (!planName) return PLAN_TIER.basic;
  switch (planName) {
    case "tester":     return PLAN_TIER.basic;
    case "editor":     return PLAN_TIER.pro;
    case "enterprise": return PLAN_TIER.pro;
    case "basic":      return PLAN_TIER.basic;
    case "standard":   return PLAN_TIER.standard;
    case "plus":       return PLAN_TIER.plus;
    case "pro":        return PLAN_TIER.pro;
    default:           return PLAN_TIER.basic;
  }
}

// ────────────────────────────────────────────────
// 「機能が利用可能か」判定 helpers
// ────────────────────────────────────────────────

/** ある feature を利用するために必要な最低プランを返す。
 *  features がどのプランにも含まれていない場合 (= 想定外) は最上位 Pro を返す
 *  (= 安全側で「最上位ですら利用不能」と扱う)。 */
export function getRequiredPlanForFeature(featureKey: FeatureKey): PlanTier {
  for (const tier of PLAN_TIER_ORDER) {
    if (PLAN_FEATURES[tier].includes(featureKey)) return tier;
  }
  return PLAN_TIER.pro;
}

/** 現プラン (plan) で feature が利用可能なら true。 */
export function isPlanAllowed(plan: PlanTier, featureKey: FeatureKey): boolean {
  return PLAN_FEATURES[plan].includes(featureKey);
}

/** プラン制限の判定結果 */
export type PlanAccessState =
  | {
      allowed: true;
      reason: "allowed";
      message: string;
    }
  | {
      allowed: false;
      reason: "plan_required";
      /** この機能に必要な最低プラン (= 内部キー) */
      requiredPlan: PlanTier;
      /** 表示用プラン名 */
      requiredPlanLabel: string;
      message: string;
    };

/** プラン視点の利用可否を判定する。
 *  - allowed=true なら通常表示 / クリック可能
 *  - allowed=false なら UI 側でグレーアウト + クリック不可にする */
export function getPlanAccessState(args: {
  plan: PlanTier;
  featureKey: FeatureKey;
}): PlanAccessState {
  const { plan, featureKey } = args;
  if (isPlanAllowed(plan, featureKey)) {
    return { allowed: true, reason: "allowed", message: "利用できます" };
  }
  const requiredPlan = getRequiredPlanForFeature(featureKey);
  const requiredPlanLabel = PLAN_LABELS[requiredPlan];
  return {
    allowed: false,
    reason: "plan_required",
    requiredPlan,
    requiredPlanLabel,
    message: `この機能は${requiredPlanLabel}プラン以上で利用できます`,
  };
}

// ────────────────────────────────────────────────
// 将来の plan + role 統合判定 (= 拡張用、現在は plan のみ評価)
// ────────────────────────────────────────────────

/** 将来の役割。今はまだコード内では使われていないが、型と判定順を定義しておくと
 *  API 側で導入する際にも同じ shape を共有できる。 */
export type FutureRole =
  | "owner"
  | "admin"
  | "editor"
  | "operator"
  | "viewer"
  | "client_operator";

/** action のキー (= 将来 role が制御する操作)。
 *  今は "view" / "edit" / "delete" の 3 種を想定。 */
export type ActionKey = "view" | "edit" | "delete";

/** plan + role 統合判定の結果。PlanAccessState を継承する形だが、将来は
 *  `reason: "permission_denied"` 等が追加される。 */
export type AccessState =
  | PlanAccessState
  | {
      allowed: false;
      reason: "permission_denied";
      message: string;
    };

/** plan / role / featureKey / actionKey を受け取って統合判定する。
 *
 *  判定順:
 *    1. plan が feature を許可しているか (= getPlanAccessState)
 *    2. role が action を許可しているか (= 現時点では未実装 / 常に許可)
 *
 *  TODO: role / action 制御は client_operator 等の外部ユーザー導入時に追加する。
 *  現時点では plan の判定のみを行い、role 関連の引数は受け取るが評価しない。
 *  この shape で公開しておくことで、将来 role 制御を追加しても API 互換性が保てる。 */
export function getAccessState(args: {
  plan: PlanTier;
  role?: FutureRole;
  featureKey: FeatureKey;
  actionKey?: ActionKey;
}): AccessState {
  const planState = getPlanAccessState({ plan: args.plan, featureKey: args.featureKey });
  if (!planState.allowed) return planState;

  // TODO: ここで role / actionKey による判定を追加する。
  // 例: role="client_operator" で actionKey="edit" / "delete" → 不許可
  //     role="viewer" で actionKey !== "view" → 不許可
  // 現時点では plan が許可していれば常に許可。
  return planState;
}
