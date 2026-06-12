"use client";

// src/app/pricing/_content.tsx
// プランページのクライアントコンポーネント本体。
// page.tsx（Server Component）が searchParams を受け取り、props として渡す。
// useSearchParams() 依存なし。
//
// Props:
//   source — 流入元 UI（"header" | "banner" | "gate" | "preview" | "settings"）
//   from   — 現在プラン名（"basic" など、tracking ログ用）
//   to     — 流入元コンテキストでのアップグレード先プラン名（tracking ログ用）

import { useState, useEffect } from "react";
import Link from "next/link";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { trackEvent } from "@/lib/event-tracker";
import { getDevToken } from "@/lib/api-client";
import { Button } from "@/components/shared";
import { mapPlanNameToTier, PLAN_TIER_ORDER, PLAN_LABELS, type PlanTier } from "@/lib/constants/plans";

// ── チェックアイテム ─────────────────────────────────────────────────
function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-ink-2">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-ink"
      >
        ✓
      </span>
      <span>{children}</span>
    </div>
  );
}

// ── セクション見出し (= 「個人利用プラン」/「法人利用プラン」 の区切り) ──
// 旧 SectionLabel は uppercase + ink-3 で控えめだったため、ユーザー要望で
// font-round + text-ink + 大きいサイズに変更し、明確な区切りに。
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-round mb-4 mt-2 text-[20px] font-bold tracking-[-0.01em] text-ink sm:text-[22px]">
      {children}
    </h2>
  );
}

// ── 現在の契約状態 ──────────────────────────────────────────────────
//   loading  : /api/oas/[id]/plan-info の fetch 中 (= oaId 指定時のみ発火)
//   no_plan  : 未契約 / 非アクティブ status (canceled/past_due/incomplete/paused)
//   active   : active or trialing で、判定可能な PlanTier に正規化済み
type CurrentPlanState =
  | { kind: "loading" }
  | { kind: "no_plan" }
  | { kind: "active"; tier: PlanTier };

// ── カードごとの表示状態 ────────────────────────────────────────────
//   loading_current_plan    : current plan info ロード中、CTA を仮 disable
//   current                 : このカードがログイン中ユーザーの現契約 (= 「利用中」)
//   downgrade_not_supported : 現プランより下位 (= 「ダウングレード未対応」、押せない)
//   upgradable              : 上位プラン or 未契約 (= 「アップグレードする」、checkout)
type CardState =
  | "loading_current_plan"
  | "current"
  | "downgrade_not_supported"
  | "upgradable";

function computeCardState(
  tier: PersonalPlanCard["tier"],
  current: CurrentPlanState,
): CardState {
  if (current.kind === "loading") return "loading_current_plan";
  if (current.kind === "no_plan") return "upgradable";
  if (tier === current.tier) return "current";
  // ranking 比較: PLAN_TIER_ORDER の indexOf で確実に判定
  const order = PLAN_TIER_ORDER as readonly PlanTier[];
  return order.indexOf(tier) < order.indexOf(current.tier) ? "downgrade_not_supported" : "upgradable";
}

// ── コンテキスト設定 ─────────────────────────────────────────────────

/** source ごとのヘッダー見出し・サブテキスト */
const SOURCE_HEADING: Record<string, { title: string; sub: string }> = {
  gate: {
    title: "もう1作品、作れるようにしませんか？",
    sub:   "現在のプランでは作品をこれ以上追加できません。上位プランにアップグレードして、制作を続けましょう。",
  },
  banner: {
    title: "作品数の上限に近づいています",
    sub:   "今のうちにプランをアップグレードしておくと、スムーズに制作を続けられます。",
  },
  preview: {
    title: "プレビューはいかがでしたか？",
    sub:   "動作を確認できたら、次は本番公開のステップです。上位プランで続けましょう。",
  },
  settings: {
    title: "プランの変更を検討していますか？",
    sub:   "現在のご利用状況と比較しながら、ご自身のペースでご検討ください。",
  },
};
// DEFAULT_HEADING は削除済 (= ユーザー要望でヒーローエリア撤去、source 指定時のみ
// SOURCE_HEADING を表示する設計に変更)。

