"use client";

import { useId, useState } from "react";
import type {
  AccordionSettings,
  ButtonLinkSettings,
  DividerSettings,
  HeadingSettings,
  ImageBlockSettings,
  LiffSectionVariant,
  NestedLiffBlock,
  TextSettings,
  WarningSettings,
} from "@/types";
import { trackHintSiteEvent } from "@/lib/liff-analytics";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";
import { resolveAccordionItems, type AccordionItem } from "../accordion-items";
import { accordionDepthStyle } from "../accordion-depth-style";
import { HeadingBlock } from "./HeadingBlock";
import { TextBlock } from "./TextBlock";
import { WarningBlock } from "./WarningBlock";
import { ImageBlock } from "./ImageBlock";
import { ButtonLinkBlock } from "./ButtonLinkBlock";
import { DividerBlock } from "./DividerBlock";

// ── AccordionBlock (LINE Gift like flat section) ──────────────────────────
//
// 旧仕様: variant ごとに header / body 背景を変える「カード in カード」UI。
// 旧仕様 v2: 白カード 1 枚 + chevron。これも angled-card 感が残った。
//
// 新仕様 (LINE Gift の "受け取り方" / "支払い方法" のような自然なセクションリスト):
//   - 外側カード枠を完全廃止。borderBottom のみ
//   - 上端も下端も border-bottom で他項目と連結 (上端は親側で 1 本入れることで開始線にする)
//   - ヘッダー高 60px、左に見出し、右に chevron up/down
//   - 開いたら本文がその下に自然に表示される。さらなる囲み枠なし
//   - 旧 settings.variant (default / dark / purple) は受け取りつつ無視
//
// 親 renderer 側で複数 accordion を縦に並べると、border-bottom が罫線として連続する。
//
// ネスト表現 (PR: accordion-nesting-ux):
//   depth はこれまで analytics にしか渡っておらず className に一切使われていなかったため、
//   「A の中の B」と「A の隣の B」が完全に同じ見た目になっていた。
//   accordionDepthStyle(depth) で インデント + 縦ガイド線 + 見出しサイズ差 を与えて解消する。
//   DOM 構造は変えない = 子 accordion は親 <button> の子孫ではなく、親パネル div 内の兄弟。
//   （button in button を作らないための不変条件。テストで固定している）

interface Props {
  title?: string | null;
  settings: AccordionSettings;
  depth?: number;
  blockId?: string;
}

// エントリ。multi（有効 item ≥1）なら複数項目表示、それ以外は既存 single 表示。
// ※ フック規則を守るため、分岐は両 inner コンポーネントの呼び出しで行う（ここでフックは呼ばない）。
export function AccordionBlock(props: Props) {
  const items = resolveAccordionItems(props.settings.items);
  if (items.length > 0) {
    return <AccordionMulti items={items} depth={props.depth ?? 1} blockId={props.blockId} />;
  }
  return <AccordionSingle {...props} />;
}

function AccordionSingle({ title, settings, depth = 1, blockId }: Props) {
  const reactId = useId();
  const id = blockId || reactId;
  const playerCtx = useLiffPlayerContext();
  const headingText = settings.title?.trim() || title?.trim() || "";
  const style = accordionDepthStyle(depth);
  // 見出しレベルは depth に追従させる (L1=h3 / L2=h4 / L3=h5)。
  // ページ = h2 (LiffSinglePageRenderer)、ブロック = h3 が既存の規約なので、
  // accordion L1 は h3 のまま。ネストした分だけ 1 段下げる = ページ全体の outline を崩さない。
  const Heading = style.headingTag;

  const [open, setOpen] = useState<boolean>(!!settings.default_open);

  // 旧 variant 設定は読み込むが見た目には反映しない (新デザインは 1 種類で統一)。
  const _variant = (settings.variant ?? "default") as LiffSectionVariant;
  void _variant;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    trackHintSiteEvent(next ? "accordion_open" : "accordion_close", {
      block_id: id,
      depth,
      label: headingText,
    });
    if (next && playerCtx && !playerCtx.preview && blockId) {
      recordLiffEvent({
        workId:     playerCtx.workId,
        pageId:     playerCtx.pageId,
        blockId,
        lineUserId: playerCtx.lineUserId,
        eventType:  "hint_open",
        metadata:   { label: headingText, depth },
        dedupeKey:  `hint_open:${playerCtx.workId}:${playerCtx.pageId ?? "default"}:${blockId}:${playerCtx.lineUserId ?? "anon"}`,
      });
    }
  };

  const panelId  = `acc-panel-${id}`;
  const headerId = `acc-header-${id}`;

  return (
    // 外側カード枠を持たない。border-bottom のみで隣接 accordion と区切る。
    // 開閉中も大きさが変わらないよう、本文 padding-top/bottom は固定値。
    <section className={style.section}>
      <Heading className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={`w-full flex items-center justify-between gap-3 text-left transition-colors active:bg-[color:var(--liff-surface-subtle)] ${style.header}`}
        >
          <span className={`leading-snug break-words flex-1 min-w-0 text-[color:var(--liff-primary-text)] ${style.title}`}>
            {headingText || "（タイトル未設定）"}
          </span>
          <Chevron open={open} />
        </button>
      </Heading>

      {/* 子孫を常時 mount したまま hidden で隠す = 親を閉じて開き直しても
          子/孫の開閉 state が保持される（従来は {open && …} で unmount → リセットされていた）。
          常時 mount の副作用は事前に監査済み:
            - ImageBlock は loading="lazy"。display:none 配下は読み込まれない
            - ButtonLinkBlock / 子 accordion の計測は click / toggle 時のみで mount 時に発火しない
            - video / iframe / audio は accordion の子要素になり得ない（NestedRenderer に case が無い）
          hidden 属性は Tailwind の display ユーティリティに負けるため、
          閉じている間は panel の class（flex を含む）自体を外す。 */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className={open ? style.panel : undefined}
      >
        {(settings.children ?? []).map((child, idx) => (
          <NestedRenderer key={child.id ?? idx} child={child} depth={depth + 1} />
        ))}
        {(!settings.children || settings.children.length === 0) && (
          <p className="text-[13px] text-[color:var(--liff-tertiary-text)]">（中身は未設定です）</p>
        )}
      </div>
    </section>
  );
}

