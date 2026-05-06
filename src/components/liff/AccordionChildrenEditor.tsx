"use client";

// src/components/liff/AccordionChildrenEditor.tsx
// accordion ブロックの children を編集するインライン UI（再帰）

import { useState } from "react";
import type { LiffBlockType, NestedLiffBlock, AccordionSettings } from "@/types";
import { LIFF_MAX_ACCORDION_DEPTH } from "@/lib/validations";
import { BLOCK_TYPE_REGISTRY } from "./block-type-registry";
import { BlockSettingsForm } from "./block-settings-forms";

const NESTED_BLOCK_TYPES: LiffBlockType[] = [
  "heading",
  "text",
  "warning",
  "image",
  "button_link",
  "divider",
  "accordion",
];

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

interface Props {
  items: NestedLiffBlock[];
  depth: number;
  readOnly?: boolean;
  onChange: (next: NestedLiffBlock[]) => void;
}

export function AccordionChildrenEditor({ items, depth, readOnly, onChange }: Props) {
  const canNestAccordion = depth < LIFF_MAX_ACCORDION_DEPTH;

  const updateAt = (idx: number, patch: Partial<NestedLiffBlock>) => {
    const next = items.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };
  const removeAt = (idx: number) => {
    if (!confirm("このブロックを削除しますか？")) return;
    onChange(items.filter((_, i) => i !== idx));
  };
  const moveItem = (idx: number, dir: "up" | "down") => {
    const newIdx = dir === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= items.length) return;
    const next = [...items];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    onChange(next);
  };
  const duplicateAt = (idx: number) => {
    const src = items[idx];
    const cloned: NestedLiffBlock = JSON.parse(JSON.stringify(src));
    cloned.id = genId();
    onChange([...items.slice(0, idx + 1), cloned, ...items.slice(idx + 1)]);
  };
  const addChild = (blockType: LiffBlockType) => {
    const entry = BLOCK_TYPE_REGISTRY[blockType];
    if (!entry) return;
    const newItem: NestedLiffBlock = {
      id:            genId(),
      block_type:    blockType,
      title:         null,
      settings_json: { ...entry.defaultSettings },
    };
    onChange([...items, newItem]);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-gray-400 px-1">子要素がまだありません。</p>
      )}
      {items.map((child, idx) => (
        <ChildItem
          key={child.id ?? idx}
          item={child}
          index={idx}
          total={items.length}
          depth={depth}
          canNestAccordion={canNestAccordion}
          readOnly={readOnly}
          onUpdate={(patch) => updateAt(idx, patch)}
          onRemove={() => removeAt(idx)}
          onMove={(dir) => moveItem(idx, dir)}
          onDuplicate={() => duplicateAt(idx)}
        />
      ))}

      {!readOnly && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {NESTED_BLOCK_TYPES.map((t) => {
            const entry = BLOCK_TYPE_REGISTRY[t];
            const disabled = t === "accordion" && !canNestAccordion;
            return (
              <button
                key={t}
                type="button"
                onClick={() => addChild(t)}
                disabled={disabled}
                title={disabled ? `accordion は最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層までです` : undefined}
                className="px-2.5 py-1 text-[11px] bg-violet-50 border border-violet-200 rounded-md text-violet-700 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + {entry.icon} {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChildItem({
  item, index, total, depth, canNestAccordion, readOnly,
  onUpdate, onRemove, onMove, onDuplicate,
}: {
  item: NestedLiffBlock;
  index: number;
  total: number;
  depth: number;
  canNestAccordion: boolean;
  readOnly?: boolean;
  onUpdate: (patch: Partial<NestedLiffBlock>) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onDuplicate: () => void;
}) {
  const entry = BLOCK_TYPE_REGISTRY[item.block_type];
  const [open, setOpen] = useState(true);

  const isAccordion = item.block_type === "accordion";
  const accSettings = (item.settings_json ?? {}) as AccordionSettings;

  return (
    <div className="border border-gray-200 rounded-md bg-gray-50">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-1.5 py-0.5 rounded text-gray-600 hover:bg-gray-200"
          aria-expanded={open}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="text-sm">{entry?.icon}</span>
        <span className="text-xs font-medium text-gray-800 flex-1 truncate">
          {entry?.label ?? item.block_type}
          {item.title && <span className="ml-1 text-gray-400">— {item.title}</span>}
          {isAccordion && accSettings.title && <span className="ml-1 text-gray-400">— {accSettings.title}</span>}
        </span>
        <span className="text-[10px] text-gray-400">L{depth + 1}</span>
        {!readOnly && (
          <div className="flex gap-0.5">
            <button type="button" onClick={() => onMove("up")} disabled={index === 0} className="text-[10px] px-1 py-0.5 text-gray-500 disabled:opacity-30" aria-label="上へ">▲</button>
            <button type="button" onClick={() => onMove("down")} disabled={index === total - 1} className="text-[10px] px-1 py-0.5 text-gray-500 disabled:opacity-30" aria-label="下へ">▼</button>
            <button type="button" onClick={onDuplicate} className="text-[10px] px-1.5 py-0.5 text-gray-600 border border-gray-200 rounded bg-white hover:bg-gray-50">複製</button>
            <button type="button" onClick={onRemove} className="text-[10px] px-1.5 py-0.5 text-red-500 border border-red-100 rounded bg-white hover:bg-red-50">削除</button>
          </div>
        )}
      </div>

      {open && (
        <div className="p-2.5 space-y-2">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">ブロックタイトル（任意）</label>
            <input
              className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
              value={item.title ?? ""}
              onChange={(e) => onUpdate({ title: e.target.value || null })}
              disabled={readOnly}
              placeholder={isAccordion ? "（settings 側のタイトルが優先されます）" : ""}
            />
          </div>

          <BlockSettingsForm
            blockType={item.block_type}
            settings={(item.settings_json ?? {}) as Record<string, unknown>}
            onChange={(s) => onUpdate({ settings_json: s as NestedLiffBlock["settings_json"] })}
            readOnly={readOnly}
          />

          {isAccordion && (
            <div className="border-t border-gray-200 pt-2 mt-2">
              <p className="text-[11px] text-gray-500 mb-1.5">
                ↳ accordion の子要素（現在 L{depth + 1}）
                {!canNestAccordion && (
                  <span className="ml-1 text-amber-600">最大ネスト深度に到達済み</span>
                )}
              </p>
              <AccordionChildrenEditor
                items={accSettings.children ?? []}
                depth={depth + 1}
                readOnly={readOnly}
                onChange={(next) =>
                  onUpdate({
                    settings_json: { ...accSettings, children: next } as NestedLiffBlock["settings_json"],
                  })
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