/** 個人利用プランカード定義。
 *  Basic / Standard / Pro / Plus の順で表示する (= user request)。
 *  価格は未確定のため "準備中" / "詳細はお問い合わせください" 表記。
 *  CTA「アップグレードする」は POST /api/billing/checkout → Stripe Checkout に遷移する。
 *  STRIPE_PRICE_<TIER> が未設定のプランは API 側で 400「準備中」を返す。 */
interface PersonalPlanCard {
  /** 内部キー (= future plan-guard との接続用、現時点では表示制御のみ) */
  tier:        "basic" | "standard" | "pro" | "plus";
  label:       string;
  tagline:     string;
  price:       string;
  priceUnit:   string;
  features:    string[];
  /** 推奨タグを出すか (= 中心的に推したいプラン) */
  recommended?: boolean;
}

// 個人利用プラン (= 機能階段順: Basic → Standard → Plus → Pro)。
// 内部 plan tier (= "basic"|"standard"|"plus"|"pro") は変更せず、表示文言と並び順のみを
// FEATURE mapping に揃える (= constants/plans.ts):
//   Basic    : work.info / characters / messages / scenarioFlow
//   Standard : + audience
//   Plus     : + liffDisplay / destinations
//   Pro      : + location
// 価格: Basic は ¥5,400/月 (= Stripe 本番側で確定済、運用上ハードコード)。
// 他は seed/env に確定値が無いため "準備中" のまま (= 金額は推測で入れない方針)。
// recommended: Plus に付与 (= 一般的な制作・運用に最適な位置として推奨)。
const PERSONAL_PLAN_CARDS: readonly PersonalPlanCard[] = [
  {
    tier:    "basic",
    label:   "Basic",
    tagline: "まずは作品の基本設計とLINE上の体験づくりを始めたい方向け",
    price:   "¥5,400",
    priceUnit: "/ 月",
    features: [
      "作品情報・キャラクター管理",
      "メッセージ・謎の作成",
      "シナリオフロー設計",
    ],
  },
  {
    tier:    "standard",
    label:   "Standard",
    tagline: "参加者管理も含めて、継続的に作品を運用したい方向け",
    price:   "準備中",
    priceUnit: "",
    features: [
      "Basic の全機能",
      "オーディエンス管理",
      "参加者の状態確認",
    ],
  },
  {
    tier:    "plus",
    label:   "Pro",
    tagline: "LIFFページや外部導線を使って、体験の幅を広げたい方向け",
    price:   "準備中",
    priceUnit: "",
    recommended: true,
    features: [
      "Standard の全機能",
      "LIFF表示設定",
      "遷移先URL設定",
    ],
  },
  {
    tier:    "pro",
    label:   "Pro Max",
    tagline: "GPS・QR・現地チェックインなど、現場連動の体験まで運用したい方向け",
    price:   "準備中",
    priceUnit: "",
    features: [
      "Pro の全機能",
      "ロケーション機能",
      "GPS / QR / 現地チェックイン",
    ],
  },
];

/** 法人プランの定義 (= 別カード扱い、個人利用とは分けて表示)。
 *  個人プランの単なる上位ではなく、**導入支援・個別相談・運用支援** の位置づけ。
 *  features は具体的な相談スコープを示し、個人プランとの違いを明確にする。 */
const ENTERPRISE_PLAN = {
  label:       "法人プラン",
  price:       "お問い合わせください",
  description: "企業・IP・イベント・舞台連動など、個別要件に合わせた導入設計から運用支援までご相談いただけます。",
  features: [
    "法人・商業利用の個別相談",
    "導入設計・初期設定サポート",
    "運用支援・追加開発の相談",
  ],
  ctaText:     "法人プランについて相談する",
};

/** 法人プランカード定義 (= 個人プランと同じ機能階段を法人利用向けに提示)。
 *  個人プランと違い Stripe Checkout は持たず、すべて「相談する」→ FeedbackModal に集約する
 *  (= 法人は個別要件・契約形態が異なるため、申込ではなく相談導線に一本化)。
 *  各カードの planLabel は FeedbackModal の「希望プラン」初期値として渡す
 *  (= PLAN_LABELS と一致させ、Slack 通知の希望プラン表記とも揃える)。
 *  委託プラン (delegated) は Pro Max 相当の全機能 + 企画〜運用の代行を含む最上位。 */
interface BusinessPlanCard {
  /** 希望プランとして相談フォームに渡す表示名 (= PLAN_LABELS と一致) */
  planLabel:    string;
  tagline:      string;
  features:     string[];
  /** 推奨タグを出すか */
  recommended?: boolean;
}

