"use client";

// src/components/liff/AccordionChildrenEditor.tsx
// accordion ブロックの children を編集するインライン UI（再帰）
//
// このエディタの各インスタンスは「ある 1 つの accordion の children 配列」だけを受け持ち、
// 変更は onChange で親へ返す（recursive immutable update）。
// 親を指す path / parentId を自分で持たないため、階層をまたぐ取り違えが構造的に起きない。
//
// PR (accordion-nesting-ux) での変更点:
//   - 追加ボタンに **追加先の accordion 名** を出す（「＋『ヒント1』の中に追加」）。
//     ページ直下へ追加する導線（LiffAddBlockModal）と取り違えないようにするため。
//   - 縦ガイド線 + インデントで「どの accordion の中身か」を視覚化する。
//   - ネスト上限に達している場合、エラーを出してから気付くのではなく
//     **追加ボタンの時点で disabled + 理由表示**にする。
//     ただし上限に達しても text / image 等は追加できる（制限は accordion だけ）。
//   - 削除確認に子孫数を出す。

import { useState } from "react";
import type { LiffBlockType, NestedLiffBlock, AccordionSettings } from "@/types";
import { LIFF_MAX_ACCORDION_DEPTH } from "@/lib/validations";
import { BLOCK_TYPE_REGISTRY } from "./block-type-registry";
import { BlockSettingsForm } from "./block-settings-forms";
import { countNestedBlocks } from "./accordion-tree";
import { accordionEditorIndentClass } from "./accordion-depth-style";

// accordion の子として追加できるブロック。
// text ではなく free_text を使う（root の ADDABLE_BLOCK_TYPES と揃える。text は legacy 扱い）。
// 既存の nested "text" ブロックは NestedRenderer / registry 側で従来どおり描画・編集できる。
const NESTED_BLOCK_TYPES: LiffBlockType[] = [
  "heading",
  "free_text",
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

/** 子要素の表示名（削除確認・追加ボタンのラベルに使う）。 */
function childLabel(item: NestedLiffBlock): string {
  const entry = BLOCK_TYPE_REGISTRY[item.block_type];
  if (item.block_type === "accordion") {
    const s = (item.settings_json ?? {}) as AccordionSettings;
    const t = s.title?.trim() || item.title?.trim();
    if (t) return t;
  }
  return item.title?.trim() || entry?.label || item.block_type;
}

interface Props {
  items: NestedLiffBlock[];
  depth: number;
  /** 追加先を明示するための、この children を持つ accordion の名前。 */
  parentLabel: string;
  readOnly?: boolean;
  onChange: (next: NestedLiffBlock[]) => void;
}

export function AccordionChildrenEditor({ items, depth, parentLabel, readOnly, onChange }: Props) {
  const canNestAccordion = depth < LIFF_MAX_ACCORDION_DEPTH;

  const updateAt = (idx: number, patch: Partial<NestedLiffBlock>) => {
    const next = items.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };
  const removeAt = (idx: number) => {
    const target = items[idx];
    const label = childLabel(target);
    // 子孫がある場合だけ件数を出す（tree 構造上、親を消せば中身も消えるため）。
    const descendants =
      target.block_type === "accordion"
        ? countNestedBlocks(((target.settings_json ?? {}) as AccordionSettings).children)
        : 0;
    const message =
      descendants > 0
        ? `「${label}」と、その中の ${descendants} 項目を削除します。よろしいですか？`
        : `「${label}」を削除しますか？`;
    if (!confirm(message)) return;
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
    // 縦ガイド線 + インデントで「ここは parentLabel の中身」を示す。
    <div className={`space-y-2 border-l-2 border-gray-200 ${accordionEditorIndentClass(depth)}`}>
      {items.length === 0 && (
        <p className="text-xs text-gray-400">
          「{parentLabel}」の中はまだ空です。
        </p>
      )}
      {items.map((child, idx) => (
        <ChildItem
          key={child.id ?? idx}
          item={child}
          index={idx}
          total={items.length}
          depth={depth}
          readOnly={readOnly}
          onUpdate={(patch) => updateAt(idx, patch)}
          onRemove={() => removeAt(idx)}
          onMove={(dir) => moveItem(idx, dir)}
          onDuplicate={() => duplicateAt(idx)}
        />
      ))}

      {!readOnly && (
        <div className="pt-1.5">
          {/* 追加先を必ず名前で示す。ページ直下への追加 (LiffAddBlockModal) と混同させない。 */}
          <p className="text-[11px] font-medium text-gray-600 mb-1">
            ＋「{parentLabel}」の中に追加
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NESTED_BLOCK_TYPES.map((t) => {
              const entry = BLOCK_TYPE_REGISTRY[t];
              const disabled = t === "accordion" && !canNestAccordion;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => addChild(t)}
                  disabled={disabled}
                  className="px-2.5 py-1 text-[11px] bg-brand-soft border border-brand/30 rounded-md text-brand-ink hover:bg-brand-mist disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + {entry.icon} {entry.label}
                </button>
              );
            })}
          </div>
          {/* 上限は「保存しようとしてエラー」ではなく、この時点で理由まで見えるようにする。 */}
          {!canNestAccordion && (
            <p className="text-[11px] text-amber-600 mt-1">
              アコーディオンは最大 {LIFF_MAX_ACCORDION_DEPTH} 階層までのため、ここには追加できません。
              テキストや画像は追加できます。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ChildItem({
  item, index, total, depth, readOnly,
  onUpdate, onRemove, onMove, onDuplicate,
}: {
  item: NestedLiffBlock;
  index: number;
  total: number;
  depth: number;
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
            <button type="button" onClick={onDuplicate} className="text-[10px] px-1.5 py-0.5 text-gray-600 border border-gray-200 rounded bg-white transition-colors hover:bg-gray-50">複製</button>
            <button type="button" onClick={onRemove} className="text-[10px] px-1.5 py-0.5 text-red-600 border border-red-200 rounded bg-white transition-colors hover:bg-red-50">削除</button>
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
              {/* 上限の案内は「その children を実際に受け持つエディタ」側が出す。
                  ここ（親側）の canNestAccordion は 1 階層ずれるため使わない。 */}
              <p className="text-[11px] text-gray-500 mb-1.5">
                ↳ 「{childLabel(item)}」の中身（L{depth + 1}）
              </p>
              <AccordionChildrenEditor
                items={accSettings.children ?? []}
                depth={depth + 1}
                parentLabel={childLabel(item)}
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
