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

interface Props {
  title?: string | null;
  settings: AccordionSettings;
  depth?: number;
  blockId?: string;
}

export function AccordionBlock({ title, settings, depth = 1, blockId }: Props) {
  const reactId = useId();
  const id = blockId || reactId;
  const playerCtx = useLiffPlayerContext();
  const headingText = settings.title?.trim() || title?.trim() || "";

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
    <section className="border-b border-[color:var(--liff-border)]">
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="w-full flex items-center justify-between gap-3 text-left min-h-[60px] py-3 transition-colors active:bg-[color:var(--liff-surface-subtle)]"
        >
          <span className="text-[16px] font-bold leading-snug break-words flex-1 min-w-0 text-[color:var(--liff-primary-text)]">
            {headingText || "（タイトル未設定）"}
          </span>
          <Chevron open={open} />
        </button>
      </h3>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="pt-1 pb-5 flex flex-col gap-4"
        >
          {(settings.children ?? []).map((child, idx) => (
            <NestedRenderer key={child.id ?? idx} child={child} depth={depth + 1} />
          ))}
          {(!settings.children || settings.children.length === 0) && (
            <p className="text-[13px] text-[color:var(--liff-tertiary-text)]">（中身は未設定です）</p>
          )}
        </div>
      )}
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