const BUSINESS_PLAN_CARDS: readonly BusinessPlanCard[] = [
  {
    planLabel: PLAN_LABELS.basic,        // "Basic"
    tagline:   "作品の基本設計とLINE上の体験づくりを、法人利用で始めたい方向け",
    features: [
      "作品情報・キャラクター管理",
      "メッセージ・謎の作成",
      "シナリオフロー設計",
    ],
  },
  {
    planLabel: PLAN_LABELS.standard,     // "Standard"
    tagline:   "参加者管理も含めて、継続的に作品を運用したい法人向け",
    features: [
      "Basic の全機能",
      "オーディエンス管理",
      "参加者の状態確認",
    ],
  },
  {
    planLabel: PLAN_LABELS.plus,         // "Pro"
    tagline:   "LIFFページや外部導線を使って、体験の幅を広げたい法人向け",
    recommended: true,
    features: [
      "Standard の全機能",
      "LIFF表示設定",
      "遷移先URL設定",
    ],
  },
  {
    planLabel: PLAN_LABELS.pro,          // "Pro Max"
    tagline:   "GPS・QR・現地チェックインなど、現場連動の体験まで運用したい法人向け",
    features: [
      "Pro の全機能",
      "ロケーション機能",
      "GPS / QR / 現地チェックイン",
    ],
  },
  {
    planLabel: PLAN_LABELS.delegated,    // "委託プラン"
    tagline:   "企画から実装・運用までまるごとお任せいただける委託プラン",
    features: [
      "Pro Max 相当の全機能",
      "企画・シナリオ制作の代行",
      "導入〜運用の伴走サポート",
    ],
  },
];

