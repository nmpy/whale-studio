// src/app/page.tsx
// ランディングページ (Server Component)。
//
// 構成 (上から):
//   1. Hero          : 2 カラム。左にコピー + 2 系統 CTA、右にプロダクトモック (LINE 風チャット + 管理画面 + 浮遊カード)
//   2. Trust strip   : 6 つの主要機能キーワード
//   3. Features      : 4 カードを番号付きで強化 (各カードに小さな UI 装飾)
//   4. Use Cases     : 3 シーンを感情的なコピーで
//   5. Flow          : 導入 3 ステップ
//   6. Pricing       : 個人 / 法人 (おすすめ) / 導入サポート
//   7. End CTA       : 同じ 2 系統 CTA + 装飾背景
//
// 設計方針:
// - Server Component。クライアント hook なし、外部依存なし。
// - 既存トークン (brand / brand-soft / brand-mist / bg-tint / sky-soft / sky-ink / line /
//   rounded-card / font-round / font-num / shadow-card) と shared/Button の buttonClass を使用。
// - "Soft Premium SaaS" の雰囲気。背景に淡いグラデ blob、白〜淡いグリーン〜薄いブルーの清潔感を維持。
// - 認証 / Stripe / plan guard / webhook / middleware / Prisma には一切触らない。
// - 画像アセットへの依存なし。プロダクトモックは CSS / Tailwind の組み合わせで描画。

import Link from "next/link";
import { buttonClass } from "@/components/shared";

// ──────────────────────────────────────────────────────────────────────────────
// データ定義 (本ファイル内で完結)
// ──────────────────────────────────────────────────────────────────────────────

const FEATURES: { num: string; title: string; desc: string; mock: "chat" | "liff" | "qr" | "branch" }[] = [
  {
    num:   "01",
    title: "メッセージ配信",
    desc:  "シナリオ進行に合わせた配信を、ノーコードで設計。即時送信・スケジュール・分岐後の追撃まで一括管理。",
    mock:  "chat",
  },
  {
    num:   "02",
    title: "LIFFページ",
    desc:  "謎・アンケート・ヒント表示・物販導線などのカスタム LIFF を作品ごとに発行。LINE 内で完結する体験に。",
    mock:  "liff",
  },
  {
    num:   "03",
    title: "QRチェックイン",
    desc:  "公演会場・周遊スポットでの本人確認や進行管理を QR で。来場ログを自動で残し、当日運用を軽くします。",
    mock:  "qr",
  },
  {
    num:   "04",
    title: "アンケート・分岐",
    desc:  "回答内容に応じてシナリオを枝分かれさせ、参加者ごとに異なる結末や追加コンテンツを届けられます。",
    mock:  "branch",
  },
];

const USE_CASES = [
  {
    title: "謎解き",
    desc:  "QRや位置情報をきっかけに、物語が現実の街へ広がる。ヒント送付・正答管理・順位通知まで自動化。",
  },
  {
    title: "マーダーミステリー",
    desc:  "プレイヤーごとの HO、証拠、分岐導線を LINE 上で管理。秘匿情報と全体配信をひとつのスタジオで。",
  },
  {
    title: "舞台連動",
    desc:  "観劇前後の設定資料、アンケート、シェア導線まで一つに。LIFF と配信で前後の余韻まで設計できます。",
  },
];

const TRUST_KEYWORDS = [
  "LINE公式アカウント連携",
  "LIFFページ作成",
  "QRチェックイン",
  "アンケート取得",
  "分岐メッセージ",
  "商業公演対応",
];

const FLOW_STEPS = [
  {
    num:   "01",
    title: "アカウントを作る",
    desc:  "メールアドレスで Whale Studio に登録。LINE 公式アカウントを連携して準備完了。",
  },
  {
    num:   "02",
    title: "作品をつくる",
    desc:  "シナリオ・キャラクター・LIFF・配信メッセージをノーコードで組み立て、プレビューで動作確認。",
  },
  {
    num:   "03",
    title: "公開・運用",
    desc:  "QRやLPから友だち追加 → 体験開始。当日のチェックインも進行ログも、ひとつの管理画面で確認。",
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// 小さな UI パーツ (Server Component なので Hook なし)
// ──────────────────────────────────────────────────────────────────────────────

/** セクション見出しに添える小ラベル。STUDIO LP の "− Features" 風。 */
function EyebrowLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.16em] text-sky-ink uppercase">
      <span aria-hidden className="inline-block h-px w-4 bg-sky-ink/60" />
      {children}
    </span>
  );
}