// ── multi（複数項目）─────────────────────────────────────────────────────
// 有効 item を縦に並べる。各 item は single と同じ見た目（border-bottom + 60px ヘッダ +
// chevron）で、それぞれ独立に開閉（1つ開いても他は閉じない）。v1 は body=plain text のみ。
// title / children は表示しない。分析イベント・排他 open・並び替えは後続。
function AccordionMulti({ items, depth, blockId }: { items: AccordionItem[]; depth: number; blockId?: string }) {
  const reactId = useId();
  const baseId = blockId || reactId;
  return (
    <>
      {items.map((item, idx) => (
        <AccordionItemRow key={idx} item={item} depth={depth} baseId={`${baseId}-${idx}`} />
      ))}
    </>
  );
}

function AccordionItemRow({ item, depth, baseId }: { item: AccordionItem; depth: number; baseId: string }) {
  const [open, setOpen] = useState(false);
  const style = accordionDepthStyle(depth);
  const Heading = style.headingTag;
  const panelId  = `acc-panel-${baseId}`;
  const headerId = `acc-header-${baseId}`;
  return (
    <section className={style.section}>
      <Heading className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className={`w-full flex items-center justify-between gap-3 text-left transition-colors active:bg-[color:var(--liff-surface-subtle)] ${style.header}`}
        >
          <span className={`leading-snug break-words flex-1 min-w-0 text-[color:var(--liff-primary-text)] ${style.title}`}>
            {item.title.trim() || "（タイトル未設定）"}
          </span>
          <Chevron open={open} />
        </button>
      </Heading>
      {/* items は本文が plain text 1 つだけなので、children 側のような入れ子は起きない。
          open state 維持の方針だけ AccordionSingle と揃える。 */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className={open ? "pt-1 pb-5" : undefined}
      >
        <p className="text-[14px] leading-[1.7] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)]">
          {item.body}
        </p>
      </div>
    </section>
  );
}

/** Chevron アイコン (LINE Gift 風)。open のとき下向き → 上向きに 180° 回転。 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-[color:var(--liff-secondary-text)] transition-transform ${
        open ? "rotate-180" : ""
      }`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function NestedRenderer({ child, depth }: { child: NestedLiffBlock; depth: number }) {
  const s = (child.settings_json ?? {}) as Record<string, unknown>;
  switch (child.block_type) {
    case "heading":
      return <HeadingBlock title={child.title} settings={s as HeadingSettings} />;
    case "text":
    case "free_text":
      return <TextBlock title={child.title} settings={s as TextSettings} />;
    case "warning":
      return <WarningBlock settings={s as WarningSettings} />;
    case "image":
      return <ImageBlock settings={s as ImageBlockSettings} />;
    case "button_link":
      return <ButtonLinkBlock settings={s as ButtonLinkSettings} />;
    case "divider":
      return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":
      return (
        <AccordionBlock
          title={child.title}
          settings={s as AccordionSettings}
          depth={depth}
          blockId={child.id}
        />
      );
    default:
      return null;
  }
}