// ── クライアントコンポーネント本体 ────────────────────────────────────
// props は page.tsx（Server Component）が searchParams から渡す
export function PricingContent({
  source,
  from:     fromParam,
  to:       toParam,
  oaId,
  canceled,
  priceOverrides,
  usageType,
  embedded = false,
}: {
  source?:   string;
  from?:     string;
  to?:       string;
  /** Stripe Checkout の申込先 OA ID（あれば Stripe ボタンを有効化） */
  oaId?:     string;
  /** "1" のとき Stripe Checkout からのキャンセル戻りを示すバナーを表示 */
  canceled?: string;
  /** Server Component (= page.tsx) で Stripe Price から取得した各プランの金額。
   *  取得失敗時は { formatted: "お問い合わせください", priceUnit: "" } が入る。
   *  カード描画時に `PERSONAL_PLAN_CARDS` の hardcoded `price` / `priceUnit` を上書きする。 */
  priceOverrides?: Record<PersonalPlanCard["tier"], { formatted: string; priceUnit: string }>;
  /** 対象 OA の利用区分 (= page.tsx でアクセス判定込みに解決)。
   *  personal → 個人利用プランのみ / business → 法人プランのみ表示。
   *  null/undefined（oa_id なし / 権限なし / 解決不可）→ 両方表示（既存挙動）。 */
  usageType?: "personal" | "business" | null;
  /** 設定の専用ページ等に料金カードだけ埋め込むモード。
   *  ヒーロー見出し / キャンセルバナー / β版バナー / 「もう少し試してみる」/ ページ外枠 /
   *  mount 時の画面遷移トラッキングを省き、カード比較のみを表示する（現在プラン判定・checkout・
   *  法人相談は維持）。 */
  embedded?: boolean;
}) {
  // 利用区分によるプラン群の出し分け。usageType が無い（LP 直開き / 権限なし等）は両方表示。
  const showPersonalPlans = usageType !== "business";
  const showBusinessPlans = usageType !== "personal";
  const [requested,            setRequested]            = useState(false);
  /** 押された個別プランの tier (= "basic"|"standard"|"pro"|"plus")。
   *  null = checkout 進行中ではない。
   *  「処理中...」表示は loadingTier === plan.tier の行のみ。 */
  const [checkoutLoadingTier, setCheckoutLoadingTier] = useState<PersonalPlanCard["tier"] | null>(null);
  const [checkoutError,        setCheckoutError]        = useState<string | null>(null);

  // 現在の契約状態。oaId 指定時に /api/oas/[id]/plan-info から取得する。
  //   - 取得前: loading
  //   - oaId なし / fetch 失敗 / 非アクティブ status: no_plan
  //   - active or trialing: active(tier)
  // ユーザー要望: 「利用中」「ダウングレード未対応」表示用、checkoutLoadingTier とは独立。
  const [currentPlan, setCurrentPlan] = useState<CurrentPlanState>(
    oaId ? { kind: "loading" } : { kind: "no_plan" }
  );
  // 対象 OA が β版利用中か（plan-info の grant_kind="beta"）。現在プラン表示の注記に使う。
  const [isBetaPlan, setIsBetaPlan] = useState(false);

  // source ごとのサブ見出し (= gate / banner / preview / settings)。
  // ユーザー要望でデフォルトの大きなヒーローエリアは削除。source 指定時のみ
  // 軽量な見出し + サブテキストを表示する (= コンテキストは保持)。
  const sourceHeading = source ? SOURCE_HEADING[source] ?? null : null;

  useEffect(() => {
    // embedded（設定ページ埋め込み）では /pricing の画面遷移ログを出さない（計測汚染防止）。
    if (embedded) return;
    const token = getDevToken();

    // 課金専用ログ（from/to コンテキスト付き）
    trackBillingEvent("pricing_view", token, source, { from: fromParam, to: toParam });

    // 汎用行動ログ（event_logs）— payload に from/to も含める
    trackEvent("screen_view",      { page: "/pricing" },                                       { token });
    trackEvent("upgrade_interest", { action: "view", source, from: fromParam, to: toParam },   { token });
    trackEvent("flow_step",        { step: "pricing", source: source ?? "direct" },            { token });
  // searchParams は mount 時に1回だけ読めば十分
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 現在の契約 plan を取得 ──
  // oaId が無ければ未契約扱い。oaId 指定時のみ /api/oas/[id]/plan-info を fetch。
  // 仕様:
  //   - status が active/trialing 以外 (= canceled/past_due/incomplete/paused) は no_plan 扱い
  //     → 機能制限 (basic フォールバック) と整合させ、UI 上も「利用中」を出さない
  //   - 404 / fetch エラーは握りつぶし、no_plan で続行 (= pricing 表示は壊さない)
  useEffect(() => {
    if (!oaId) return;
    const token = getDevToken();
    fetch(`/api/oas/${oaId}/plan-info`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          setCurrentPlan({ kind: "no_plan" });
          return;
        }
        let payload: unknown = null;
        try { payload = await res.json(); } catch { /* 非 JSON: 落とさない */ }
        const data = (payload as { data?: { plan_name?: unknown; status?: unknown; grant_kind?: unknown } } | null)?.data;
        if (!data || typeof data.plan_name !== "string") {
          setCurrentPlan({ kind: "no_plan" });
          return;
        }
        setIsBetaPlan(data.grant_kind === "beta");
        const isActive = data.status === "active" || data.status === "trialing";
        if (!isActive) {
          setCurrentPlan({ kind: "no_plan" });
          return;
        }
        setCurrentPlan({ kind: "active", tier: mapPlanNameToTier(data.plan_name) });
      })
      .catch(() => setCurrentPlan({ kind: "no_plan" }));
  }, [oaId]);

  /** 法人プラン用 CTA — FeedbackModal を開く既存導線。
   *  hopedPlan: 押されたカードの希望プラン表示名 (= PLAN_LABELS)。
   *  指定時はモーダルの「希望プラン」初期選択に使う (= 改ざん防止のため値ではなく表示名を渡す)。 */
  function handleEnterpriseInquiry(hopedPlan?: string) {
    const token = getDevToken();
    trackBillingEvent("pricing_cta_click", token, source, { from: fromParam, to: "enterprise" });
    trackEvent("upgrade_interest", { action: "cta_click", source, from: fromParam, to: "enterprise" }, { token });
    window.dispatchEvent(
      new CustomEvent("open-feedback-modal", {
        detail: { pricingSource: source, hopedPlan },
      })
    );
    setRequested(true);
  }

  /** API response の error フィールドから安全に文字列メッセージを抽出する。
   *  ApiError は `{ code, message, details? }` 形状なので、object をそのまま
   *  setCheckoutError に渡すと React error #31 (Objects are not valid as a React child)
   *  でページ全体がクラッシュする。常に string か null になるよう正規化する。
   *
   *  さらに `code === "INTERNAL_SERVER_ERROR"` の generic backend message
   *  (= 「サーバーエラーが発生しました」) はそのままだと原因が分からず不親切なので、
   *  fallback (= ユーザー向けの汎用文言) に置き換える。 */
  function extractErrorMessage(payload: unknown, fallback: string): string {
    if (payload && typeof payload === "object" && "error" in payload) {
      const err = (payload as { error: unknown }).error;
      if (typeof err === "string") return err;
      if (err && typeof err === "object") {
        const errObj = err as { code?: unknown; message?: unknown };
        // INTERNAL_SERVER_ERROR は backend の汎用文言なのでユーザー向け fallback に変換
        if (errObj.code === "INTERNAL_SERVER_ERROR") {
          return fallback;
        }
        if (typeof errObj.message === "string" && errObj.message.length > 0) {
          return errObj.message;
        }
      }
    }
    return fallback;
  }

  /** 個人プラン用 CTA — Stripe Checkout に遷移。
   *  oaId が無い場合は OA 選択ページへ誘導する。
   *  current / downgrade_not_supported / loading_current_plan の場合は no-op (= 早期 return)。 */
  async function handlePersonalUpgrade(plan: PersonalPlanCard["tier"]) {
    if (checkoutLoadingTier !== null) return; // 二重クリック / 他プランの進行中クリック防止
    // 現在の契約状態に応じて、利用中・ダウングレード対象・現プラン情報ロード中は早期 return
    // (= 視覚 disabled + a11y aria-disabled で押せないが、念のため handler 側でも guard)
    const cardState = computeCardState(plan, currentPlan);
    if (cardState !== "upgradable") return;
    setCheckoutError(null);

    if (!oaId) {
      setCheckoutError("アカウントを選択してから操作してください。アカウントリストへ移動します。");
      window.setTimeout(() => { window.location.href = "/oas"; }, 1500);
      return;
    }

    setCheckoutLoadingTier(plan);
    try {
      const token = getDevToken();
      trackBillingEvent("pricing_cta_click", token, source, { from: fromParam, to: plan });
      trackEvent("upgrade_interest", { action: "stripe_checkout_start", source, from: fromParam, to: plan }, { token });

      const res = await fetch("/api/billing/checkout", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, oaId }),
      });

      // response body が空 / 非 JSON でも UI を落とさない
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // 非 JSON response → data は null のままで失敗扱い
      }

      const url = (data as { data?: { url?: unknown } } | null)?.data?.url;
      if (!res.ok || typeof url !== "string") {
        setCheckoutError(extractErrorMessage(data, "決済の準備中です。時間をおいて再度お試しください。"));
        return;
      }
      window.location.href = url;
    } catch {
      setCheckoutError("エラーが発生しました。もう一度お試しください。");
    } finally {
      setCheckoutLoadingTier(null);
    }
  }

  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-[640px] px-5 py-6 sm:px-0 sm:py-8 lg:max-w-[1120px]"}>

      {/* ── ヒーローエリアは削除 (= ユーザー要望)。source 指定時のみ軽量な context 見出しを表示。 ── */}
      {!embedded && sourceHeading && (
        <div className="mb-6 text-center">
          <h1 className="font-round mb-2 text-[clamp(18px,3vw,22px)] font-bold leading-[1.3] tracking-[-0.02em] text-ink">
            {sourceHeading.title}
          </h1>
          <p className="text-[12px] leading-[1.7] text-ink-2">
            {sourceHeading.sub}
          </p>
        </div>
      )}

      {/* キャンセル戻りバナー（Stripe Checkout キャンセル時） */}
      {!embedded && canceled === "1" && (
        <div
          role="status"
          className="mb-3.5 rounded-field border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12px] leading-[1.6] text-warn"
        >
          ⚠ お申し込みをキャンセルしました。ご検討中の場合はお気軽にご相談ください。
        </div>
      )}

      {/* Stripe エラー */}
      {checkoutError && (
        <div
          role="alert"
          className="mb-2.5 rounded-field border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12px] leading-[1.6] text-danger"
        >
          {checkoutError}
        </div>
      )}

      {/* β版利用中の注記（現在プラン表示）。課金導線・Stripe 処理は一切動かさない。
          embedded（設定ページ）では現在プランを上部に別表示するため省略。 */}
      {!embedded && isBetaPlan && (
        <div
          role="status"
          className="mb-4 rounded-field border border-brand/30 bg-brand-soft px-3.5 py-2.5 text-[13px] font-semibold text-brand-ink"
        >
          現在のプラン: β版（Pro Max相当）— 機能・期間制限なくご利用いただけます。
        </div>
      )}

      {/* ── 個人利用プラン (= PC で 4 列、tablet で 2 列、mobile で 1 列) ──
          対象 OA が法人利用 (usageType=business) のときは非表示。 */}
      {showPersonalPlans && (<>
      {!embedded && <SectionHeading>個人利用プラン</SectionHeading>}
      <div className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-4">
        {PERSONAL_PLAN_CARDS.map((plan) => {
          const cardState = computeCardState(plan.tier, currentPlan);
          const isCurrent = cardState === "current";
          const isDowngrade = cardState === "downgrade_not_supported";
          const isLoadingCurrentPlan = cardState === "loading_current_plan";
          const isRecommended = plan.recommended === true;
          // current が優先、それ以外で recommended のときに「おすすめ」バッジ
          const showCurrentBadge = isCurrent;
          const showRecommendedBadge = !isCurrent && isRecommended;
          // Stripe Price からの取得値で hardcoded `price` / `priceUnit` を上書き。
          // 取得失敗時 (= override の formatted="お問い合わせください") も hardcoded
          // "準備中" を表示せず、fallback 文言を採用する。
          const override     = priceOverrides?.[plan.tier];
          const displayPrice = override?.formatted ?? plan.price;
          const displayUnit  = override?.priceUnit ?? plan.priceUnit;
          // price が長文 (= "お問い合わせください" / "詳細はお問い合わせください" / "準備中") のときは
          // 小さく muted で表示
          const isPriceMuted = displayPrice.length > 8 || displayPrice === "準備中";
          const isThisLoading  = checkoutLoadingTier === plan.tier;
          const isOtherLoading = checkoutLoadingTier !== null && !isThisLoading;

          // ボタン文言の優先順位:
          //   1. isThisLoading       → "処理中..."
          //   2. isLoadingCurrentPlan → "確認中..."
          //   3. isCurrent           → "利用中"
          //   4. isDowngrade         → "ダウングレード未対応"
          //   5. その他              → "アップグレードする"
          let buttonLabel = "アップグレードする";
          if (isThisLoading) buttonLabel = "処理中...";
          else if (isLoadingCurrentPlan) buttonLabel = "確認中...";
          else if (isCurrent) buttonLabel = "利用中";
          else if (isDowngrade) buttonLabel = "ダウングレード未対応";

          // 押せない条件: 「処理中」「確認中」「利用中」「ダウングレード未対応」
          const isClickDisabled = isThisLoading || isLoadingCurrentPlan || isCurrent || isDowngrade;

          // 「現在のプラン」枠は強調 (= sky border)、それ以外は通常 / 推奨枠
          const cardBorder = isCurrent
            ? "border-2 border-sky shadow-sm bg-sky-soft/30"
            : isRecommended
              ? "border-2 border-brand shadow-card"
              : "border border-line shadow-sm";

          return (
            <div
              key={plan.tier}
              className={
                "relative flex h-full flex-col gap-2.5 rounded-card bg-surface px-[18px] py-[20px] sm:px-5 sm:py-[22px] " +
                cardBorder
              }
            >
              {/* バッジ: current > recommended の優先順位 (= 同時表示しない) */}
              {showCurrentBadge && (
                <span className="absolute -top-2.5 left-3.5 rounded-full bg-sky-ink px-2.5 py-0.5 text-[10px] font-bold tracking-[0.05em] text-white">
                  現在のプラン
                </span>
              )}
              {showRecommendedBadge && (
                <span className="absolute -top-2.5 left-3.5 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold tracking-[0.05em] text-white">
                  おすすめ
                </span>
              )}

              <h3 className="font-round text-[18px] font-extrabold tracking-[-0.02em] text-ink">
                {plan.label}
              </h3>
              <p className="text-[12px] leading-[1.6] text-ink-2">
                {plan.tagline}
              </p>

              <div className="py-1">
                <p
                  className={
                    "font-bold tracking-[-0.02em] " +
                    (isPriceMuted
                      ? "text-[14px] text-ink-3"
                      : "text-[22px] text-ink")
                  }
                >
                  {displayPrice}
                  {displayUnit && (
                    <span className="ml-1 text-[11px] font-medium text-ink-3">
                      {displayUnit}
                    </span>
                  )}
                </p>
              </div>

              <div className="mt-1 flex flex-col gap-[7px]">
                {plan.features.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </div>

              <Button
                type="button"
                onClick={() => handlePersonalUpgrade(plan.tier)}
                // disabled は「押されたプラン (= processing)」「利用中」「ダウングレード未対応」
                // 「現プラン確認中」に適用。他のアップグレード可能プランは disabled にせず通常表示、
                // 多重クリックは handler 側 guard で防ぐ。
                disabled={isClickDisabled}
                // a11y: 他プランの checkout 進行中ボタンは「今は押せない」を semantic に伝える (= 視覚維持)
                aria-disabled={(isOtherLoading || isClickDisabled) || undefined}
                aria-busy={(isThisLoading || isLoadingCurrentPlan) || undefined}
                // current / downgrade は控えめ表現の ghost、recommended は primary、他は ghost
                variant={isCurrent || isDowngrade ? "ghost" : isRecommended ? "primary" : "ghost"}
                size="sm"
                fullWidth
                aria-label={
                  isCurrent ? `${plan.label}プランは現在利用中です`
                  : isDowngrade ? `${plan.label}プランへのダウングレードは未対応です`
                  : `${plan.label}プランにアップグレード`
                }
                className="mt-auto"
              >
                {buttonLabel}
              </Button>
            </div>
          );
        })}
      </div>
      </>)}

      {/* ── 法人プラン (個人利用とは分けて表示、すべて相談導線に一本化) ──
          対象 OA が個人利用 (usageType=personal) のときは非表示。 */}
      {showBusinessPlans && (<>
      {!embedded && <SectionHeading>法人プラン</SectionHeading>}
      <p className="mb-4 text-[13px] leading-[1.7] text-ink-2">
        {ENTERPRISE_PLAN.description}
        <br />
        各プランは個別要件・契約形態に合わせてご案内します。気になるプランの「相談する」からお問い合わせください。
      </p>
      <div className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-5">
        {BUSINESS_PLAN_CARDS.map((plan) => {
          const isRecommended = plan.recommended === true;
          const cardBorder = isRecommended
            ? "border-2 border-brand shadow-card"
            : "border border-line shadow-sm";
          return (
            <div
              key={plan.planLabel}
              className={
                "relative flex h-full flex-col gap-2.5 rounded-card bg-surface px-[18px] py-[20px] sm:px-5 sm:py-[22px] " +
                cardBorder
              }
            >
              {isRecommended && (
                <span className="absolute -top-2.5 left-3.5 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold tracking-[0.05em] text-white">
                  おすすめ
                </span>
              )}

              <h3 className="font-round text-[18px] font-extrabold tracking-[-0.02em] text-ink">
                {plan.planLabel}
              </h3>
              <p className="text-[12px] leading-[1.6] text-ink-2">
                {plan.tagline}
              </p>

              <div className="py-1">
                <p className="text-[14px] font-bold tracking-[-0.02em] text-ink-3">
                  お問い合わせください
                </p>
              </div>

              <div className="mt-1 flex flex-col gap-[7px]">
                {plan.features.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </div>

              <Button
                type="button"
                onClick={() => handleEnterpriseInquiry(plan.planLabel)}
                variant={isRecommended ? "primary" : "ghost"}
                size="sm"
                fullWidth
                aria-label={`${plan.planLabel}（法人）について相談する`}
                className="mt-auto"
              >
                相談する
              </Button>
            </div>
          );
        })}
      </div>
      </>)}

      {/* CTA フィードバック (= 相談フォームを開いた後の確認表示) */}
      {requested && (
        <div
          role="status"
          className="mb-3 rounded-field border border-brand/30 bg-brand-soft px-3 py-3 text-center text-[13px] font-semibold text-brand-ink"
        >
          ご相談フォームを開きました。内容を送信してください。
        </div>
      )}

      {!embedded && (
        <Link
          href="/oas"
          className="mt-2 block text-center text-[13px] text-ink-3 transition-colors hover:text-brand-ink hover:underline"
        >
          もう少し試してみる
        </Link>
      )}

    </div>
  );
}
