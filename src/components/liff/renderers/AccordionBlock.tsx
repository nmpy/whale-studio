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

const VARIANT_HEADER: Record<LiffSectionVariant, string> = {
  default: "bg-[color:var(--liff-surface)] text-[color:var(--liff-primary-text)] border-[color:var(--liff-border)]",
  dark:    "bg-[color:var(--liff-primary-text)] text-white border-[color:var(--liff-primary-text)]",
  purple:  "bg-violet-600 text-white border-violet-600",
};

const VARIANT_BODY: Record<LiffSectionVariant, string> = {
  default: "bg-[color:var(--liff-surface)] border-[color:var(--liff-border)]",
  dark:    "bg-[color:var(--liff-surface)] border-[color:var(--liff-primary-text)]",
  purple:  "bg-[color:var(--liff-surface)] border-violet-600",
};

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

  const variant = (settings.variant ?? (depth === 1 ? "default" : depth === 2 ? "purple" : "default")) as LiffSectionVariant;
  const headerCls = VARIANT_HEADER[variant];
  const bodyCls = VARIANT_BODY[variant];

  const toggle = () => {
    const next = !open;
    setOpen(next);
    trackHintSiteEvent(next ? "accordion_open" : "accordion_close", {
      block_id: id,
      depth,
      label: headingText,
    });
    // 開いた瞬間だけ hint_open を記録 (閉じる動作は計測しない)
    // blockId が DB の LiffPageBlock.id 由来でない場合は捨てる (useId のローカル ID は記録しても無意味)
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

  const panelId = `acc-panel-${id}`;
  const headerId = `acc-header-${id}`;

  return (
    <section
      className={`border rounded-[12px] overflow-hidden ${
        variant === "purple"
          ? "border-violet-600"
          : variant === "dark"
            ? "border-[color:var(--liff-primary-text)]"
            : "border-[color:var(--liff-border)]"
      }`}
    >
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={`w-full flex items-center justify-between gap-3 text-left px-4 py-3 ${headerCls} transition-colors`}
        >
          <span className="font-bold text-[16px] leading-snug break-words flex-1 min-w-0">
            {headingText || "（タイトル未設定）"}
          </span>
          <span
            aria-hidden="true"
            className={`shrink-0 w-6 h-6 rounded-full border ${
              variant === "default" ? "border-[color:var(--liff-border)]" : "border-current"
            } flex items-center justify-center text-base font-bold leading-none`}
          >
            {open ? "−" : "+"}
          </span>
        </button>
      </h3>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className={`px-4 py-4 border-t ${bodyCls} flex flex-col gap-3`}
        >
          {(settings.children ?? []).map((child, idx) => (
            <NestedRenderer key={child.id ?? idx} child={child} depth={depth + 1} />
          ))}
          {(!settings.children || settings.children.length === 0) && (
            <p className="text-[12px] text-[color:var(--liff-tertiary-text)]">（中身は未設定です）</p>
          )}
        </div>
      )}
    </section>
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
      // ネストされた子ブロックは DB 上の独立行ではないため、blockId は付けず親ブロック単位の集計に寄せる
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
