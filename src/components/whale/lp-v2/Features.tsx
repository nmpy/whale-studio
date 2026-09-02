// src/components/whale/lp-v2/Features.tsx
//
// 管理機能の紹介。
// 各項目は実在する管理画面 (src/app/oas/[id]/...) とプラン機能キー
// (src/lib/constants/plans.ts の PLAN_FEATURES) に対応させている。
// 存在しない機能・未実装の機能はここに書かない。

import { Section, SectionHeading, Badge } from "./shared";

type Feature = {
  /** src/lib/constants/plans.ts の feature key に対応 (対応がないものは undefined)。 */
  title: string;
  body: string;
  icon: "work" | "character" | "message" | "flow" | "audience" | "liff" | "link" | "location";
};

const FEATURES: Feature[] = [
  {
    icon: "work",
    title: "作品情報",
    body: "タイトル・説明・公開ステータス・あいさつメッセージを 1 画面で管理します。",
  },
  {
    icon: "character",
    title: "キャラクター",
    body: "メッセージの送信者となる登場人物を登録し、誰から届く物語かを設計します。",
  },
  {
    icon: "message",
    title: "メッセージ・謎",
    body: "フェーズごとの配信メッセージと謎チャレンジを管理。「1通目 → 10分後の返信 → 2通目」のような時間差の進行も組めます。スプレッドシートからの一括取り込みにも対応。",
  },
  {
    icon: "flow",
    title: "シナリオフロー",
    body: "フェーズの追加・並び替え・編集と、分岐を含む遷移フローをノードグラフで一括設計します。",
  },
  {
    icon: "audience",
    title: "オーディエンス",
    body: "総プレイヤー・今日の参加・クリア率などの統計に加え、リアルタイムの進行状況、フロー分析、セグメント、トラッキングを確認できます。",
  },
  {
    icon: "liff",
    title: "LIFF ページ",
    body: "作品専用の LIFF ページをブロック単位で組み立て。あらすじ、キャラクター一覧、アンケートなどを LINE 内で表示します。",
  },
  {
    icon: "link",
    title: "遷移先 URL / トラッキング",
    body: "外部導線に流入計測を付与し、どの導線から参加が生まれたかを追跡します。",
  },
  {
    icon: "location",
    title: "ロケーション（現地連動）",
    body: "QR・GPS・Beacon で現地チェックインを発火。印刷用 QR シートの出力や、チェックイン履歴の確認まで行えます。",
  },
];

export function Features() {
  return (
    <Section id="features" tint>
      <SectionHeading
        eyebrow="Features"
        title="物語体験の運用に必要なものを、ひと通り。"
        subtitle="脚本づくりから当日の現場対応まで。運用の途中で別ツールに切り替えずに済むことを重視しています。"
      />

      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {FEATURES.map((f) => (
          <li
            key={f.title}
            className="rounded-2xl border border-[color:var(--ws-border)] bg-[color:var(--ws-surface)] px-6 py-7 transition-colors duration-200 hover:border-[color:var(--ws-border-strong)]"
          >
            <div className="mb-4 text-[color:var(--ws-navy)]">
              <FeatureIcon name={f.icon} />
            </div>
            <h3 className="text-[16px] md:text-[17px] font-bold leading-snug text-[color:var(--ws-text)] mb-2.5">
              {f.title}
            </h3>
            <p className="text-[13px] md:text-[13.5px] leading-[1.95] text-[color:var(--ws-text-muted)]">
              {f.body}
            </p>
          </li>
        ))}
      </ul>

      {/* 現地連動の 3 方式は問い合わせで必ず聞かれるため、単独で補足する。
          文言は src/app/oas/[id]/locations/page.tsx の説明と揃えている。 */}
      <div className="mt-10 md:mt-12 rounded-2xl border border-[color:var(--ws-border)] bg-[color:var(--ws-surface)] p-7 md:p-9">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h3 className="text-[16px] md:text-[18px] font-bold text-[color:var(--ws-text)]">
            現地チェックインは 3 方式から選べます
          </h3>
          <Badge tone="brand">Pro Max</Badge>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {CHECKIN_MODES.map((m) => (
            <li key={m.title}>
              <p className="text-[14px] font-semibold text-[color:var(--ws-text)] mb-2">
                {m.title}
              </p>
              <p className="text-[13px] leading-[1.95] text-[color:var(--ws-text-muted)]">
                {m.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const CHECKIN_MODES = [
  {
    title: "QR チェックイン",
    body: "印刷物や看板の QR を読み取って進行する方式。低コストで安定しやすく、屋内外を問わず使いやすい。",
  },
  {
    title: "GPS チェックイン",
    body: "指定地点の近くに来たら進行する方式。屋外の周遊や街歩きに向いている。",
  },
  {
    title: "Beacon チェックイン",
    body: "近距離に入ったことを検知して進行する方式。店舗・展示・屋内周遊に向いている。",
  },
];

// ── アイコン: 自前の線画 SVG (外部アイコンライブラリを新規追加しない方針) ──────
function FeatureIcon({ name }: { name: Feature["icon"] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "work":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M7 13h7" />
        </svg>
      );
    case "character":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19.5a5.8 5.8 0 0 1 11 0" />
          <path d="M16 7.2a3 3 0 0 1 0 5.6M18.2 5a5.6 5.6 0 0 1 0 10" />
        </svg>
      );
    case "message":
      return (
        <svg {...common}>
          <path d="M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
          <path d="M9.2 9.4a2.4 2.4 0 0 1 4.6.8c0 1.6-2.3 2.1-2.3 2.1" />
          <line x1="11.5" y1="14.4" x2="11.51" y2="14.4" />
        </svg>
      );
    case "flow":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="5" rx="1.2" />
          <rect x="15" y="9" width="6" height="5" rx="1.2" />
          <rect x="3" y="16" width="6" height="5" rx="1.2" />
          <path d="M9 5.5h3a2 2 0 0 1 2 2v4M9 18.5h3a2 2 0 0 0 2-2v-4" />
        </svg>
      );
    case "audience":
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <rect x="5" y="12" width="3.4" height="6" rx="1" />
          <rect x="10.3" y="8" width="3.4" height="10" rx="1" />
          <rect x="15.6" y="4.5" width="3.4" height="13.5" rx="1" />
        </svg>
      );
    case "liff":
      return (
        <svg {...common}>
          <rect x="6" y="2.5" width="12" height="19" rx="2.4" />
          <path d="M9.5 6.5h5M9.5 10h5M9.5 13.5h3" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
          <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
        </svg>
      );
    case "location":
      return (
        <svg {...common}>
          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.6" />
        </svg>
      );
  }
}
