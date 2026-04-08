"use client";

// src/components/liff/LiffRenderer.tsx
// LIFF表示用ブロックレンダラー — block_type に応じてコンポーネントを切り替え

import type { LiffBlockType, VisibilityCondition } from "@/types";
import {
  FreeTextBlock,
  StartButtonBlock,
  ResumeButtonBlock,
  ProgressBlock,
  EvidenceListBlock,
  HintListBlock,
  CharacterListBlock,
  ImageBlock,
  VideoBlock,
} from "./renderers";
import type { Evidence, Hint, CharacterInfo } from "./renderers";

export interface LiffBlock {
  id: string;
  block_type: LiffBlockType;
  sort_order: number;
  title: string | null;
  settings_json: Record<string, unknown>;
  visibility_condition_json: VisibilityCondition | null;
}

export type UserState = "before_start" | "in_progress" | "completed";

export interface LiffRenderContext {
  userState: UserState;
  progress?: { current: number; total: number };
  evidences?: Evidence[];
  hints?: Hint[];
  characters?: CharacterInfo[];
  canResume?: boolean;
  onStart?: () => Promise<void>;
  onResume?: () => Promise<void>;
}

function shouldShow(condition: VisibilityCondition | null, userState: UserState): boolean {
  if (!condition || condition === "always") return true;
  return condition === userState;
}

function RenderBlock({ block, ctx }: { block: LiffBlock; ctx: LiffRenderContext }) {
  const s = block.settings_json;
  switch (block.block_type) {
    case "free_text":
      return <FreeTextBlock title={block.title} settings={s} />;
    case "start_button":
      return <StartButtonBlock settings={s} onStart={ctx.onStart} />;
    case "resume_button":
      return <ResumeButtonBlock settings={s} canResume={ctx.canResume ?? false} onResume={ctx.onResume} />;
    case "progress":
      return (
        <ProgressBlock
          title={block.title}
          settings={s}
          current={ctx.progress?.current ?? 0}
          total={ctx.progress?.total ?? 1}
        />
      );
    case "evidence_list":
      return <EvidenceListBlock title={block.title} settings={s} evidences={ctx.evidences ?? []} />;
    case "hint_list":
      return <HintListBlock title={block.title} settings={s} hints={ctx.hints ?? []} />;
    case "character_list":
      return <CharacterListBlock title={block.title} settings={s} characters={ctx.characters ?? []} />;
    case "image":
      return <ImageBlock settings={s} />;
    case "video":
      return <VideoBlock settings={s} />;
    default:
      return null;
  }
}

export function LiffRenderer({
  blocks,
  title,
  ctx,
}: {
  blocks: LiffBlock[];
  title?: string | null;
  ctx: LiffRenderContext;
}) {
  const visibleBlocks = blocks.filter((b) =>
    shouldShow(b.visibility_condition_json, ctx.userState)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">{title || "LIFF"}</h1>
      </header>

      {/* ブロック */}
      <main className="px-4 py-4 space-y-4 max-w-lg mx-auto">
        {visibleBlocks.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">
            表示する項目がありません
          </p>
        ) : (
          visibleBlocks.map((block) => (
            <section key={block.id} className="bg-white rounded-xl p-4 shadow-sm">
              <RenderBlock block={block} ctx={ctx} />
            </section>
          ))
        )}
      </main>
    </div>
  );
}
