// src/components/liff/accordion-tree.ts
// アコーディオンの tree に関する純関数（no JSX → node テスト可）。
//
// データモデルは既存の AccordionSettings.children: NestedLiffBlock[] をそのまま Source of Truth
// とする。新しい tree 型 / parentId / normalized entity map は導入しない。
// ここに置くのは「今そこで必要になった読み取り専用の操作」だけ（YAGNI）。
//   - resolveAccordionMode : children と items のどちらのモードかを判定する
//   - countNestedBlocks    : 削除確認で「その中の N 項目」を出すための子孫数
// insertAt / moveNode / isAncestor（親跨ぎ移動）は今回スコープ外のため作らない。

import type { AccordionSettings, NestedLiffBlock } from "@/types";
import { resolveAccordionItems } from "./accordion-items";

/** アコーディオンの中身の持ち方。
 *  - "children" : 入れ子ブロック（text / image / accordion …）。今回の推奨・既定。
 *  - "items"    : title/body だけのフラットな項目リスト（legacy）。
 *                 renderer は items が 1 件でもあると title / children を描画しないため、
 *                 この 2 つは排他として扱う。CMS 側でも同時設定を禁止する。 */
export type AccordionContentMode = "children" | "items";

/** 保存済みデータからモードを判定する。**renderer の分岐（AccordionBlock）と同じ規則**にすること。
 *  有効な item（title か body が非空）が 1 件以上なら "items"、それ以外は "children"。 */
export function resolveAccordionMode(
  settings: AccordionSettings | null | undefined,
): AccordionContentMode {
  const items = resolveAccordionItems(settings?.items);
  return items.length > 0 ? "items" : "children";
}

/** children 配下のブロック総数（入れ子の accordion の中身も含む）を数える。
 *  削除確認の「『◯◯』と、その中の N 項目を削除します」に使う。
 *  不正データ（非配列 / null / 循環していない前提の素の JSON）でも例外を投げない。 */
export function countNestedBlocks(children: unknown): number {
  if (!Array.isArray(children)) return 0;
  let n = 0;
  for (const raw of children) {
    if (!raw || typeof raw !== "object") continue;
    n += 1;
    const child = raw as NestedLiffBlock;
    if (child.block_type === "accordion") {
      const s = (child.settings_json ?? {}) as AccordionSettings;
      n += countNestedBlocks(s.children);
    }
  }
  return n;
}
