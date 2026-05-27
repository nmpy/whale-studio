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

// ── セクション見出し ─────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-ink-3">
      {children}
    </p>
  );
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
const DEFAULT_HEADING = {
  title: "小さくはじめて、必要なときに広げる。",
  sub:   "お試し利用から本格運用まで、ペースに合わせてステップアップできます。",
};

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
    label:   "Plus",
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
    label:   "Pro",
    tagline: "GPS・QR・現地チェックインなど、現場連動の体験まで運用したい方向け",
    price:   "準備中",
    priceUnit: "",
    features: [
      "Plus の全機能",
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

// ── クライアントコンポーネント本体 ────────────────────────────────────
// props は page.tsx（Server Component）が searchParams から渡す
export function PricingContent({
  source,
  from:     fromParam,
  to:       toParam,
  oaId,
  canceled,
}: {
  source?:   string;
  from?:     string;
  to?:       string;
  /** Stripe Checkout の申込先 OA ID（あれば Stripe ボタンを有効化） */
  oaId?:     string;
  /** "1" のとき Stripe Checkout からのキャンセル戻りを示すバナーを表示 */
  canceled?: string;
}) {
  const [requested,            setRequested]            = useState(false);
  /** 押された個別プランの tier (= "basic"|"standard"|"pro"|"plus")。
   *  null = checkout 進行中ではない。
   *  全プラン disabled は loadingTier !== null で判定する。
   *  「処理中...」表示は loadingTier === plan.tier の行のみ。 */
  const [checkoutLoadingTier, setCheckoutLoadingTier] = useState<PersonalPlanCard["tier"] | null>(null);
  const [checkoutError,        setCheckoutError]        = useState<string | null>(null);

  // コンテキストに応じた表示設定を導出
  const heading = (source ? SOURCE_HEADING[source] : null) ?? DEFAULT_HEADING;

  useEffect(() => {
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

  /** 法人プラン用 CTA — FeedbackModal を開く既存導線。 */
  function handleEnterpriseInquiry() {
    const token = getDevToken();
    trackBillingEvent("pricing_cta_click", token, source, { from: fromParam, to: "enterprise" });
    trackEvent("upgrade_interest", { action: "cta_click", source, from: fromParam, to: "enterprise" }, { token });
    window.dispatchEvent(
      new CustomEvent("open-feedback-modal", {
        detail: { pricingSource: source },
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
   *  oaId が無い場合は OA 選択ページへ誘導する。 */
  async function handlePersonalUpgrade(plan: PersonalPlanCard["tier"]) {
    if (checkoutLoadingTier !== null) return; // 二重クリック / 他プランの進行中クリック防止
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
    <div className="mx-auto w-full max-w-[640px] px-5 py-6 sm:px-0 sm:py-10">

      {/* ── ヘッダー（source ごとに見出し・サブを出し分け） ── */}
      <header className="mb-9 text-center">
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3.5 py-1 text-[11px] font-bold tracking-[0.05em] text-brand-ink">
          🐋 WHALE STUDIO プラン
        </span>
        <h1 className="font-round mb-2.5 text-[clamp(20px,4vw,26px)] font-extrabold leading-[1.3] tracking-[-0.02em] text-ink">
          {heading.title}
        </h1>
        <p className="whitespace-pre-line text-[13px] leading-[1.8] text-ink-2">
          {heading.sub}
        </p>
      </header>

      {/* ── コンセプト 3 点（source=default 以外は簡略表示） ── */}
      {!source && (
        <div className="mb-5 flex flex-col gap-1.5 sm:mb-7 sm:flex-row sm:flex-wrap sm:gap-2">
          {[
            { icon: "🌱", text: "まず1作品、気軽に試せる" },
            { text: "無理に決めなくていい" },
            { text: "成長に合わせてプラン変更できる" },
          ].map(({ icon, text }) => (
            <div
              key={text}
              className="flex items-center gap-2 rounded-field border border-line bg-surface px-3 py-2 text-[12px] text-ink-2 sm:flex-1 sm:basis-[140px] sm:px-3.5 sm:py-2.5"
            >
              {icon && <span className="flex-shrink-0 text-[16px]">{icon}</span>}
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}

      {/* キャンセル戻りバナー（Stripe Checkout キャンセル時） */}
      {canceled === "1" && (
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

      {/* ── 個人利用プラン (4 ティア grid) ── */}
      <SectionLabel>個人利用プラン</SectionLabel>
      <div className="mb-7 mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] sm:gap-3.5">
        {PERSONAL_PLAN_CARDS.map((plan) => {
          const isRecommended = plan.recommended === true;
          // price が長文 (= "詳細はお問い合わせください" や "準備中") のときは小さく muted で表示
          const isPriceMuted = plan.price.length > 8 || plan.price === "準備中";
          return (
            <div
              key={plan.tier}
              className={
                "relative flex flex-col gap-2.5 rounded-card bg-surface px-[18px] py-[20px] sm:px-5 sm:py-[22px] " +
                (isRecommended
                  ? "border-2 border-brand shadow-card"
                  : "border border-line shadow-sm")
              }
            >
              {/* 推奨タグ */}
              {isRecommended && (
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
                  {plan.price}
                  {plan.priceUnit && (
                    <span className="ml-1 text-[11px] font-medium text-ink-3">
                      {plan.priceUnit}
                    </span>
                  )}
                </p>
              </div>

              <div className="mt-1 flex flex-col gap-[7px]">
                {plan.features.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </div>

              {(() => {
                const isThisLoading  = checkoutLoadingTier === plan.tier;
                const isOtherLoading = checkoutLoadingTier !== null && !isThisLoading;
                return (
                  <Button
                    type="button"
                    onClick={() => handlePersonalUpgrade(plan.tier)}
                    // disabled は「押されたプラン」だけに適用 (= 視覚的にも処理中表示)。
                    // 他プランは disabled にせず通常表示を維持し、二重クリックは
                    // handlePersonalUpgrade 内の guard (checkoutLoadingTier !== null → 早期 return) で防ぐ。
                    disabled={isThisLoading}
                    // a11y: 他プランボタンは「今は押せない」状態を semantic に伝える (= 視覚は維持)
                    aria-disabled={isOtherLoading || undefined}
                    aria-busy={isThisLoading || undefined}
                    variant={isRecommended ? "primary" : "ghost"}
                    size="sm"
                    fullWidth
                    aria-label={`${plan.label}プランにアップグレード`}
                    className="mt-auto"
                  >
                    {isThisLoading ? "処理中..." : "アップグレードする"}
                  </Button>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* ── 法人プラン (個人利用とは分けて表示、導入支援・個別相談・運用支援の位置づけ) ── */}
      <SectionLabel>法人プラン</SectionLabel>
      <div className="mb-7 mt-2.5 flex flex-col items-stretch justify-between gap-4 rounded-card border border-dashed border-line bg-bg-tint px-[18px] py-[22px] sm:flex-row sm:items-start sm:gap-6 sm:p-7">
        <div className="min-w-0 flex-1">
          <h3 className="font-round mb-1.5 text-[18px] font-extrabold text-ink">
            {ENTERPRISE_PLAN.label}
          </h3>
          <p className="mb-1.5 text-[16px] font-bold text-ink">
            {ENTERPRISE_PLAN.price}
          </p>
          <p className="mb-3 text-[12px] leading-[1.7] text-ink-2">
            {ENTERPRISE_PLAN.description}
          </p>
          <div className="flex flex-col gap-[7px]">
            {ENTERPRISE_PLAN.features.map((f) => (
              <CheckItem key={f}>{f}</CheckItem>
            ))}
          </div>
        </div>
        <div className="flex-shrink-0 sm:self-center">
          {/* 個人プランカードと一貫した見た目を保ちつつ、相談・問い合わせ寄りの ghost トーン */}
          <Button
            type="button"
            onClick={handleEnterpriseInquiry}
            variant="ghost"
            size="sm"
            className="whitespace-nowrap"
          >
            {ENTERPRISE_PLAN.ctaText}
          </Button>
        </div>
      </div>

      {/* CTA フィードバック (= 相談フォームを開いた後の確認表示) */}
      {requested && (
        <div
          role="status"
          className="mb-3 rounded-field border border-brand/30 bg-brand-soft px-3 py-3 text-center text-[13px] font-semibold text-brand-ink"
        >
          ご相談フォームを開きました。内容を送信してください。
        </div>
      )}

      <Link
        href="/oas"
        className="mt-2 block text-center text-[13px] text-ink-3 transition-colors hover:text-brand-ink hover:underline"
      >
        もう少し試してみる
      </Link>

    </div>
  );
}
