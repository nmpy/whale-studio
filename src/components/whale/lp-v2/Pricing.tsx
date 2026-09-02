// src/components/whale/lp-v2/Pricing.tsx
//
// 料金の「概要」だけを置くセクション。詳細・実際の決済導線は既存 /pricing に集約する。
//
// ⚠ 価格の扱い (重要):
//   - 確定しているのは Basic の ¥5,400 / 月 のみ (src/app/pricing/_content.tsx に準拠)。
//   - Standard / Pro / Pro Max は Stripe 側の価格が未確定のため、既存 /pricing と同じく「準備中」と表示する。
//     **金額を推測で入れない** (= 既存 pricing 実装のコメントに明記された方針)。
//   - 法人プランは金額を出さず「お問い合わせください」。
//   - プラン名と機能範囲は src/lib/constants/plans.ts の PLAN_LABELS / PLAN_FEATURES に対応。

import { Section, SectionHeading, CtaLink, Badge, PRICING_HREF } from "./shared";

type PlanCard = {
  label: string;
  price: string;
  priceUnit?: string;
  tagline: string;
  adds: string;
  recommended?: boolean;
};

const PLANS: PlanCard[] = [
  {
    label: "Basic",
    price: "¥5,400",
    priceUnit: "/ 月",
    tagline: "まずは作品の基本設計と LINE 上の体験づくりを始めたい方向け",
    adds: "作品情報・キャラクター・メッセージ・シナリオフロー",
  },
  {
    label: "Standard",
    price: "準備中",
    tagline: "参加者管理も含めて、継続的に作品を運用したい方向け",
    adds: "Basic の全機能 + オーディエンス",
  },
  {
    label: "Pro",
    price: "準備中",
    tagline: "LIFF ページや外部導線を使って、体験の幅を広げたい方向け",
    adds: "Standard の全機能 + LIFF 表示設定・遷移先 URL 設定",
    recommended: true,
  },
  {
    label: "Pro Max",
    price: "準備中",
    tagline: "GPS・QR・現地チェックインなど、現場連動の体験まで運用したい方向け",
    adds: "Pro の全機能 + ロケーション",
  },
];

export function Pricing() {
  return (
    <Section id="pricing" tint>
      <SectionHeading
        eyebrow="Pricing"
        title="必要な機能の範囲で選べる 4 プラン。"
        subtitle="上位プランほど、運用・現場連動まで踏み込めます。最新の価格と決済は料金ページからご確認ください。"
      />

      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        {PLANS.map((p) => (
          <li
            key={p.label}
            className={`flex flex-col rounded-2xl border bg-[color:var(--ws-surface)] px-6 py-7 ${
              p.recommended
                ? "border-[color:var(--ws-navy)]/45 shadow-[0_2px_18px_rgba(34,38,100,0.09)]"
                : "border-[color:var(--ws-border)]"
            }`}
          >
            <div className="flex items-center gap-2 mb-3 min-h-[26px]">
              <h3 className="text-[17px] font-bold text-[color:var(--ws-text)]">
                {p.label}
              </h3>
              {p.recommended && <Badge tone="brand">おすすめ</Badge>}
            </div>

            <p className="mb-4">
              <span className="text-[26px] font-bold text-[color:var(--ws-text)]">
                {p.price}
              </span>
              {p.priceUnit && (
                <span className="text-[13px] text-[color:var(--ws-text-faint)] ml-1.5">
                  {p.priceUnit}
                </span>
              )}
            </p>

            <p className="text-[12.5px] leading-[1.9] text-[color:var(--ws-text-muted)] mb-4">
              {p.tagline}
            </p>

            <p className="mt-auto pt-4 border-t border-[color:var(--ws-border)] text-[12px] leading-[1.85] text-[color:var(--ws-text-faint)]">
              {p.adds}
            </p>
          </li>
        ))}
      </ul>

      {/* 法人 */}
      <div className="mt-8 md:mt-10 rounded-2xl border border-[color:var(--ws-border)] bg-[color:var(--ws-surface)] p-7 md:p-9 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="max-w-[620px]">
          <div className="flex items-center gap-2.5 mb-3">
            <h3 className="text-[17px] md:text-[18px] font-bold text-[color:var(--ws-text)]">
              法人利用・委託制作
            </h3>
            <Badge>お問い合わせ</Badge>
          </div>
          <p className="text-[13px] md:text-[13.5px] leading-[1.95] text-[color:var(--ws-text-muted)]">
            企業・IP・イベント・舞台連動など、個別要件に合わせた導入設計から運用支援までご相談いただけます。
            企画・シナリオ制作の代行や、導入〜運用の伴走サポートを含む委託プランもご用意しています。
          </p>
        </div>
        <div className="shrink-0">
          <CtaLink href={PRICING_HREF} variant="ghost">
            料金の詳細を見る
          </CtaLink>
        </div>
      </div>

      <p className="mt-6 text-[11.5px] md:text-[12px] leading-[1.9] text-[color:var(--ws-text-faint)]">
        ※ Standard / Pro / Pro Max は価格を準備中です。確定次第、料金ページに掲載します。
        表示価格・提供内容は変更となる場合があります。
      </p>
    </Section>
  );
}
