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

// ── AccordionBlock (LINE Design System / Hint Site 用) ─────────────────────
//
// 旧仕様: variant ごとに header / body の bg を変え、中入れ子カードとして見せていた。
//   → 古いフォーム UI 感が出てしまうため廃止。
//
// 新仕様 (台本・ハンドアウトを LINE 内で読むトーン):
//   - 白カード 1 枚で完結。border は薄く (--liff-border)、角丸 16px。
//   - ヘッダーは text-left + chevron (▾) のみ。緑ボタン枠やラベルは付けない。
//   - 展開時、ヘッダーと本文の間は細い区切り線 1 本のみ。
//   - 旧 settings.variant (default / dark / purple) は受け取りつつ無視する (互換)。

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
  // 型互換のため variable は残す。
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
    // 開いた瞬間だけ hint_open を記録 (閉じる動作は計測しない)。
    // blockId が DB 由来でない場合 (useId の生成値) は記録しない。
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
    <section className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] overflow-hidden">
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="w-full flex items-center justify-between gap-3 text-left px-5 min-h-[60px] py-3 transition-colors active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
        >
          <span className="text-[16px] font-bold leading-snug break-words flex-1 min-w-0 text-[color:var(--liff-primary-text)]">
            {headingText || "（タイトル未設定）"}
          </span>
          {/* シンプルな chevron。緑ボタンや丸ラベルは使わない。 */}
          <Chevron open={open} />
        </button>
      </h3>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-5 pt-4 pb-5 border-t border-[color:var(--liff-border)] flex flex-col gap-3 bg-[color:var(--liff-surface)]"
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

/** Chevron アイコン。open のときは下向き → 上向きに 180° 回転。
 *  色は currentColor 継承で、ヘッダーの文字色 (secondary) に追従する。 */
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