/** 番号バッジ (01 / 02 ...)。STUDIO LP の濃紺カプセル番号に倣う。 */
function NumberBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full bg-[#1f2a25] px-2 font-num text-[11px] font-bold text-white">
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Hero のプロダクトモック群 (CSS のみで構築)
// ──────────────────────────────────────────────────────────────────────────────

/** LINE 風チャット。 */
function LineChatMock() {
  return (
    <div
      className="relative h-[360px] w-[220px] overflow-hidden rounded-[28px] border border-[#1f2a25]/15 bg-[#8aa6c6] shadow-[0_18px_40px_-12px_rgba(15,42,32,.35)] sm:h-[400px] sm:w-[240px]"
      aria-hidden
    >
      {/* ステータスバー */}
      <div className="flex h-6 items-center justify-between bg-[#8aa6c6] px-3 text-[9px] font-bold text-white/85">
        <span>23:51</span>
        <span className="flex gap-0.5">
          <span className="h-1 w-1 rounded-full bg-white/90" />
          <span className="h-1 w-1 rounded-full bg-white/90" />
          <span className="h-1 w-1 rounded-full bg-white/90" />
        </span>
      </div>
      {/* ヘッダー */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#7c98b8] px-3 py-2">
        <span className="text-[10px] font-bold text-white">{"< 謎解きbot β版"}</span>
      </div>
      {/* チャット */}
      <div className="flex flex-col gap-2 bg-[#8aa6c6] px-3 py-3">
        <div className="self-start max-w-[78%] rounded-2xl rounded-tl-sm bg-white px-3 py-1.5 text-[10px] leading-[1.5] text-ink shadow-sm">
          あれ…誰かいるの?
        </div>
        <div className="self-start max-w-[78%] rounded-2xl rounded-tl-sm bg-white px-3 py-1.5 text-[10px] leading-[1.5] text-ink shadow-sm">
          ここから出られないの…
          <br />助けて。
        </div>
        <div className="self-end max-w-[78%] rounded-2xl rounded-tr-sm bg-brand px-3 py-1.5 text-[10px] leading-[1.5] text-white shadow-sm">
          わかった、助けるよ
        </div>
        <div className="self-start max-w-[82%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[10px] leading-[1.5] text-ink shadow-sm">
          ありがとう!<br />
          <span className="text-ink-3">タブレットが光ってる…</span>
        </div>
        <div className="mt-1 flex gap-1.5">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold text-brand-ink">ヒント1</span>
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold text-brand-ink">ヒント2</span>
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold text-brand-ink">ヒント3</span>
        </div>
      </div>
    </div>
  );
}

/** 管理画面ウィンドウ風モック。Hero 背面で奥行きを出す。 */
function StudioAdminMock() {
  return (
    <div
      className="relative h-[320px] w-[460px] overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_24px_64px_-20px_rgba(15,42,32,.30)]"
      aria-hidden
    >
      {/* ウィンドウバー */}
      <div className="flex items-center gap-1.5 border-b border-line bg-bg-tint px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-round text-[10px] font-bold tracking-[0.05em] text-ink-3">
          WHALE STUDIO <span className="text-ink-3/60">/ シナリオフロー</span>
        </span>
      </div>
      {/* 上部タブ */}
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-[9px] text-ink-3">
        <span className="text-brand-ink">TOP</span>
        <span>›</span>
        <span>アカウントリスト</span>
        <span>›</span>
        <span>作品リスト</span>
        <span>›</span>
        <span className="text-ink-2">シナリオフロー</span>
      </div>
      {/* タイトル */}
      <div className="px-4 pt-3">
        <h4 className="font-round text-[14px] font-black text-ink">シナリオフロー</h4>
        <p className="mt-0.5 text-[10px] text-ink-3">フェーズ間の分岐構造を確認できます。</p>
      </div>
      {/* フェーズボックス */}
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="rounded-md border-l-[3px] border-brand bg-brand-soft/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-round text-[10px] font-bold text-brand-ink">導入</span>
            <span className="font-num text-[9px] text-ink-3">3 メッセージ · 2 分岐</span>
          </div>
        </div>
        <div className="rounded-md border-l-[3px] border-sky bg-sky-soft/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-round text-[10px] font-bold text-sky-ink">状況理解</span>
            <span className="font-num text-[9px] text-ink-3">2 メッセージ · 1 分岐</span>
          </div>
        </div>
        <div className="rounded-md border-l-[3px] border-lilac bg-lilac-soft/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-round text-[10px] font-bold text-lilac-ink">謎①</span>
            <span className="font-num text-[9px] text-ink-3">5 メッセージ · 3 分岐</span>
          </div>
        </div>
        <div className="rounded-md border-l-[3px] border-peach bg-peach-soft/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-round text-[10px] font-bold text-ink">エンディング A</span>
            <span className="font-num text-[9px] text-ink-3">2 メッセージ</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** QR チェックインを示す小チップ。 */
function QrChip() {
  const PATTERN = [
    [1, 1, 1, 0, 1],
    [1, 0, 1, 1, 0],
    [1, 1, 1, 0, 1],
    [0, 1, 0, 1, 1],
    [1, 0, 1, 1, 0],
  ];
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2.5 shadow-card" aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="grid grid-cols-5 gap-[1px] rounded bg-white p-1 ring-1 ring-line">
          {PATTERN.flat().map((on, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 ${on ? "bg-[#1f2a25]" : "bg-transparent"}`}
            />
          ))}
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-ink">QRチェックイン</span>
          <span className="font-num text-[10px] text-brand-ink">+1 来場ログ</span>
        </div>
      </div>
    </div>
  );
}

/** 簡易アンケート結果チップ。 */
function SurveyChip() {
  const BARS = [
    { label: "A", pct: 62, color: "bg-brand" },
    { label: "B", pct: 28, color: "bg-sky" },
    { label: "C", pct: 10, color: "bg-lilac" },
  ];
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2.5 shadow-card" aria-hidden>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold text-ink">アンケート結果</span>
        <span className="font-num text-[9px] text-ink-3">n=124</span>
      </div>
      <div className="flex flex-col gap-1">
        {BARS.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="font-num w-2 text-[9px] font-bold text-ink-3">{b.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tint">
              <div className={`h-full ${b.color}`} style={{ width: `${b.pct}%` }} />
            </div>
            <span className="font-num w-7 text-right text-[9px] font-bold text-ink-2">{b.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 分岐メッセージを示す小チップ。 */
function BranchChip() {
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2.5 shadow-card" aria-hidden>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="text-[10px] font-bold text-ink">分岐メッセージ</span>
      </div>
      <div className="flex items-stretch gap-1.5">
        <div className="rounded-md bg-brand-soft px-2 py-1 text-[9px] font-bold text-brand-ink">
          回答: 行く
        </div>
        <div className="flex flex-col justify-center text-[10px] text-ink-3">→</div>
        <div className="flex flex-col gap-1">
          <div className="rounded-md bg-sky-soft px-2 py-1 text-[9px] font-bold text-sky-ink">
            森ルート
          </div>
          <div className="rounded-md bg-lilac-soft px-2 py-1 text-[9px] font-bold text-lilac-ink">
            街ルート
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Features カードに乗せる小さなインライン装飾 (機能ごと)
// ──────────────────────────────────────────────────────────────────────────────

function FeatureMock({ kind }: { kind: "chat" | "liff" | "qr" | "branch" }) {
  if (kind === "chat") {
    return (
      <div className="flex flex-col gap-1.5 rounded-field bg-bg-tint p-3" aria-hidden>
        <div className="self-start max-w-[78%] rounded-2xl rounded-tl-sm bg-white px-3 py-1.5 text-[10px] text-ink shadow-sm">
          物語が始まります…
        </div>
        <div className="self-end max-w-[60%] rounded-2xl rounded-tr-sm bg-brand px-3 py-1.5 text-[10px] text-white shadow-sm">
          進める
        </div>
        <div className="mt-0.5 flex gap-1.5">
          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-brand-ink ring-1 ring-line">A</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-brand-ink ring-1 ring-line">B</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-brand-ink ring-1 ring-line">C</span>
        </div>
      </div>
    );
  }

  if (kind === "liff") {
    return (
      <div className="rounded-field border border-line bg-bg-tint p-3" aria-hidden>
        <div className="rounded-md bg-surface p-2 shadow-sm ring-1 ring-line">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-round text-[10px] font-bold text-ink">プレイヤー画面</span>
            <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold text-brand-ink">LIFF</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <div className="aspect-square rounded-sm bg-brand-mist" />
            <div className="aspect-square rounded-sm bg-sky-soft" />
            <div className="aspect-square rounded-sm bg-lilac-soft" />
          </div>
          <div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-line" />
        </div>
      </div>
    );
  }

  if (kind === "qr") {
    const PATTERN = [
      [1, 1, 1, 0, 1, 0, 1],
      [1, 0, 0, 1, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 0],
      [0, 1, 0, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [0, 1, 1, 0, 1, 1, 0],
      [1, 1, 0, 1, 0, 1, 1],
    ];
    return (
      <div className="flex items-center justify-center rounded-field bg-bg-tint p-3" aria-hidden>
        <div className="grid grid-cols-7 gap-[1px] rounded bg-white p-2 ring-1 ring-line">
          {PATTERN.flat().map((on, i) => (
            <span
              key={i}
              className={`h-2 w-2 ${on ? "bg-[#1f2a25]" : "bg-transparent"}`}
            />
          ))}
        </div>
      </div>
    );
  }

  // branch
  return (
    <div className="rounded-field bg-bg-tint p-3" aria-hidden>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-md bg-surface px-2 py-1.5 text-[10px] font-bold text-ink shadow-sm ring-1 ring-line">
          Q. 続ける?
        </div>
        <span className="text-ink-3">→</span>
        <div className="flex flex-col gap-1">
          <div className="rounded-md bg-brand-soft px-2 py-1 text-[9px] font-bold text-brand-ink">はい</div>
          <div className="rounded-md bg-sky-soft px-2 py-1 text-[9px] font-bold text-sky-ink">いいえ</div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ページ本体
// ──────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    // AppShell の <main><div className="container"> の中で描画される (max-width 980px)。
    // CMS 用 main の縦 padding (28px / 48px) を打ち消して LP らしい間を取る。
    <div className="-mt-7 -mb-12 flex flex-col gap-24 pb-24">
      <HeroSection />
      <TrustStripSection />
      <FeaturesSection />
      <UseCasesSection />
      <FlowSection />
      <PricingSection />
      <EndCtaSection />
    </div>
  );
}

// ── 1. Hero ────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden rounded-card bg-bg-tint pt-14 pb-16 sm:pt-20 sm:pb-20">
      {/* 背景の淡いブロブ。Soft Premium SaaS 風の光のにじみ。 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-mist opacity-70 blur-3xl" />
        <div className="absolute -right-20 top-12 h-72 w-72 rounded-full bg-sky-soft opacity-80 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-lilac-soft opacity-60 blur-3xl" />
      </div>

      <div className="flex flex-col items-center gap-12 px-5 lg:flex-row lg:items-center lg:gap-8 lg:px-10">
        {/* 左: コピー + CTA */}
        <div className="flex flex-1 flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <EyebrowLabel>Interactive Creative Studio β版</EyebrowLabel>

          <h1 className="font-round text-[clamp(28px,5.6vw,46px)] font-black leading-[1.25] tracking-[0.01em] text-[#1f2a25]">
            LINEで、
            <br className="hidden sm:block" />
            物語体験をつくる。
          </h1>

          <p className="max-w-[520px] text-[13.5px] leading-[1.95] text-ink-2 sm:text-[14.5px]">
            謎解き・マーダーミステリー・舞台連動企画を、ノーコードで構築。
            <br className="hidden sm:block" />
            メッセージ配信、LIFFページ、QRチェックイン、アンケート、分岐導線まで、
            <br className="hidden sm:block" />
            作品ごとの LINE 体験をまとめて管理できます。
          </p>

          <div className="mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
            <Link
              href="/login?intent=individual"
              className={buttonClass({
                variant:   "primary",
                size:      "md",
                className: "!px-8 !py-3 !text-[14px]",
              })}
            >
              個人利用で始める
            </Link>
            <Link
              href="/contact?type=enterprise"
              className={buttonClass({
                variant:   "ghost",
                size:      "md",
                className: "!px-8 !py-3 !text-[14px]",
              })}
            >
              法人の方はこちら
            </Link>
          </div>

          <p className="mt-1 text-[11px] text-ink-3">
            クレジットカード不要 / いつでも解約可能
          </p>
        </div>

        {/* 右: プロダクトモック (sm では下に、lg では右に並ぶ)。 */}
        <div className="relative flex w-full flex-1 items-center justify-center pt-2 lg:justify-end">
          {/* SP では簡略版 (チャットのみ) を中央配置。lg 以上で複合モック。 */}
          <div className="block lg:hidden">
            <LineChatMock />
          </div>

          <div className="hidden lg:block">
            <div className="relative h-[420px] w-[460px]">
              {/* 奥: 管理画面 */}
              <div className="absolute right-0 top-2 rotate-[2deg]">
                <StudioAdminMock />
              </div>
              {/* 手前: 電話 */}
              <div className="absolute -left-2 top-4 -rotate-[3deg]">
                <LineChatMock />
              </div>
              {/* 浮遊カード: QR / アンケート / 分岐 */}
              <div className="absolute -left-6 bottom-2 -rotate-[2deg]">
                <QrChip />
              </div>
              <div className="absolute right-8 -top-4 rotate-[3deg]">
                <SurveyChip />
              </div>
              <div className="absolute right-0 bottom-6 rotate-[2deg]">
                <BranchChip />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 2. Trust strip ────────────────────────────────────────────────────────────
function TrustStripSection() {
  return (
    <section className="px-5">
      <p className="mb-3 text-center text-[11px] font-bold tracking-[0.1em] text-ink-3 uppercase">
        Whale Studio でできること
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {TRUST_KEYWORDS.map((k) => (
          <span
            key={k}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-bold text-ink-2"
          >
            {k}
          </span>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] leading-[1.7] text-ink-3">
        一部の機能は順次公開予定です。詳細は
        <Link
          href="/contact?type=enterprise"
          className="text-brand-ink underline decoration-line underline-offset-2 hover:decoration-brand"
        >
          お問い合わせ
        </Link>
        からご確認ください。
      </p>
    </section>
  );
}

// ── 3. Features ──────────────────────────────────────────────────────────────
function FeaturesSection() {
  return (
    <section className="px-5">
      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <EyebrowLabel>Features</EyebrowLabel>
        <h2 className="font-round text-[clamp(22px,4.8vw,30px)] font-black tracking-[0.01em] text-[#1f2a25]">
          作品ごとの LINE 体験を、
          <br className="sm:hidden" />
          一つのスタジオで。
        </h2>
        <p className="max-w-[520px] text-[13px] leading-[1.95] text-ink-2">
          配信・LIFF・チェックイン・分岐まで、別ツールを横断せずに作品を組み立てられます。
        </p>
      </header>

      <div className="grid gap-5 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article
            key={f.title}
            className="group relative overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card transition-shadow hover:shadow-[0_12px_32px_-12px_rgba(34,197,94,.25)]"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-mist opacity-60 blur-2xl transition-opacity group-hover:opacity-90"
            />

            <div className="relative flex items-start gap-3">
              <NumberBadge>{f.num}</NumberBadge>
              <div className="flex-1">
                <h3 className="font-round text-[17px] font-bold text-[#1f2a25]">
                  {f.title}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.85] text-ink-2">
                  {f.desc}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <FeatureMock kind={f.mock} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ── 4. Use Cases ─────────────────────────────────────────────────────────────
function UseCasesSection() {
  return (
    <section className="relative overflow-hidden rounded-card bg-bg-tint px-5 py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-10 top-0 h-56 w-56 rounded-full bg-brand-mist opacity-60 blur-3xl" />
        <div className="absolute right-0 bottom-0 h-56 w-56 rounded-full bg-sky-soft opacity-60 blur-3xl" />
      </div>

      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <EyebrowLabel>Use Cases</EyebrowLabel>
        <h2 className="font-round text-[clamp(22px,4.8vw,30px)] font-black tracking-[0.01em] text-[#1f2a25]">
          こんな作品づくりに使われています。
        </h2>
      </header>

      <div className="grid gap-5 sm:grid-cols-3">
        {USE_CASES.map((u, i) => {
          // 各カードの彩りを変える (緑 / 青 / 紫) 。
          const accents = [
            { dot: "bg-brand",  badge: "bg-brand-soft text-brand-ink",  ribbon: "from-brand/15  to-transparent"  },
            { dot: "bg-sky",    badge: "bg-sky-soft   text-sky-ink",    ribbon: "from-sky/15    to-transparent"    },
            { dot: "bg-lilac",  badge: "bg-lilac-soft text-lilac-ink",  ribbon: "from-lilac/15  to-transparent"  },
          ];
          const a = accents[i] ?? accents[0];
          return (
            <article
              key={u.title}
              className="relative overflow-hidden rounded-card border border-line bg-surface p-6"
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${a.ribbon}`}
              />
              <div className="relative flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${a.dot}`} />
                <h3 className="font-round text-[16px] font-bold text-[#1f2a25]">
                  {u.title}
                </h3>
              </div>
              <p className="relative mt-3 text-[13px] leading-[1.95] text-ink-2">
                {u.desc}
              </p>
              <span
                className={`relative mt-4 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.06em] ${a.badge}`}
              >
                Scenario
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ── 5. Flow ──────────────────────────────────────────────────────────────────
function FlowSection() {
  return (
    <section className="px-5">
      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <EyebrowLabel>Flow</EyebrowLabel>
        <h2 className="font-round text-[clamp(22px,4.8vw,30px)] font-black tracking-[0.01em] text-[#1f2a25]">
          はじめ方は 3 ステップ。
        </h2>
      </header>

      <ol className="relative grid gap-4 sm:grid-cols-3">
        {/* 中央の細い接続線 (sm 以上のみ) */}
        <div
          aria-hidden
          className="absolute top-10 left-[8%] right-[8%] hidden h-px bg-line sm:block"
        />
        {FLOW_STEPS.map((s) => (
          <li
            key={s.num}
            className="relative rounded-card border border-line bg-surface p-6"
          >
            <NumberBadge>{s.num}</NumberBadge>
            <h3 className="mt-3 font-round text-[15px] font-bold text-[#1f2a25]">
              {s.title}
            </h3>
            <p className="mt-2 text-[12.5px] leading-[1.85] text-ink-2">
              {s.desc}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── 6. Pricing ───────────────────────────────────────────────────────────────
function PricingSection() {
  return (
    <section className="px-5">
      <header className="mb-10 flex flex-col items-center gap-3 text-center">
        <EyebrowLabel>Pricing</EyebrowLabel>
        <h2 className="font-round text-[clamp(22px,4.8vw,30px)] font-black tracking-[0.01em] text-[#1f2a25]">
          個人利用から商業公演まで。
        </h2>
        <p className="text-[12.5px] text-ink-3">
          すべて税込・1 LINE 公式アカウント単位。詳細は
          <Link
            href="/pricing"
            className="text-brand-ink underline decoration-line underline-offset-2 hover:decoration-brand"
          >
            プランを見る
          </Link>
          から。
        </p>
      </header>

      <div className="grid gap-5 sm:grid-cols-3">
        {/* 個人 */}
        <article className="flex flex-col rounded-card border border-line bg-surface p-6">
          <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">個人利用</h3>
          <p className="mt-1 text-[11.5px] text-ink-3">小規模作品・個人作家向け</p>
          <p className="mt-4 font-num text-[28px] font-bold text-brand-ink">
            9,800円
            <span className="ml-1 text-[12px] font-semibold text-ink-3">〜 / 月</span>
          </p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              すぐ始められる定額プラン
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              個人クリエイター向け機能一式
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              いつでも解約・プラン変更
            </li>
          </ul>
          <Link
            href="/login?intent=individual"
            className={buttonClass({
              variant:   "primary",
              size:      "md",
              fullWidth: true,
              className: "mt-6",
            })}
          >
            個人利用で始める
          </Link>
        </article>

        {/* 法人 (おすすめ) */}
        <article className="relative flex flex-col overflow-hidden rounded-card border-2 border-brand bg-brand-mist p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand-soft opacity-80 blur-2xl"
          />
          <div className="relative flex items-center justify-between">
            <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">法人利用</h3>
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-white shadow-[0_2px_8px_rgba(34,197,94,.30)]">
              おすすめ
            </span>
          </div>
          <p className="relative mt-1 text-[11.5px] text-ink-3">
            商業公演・IP 企画・複数アカウント運用向け
          </p>
          <p className="relative mt-4 font-num text-[28px] font-bold text-brand-ink">
            要相談
          </p>
          <ul className="relative mt-4 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              複数 LINE 公式アカウント運用
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              商業公演・IP 案件のサポート
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              利用規模に合わせた個別見積り
            </li>
          </ul>
          <Link
            href="/contact?type=enterprise"
            className={buttonClass({
              variant:   "primary",
              size:      "md",
              fullWidth: true,
              className: "relative mt-6",
            })}
          >
            法人の方はこちら
          </Link>
        </article>

        {/* 導入サポート */}
        <article className="flex flex-col rounded-card border border-line bg-surface p-6">
          <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">導入サポート</h3>
          <p className="mt-1 text-[11.5px] text-ink-3">
            LINE公式連携・Webhook設定・初期構築まで
          </p>
          <p className="mt-4 font-num text-[28px] font-bold text-brand-ink">
            初期 50,000円
            <span className="ml-1 text-[12px] font-semibold text-ink-3">〜</span>
          </p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              LINE公式アカウント連携の代行
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              Webhook・LIFF の初期設定
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              作品設計の伴走サポート
            </li>
          </ul>
          <Link
            href="/contact?type=onboarding"
            className={buttonClass({
              variant:   "ghost",
              size:      "md",
              fullWidth: true,
              className: "mt-6",
            })}
          >
            相談する
          </Link>
        </article>
      </div>
    </section>
  );
}

// ── 7. End CTA ───────────────────────────────────────────────────────────────
function EndCtaSection() {
  return (
    <section className="px-5">
      <div className="relative overflow-hidden rounded-card border border-line bg-bg-tint px-6 py-14 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-12 top-0 h-48 w-48 rounded-full bg-brand-mist opacity-70 blur-3xl" />
          <div className="absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-sky-soft opacity-70 blur-3xl" />
        </div>

        <h2 className="font-round text-[clamp(20px,4.4vw,26px)] font-black tracking-[0.01em] text-[#1f2a25]">
          あなたの作品も、LINE で動かしませんか?
        </h2>
        <p className="mx-auto mt-3 max-w-[440px] text-[13px] leading-[1.95] text-ink-2">
          個人での試験運用から、商業公演での本格運用まで。
          <br />
          同じ Whale Studio から始められます。
        </p>
        <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            href="/login?intent=individual"
            className={buttonClass({
              variant:   "primary",
              size:      "md",
              className: "!px-8 !py-3 !text-[14px]",
            })}
          >
            個人利用で始める
          </Link>
          <Link
            href="/contact?type=enterprise"
            className={buttonClass({
              variant:   "ghost",
              size:      "md",
              className: "!px-8 !py-3 !text-[14px]",
            })}
          >
            法人の方はこちら
          </Link>
        </div>
      </div>
    </section>
  );
}
