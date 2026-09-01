// src/components/liff/accordion-depth-style.ts
// アコーディオンの「ネスト深度 → 見た目」を決める純関数（no JSX → node テスト可）。
//
// 背景:
//   depth はこれまで analytics（trackHintSiteEvent / recordLiffEvent）にしか渡されておらず、
//   className には一度も使われていなかった。そのため L1 / L2 / L3 の accordion が
//   完全に同一のマークアップ（60px ヘッダ / 16px bold / border-bottom・インデント 0）で描画され、
//   「A の中の B」と「A の隣の B」を見た目で区別できなかった。ここで depth を視覚に接続する。
//
// スマホ (LIFF) 前提の設計方針:
//   - インデントは「親のパネルが子を字下げする」形で **DOM のネストに沿って累積** する。
//     pl-4 / pl-8 / pl-12 と機械的に倍々にすると 3 階層目で本文幅が潰れるため、
//     12px → 10px → 10px と段階的に小さくする。
//     375px 端末（gutter 16px ⇒ 本文 343px）で L3 の本文幅は約 313px を確保できる。
//   - 縦ガイド線（border-left）で「ここは上の見出しの中身」を示す。階層表現の主役はこれ。
//   - 見出しは 16 → 15 → 14px、太さは bold → semibold と僅かに落とすだけに留める。
//     文字サイズを大きく変えると本文の可読性が落ちるため、差は最小限でよい。
//
// 副作用なし。window / document / React に依存しない。

// ページ設定を効かせるためのマーカー class:
//   title  → `liff-h-acc liff-h-acc--<depth>`（heading_scale / heading_weight）
//   header → `liff-acc-h liff-acc-h--<depth>`（layout_density: 項目の高さ）
//   panel  → `liff-acc-p liff-acc-p--<depth>`（layout_density: 本文側の余白）
//   `liff-h-acc liff-h-acc--<depth>` を title に付ける。サイズ / 太さの正準値は
//   ここの text-[Npx] / font-* のままで、liff-font.css 側が同値の calc / var に読み替える
//   （既定倍率 1・既定太さは同値なので、設定していないページの見た目は変わらない）。

/** 見出しタグ。ページは h2（LiffSinglePageRenderer）、ブロックは h3 が既存の規約。
 *  accordion L1 はブロック相当なので h3 から始め、ネストごとに 1 段下げる。 */
export type AccordionHeadingTag = "h3" | "h4" | "h5";

export interface AccordionDepthStyle {
  /** 外枠 <section>。隣接項目との区切り線。 */
  section: string;
  /** ヘッダー <button>。高さが depth ごとに少しずつ下がる。 */
  header: string;
  /** ヘッダー内のタイトル <span>。文字サイズ・太さ。 */
  title: string;
  /** 本文パネル <div>。**子要素のインデントと縦ガイド線はここが担う**。 */
  panel: string;
  /** 見出しタグ（depth 1 → h3 / 2 → h4 / 3 以降 → h5）。 */
  headingTag: AccordionHeadingTag;
}

/** 想定外の depth（0 以下 / 3 超 / 非数値）を 1〜3 に丸める。
 *  保存時の上限は LIFF_MAX_ACCORDION_DEPTH = 3 だが、legacy / 手書き JSON でも壊れないようにする。 */
export function clampAccordionDepth(depth: unknown): 1 | 2 | 3 {
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 1;
  const d = Math.floor(depth);
  if (d <= 1) return 1;
  if (d >= 3) return 3;
  return 2;
}

const BORDER = "border-[color:var(--liff-border)]";

// section に付くマーカー class (`liff-acc-sec` / `liff-acc-sec--<depth>`)。
// header の `liff-acc-h` / panel の `liff-acc-p` と同じ役割で、
// liff-font.css から「行区切りの横線」だけを狙って消せるようにするためのフック
// (settings_json.accordion_divider)。見た目そのものはここでは変えない。

/** 本文パネル共通: 縦ガイド線 + 子要素の縦方向 gap。 */
const PANEL_BASE = `flex flex-col gap-4 border-l ${BORDER}`;

const STYLES: Record<1 | 2 | 3, AccordionDepthStyle> = {
  // L1 — ページ直下。従来の見た目を維持する（既存ページの印象を変えないため）。
  //      パネルにだけガイド線とわずかなインデントが増える。
  1: {
    section:    `liff-acc-sec liff-acc-sec--1 border-b ${BORDER}`,
    header:     "liff-acc-h liff-acc-h--1 min-h-[60px] py-3",
    title:      "liff-h-acc liff-h-acc--1 text-[16px] font-bold",
    panel:      `liff-acc-p liff-acc-p--1 ${PANEL_BASE} pt-1 pb-5 pl-3`,
    headingTag: "h3",
  },
  // L2 — 親アコーディオンの中。
  2: {
    section:    `liff-acc-sec liff-acc-sec--2 border-b ${BORDER}`,
    header:     "liff-acc-h liff-acc-h--2 min-h-[52px] py-2.5",
    title:      "liff-h-acc liff-h-acc--2 text-[15px] font-semibold",
    panel:      `liff-acc-p liff-acc-p--2 ${PANEL_BASE} pt-1 pb-4 pl-2.5`,
    headingTag: "h4",
  },
  // L3 — 現行の保存上限。ここに更に accordion は入れられないが、text / image は入る。
  3: {
    section:    `liff-acc-sec liff-acc-sec--3 border-b ${BORDER}`,
    header:     "liff-acc-h liff-acc-h--3 min-h-[46px] py-2",
    title:      "liff-h-acc liff-h-acc--3 text-[14px] font-semibold",
    panel:      `liff-acc-p liff-acc-p--3 ${PANEL_BASE} pt-1 pb-4 pl-2.5`,
    headingTag: "h5",
  },
};

/** depth（1 起点）に対応する見た目を返す。範囲外は clampAccordionDepth で丸める。 */
export function accordionDepthStyle(depth: unknown): AccordionDepthStyle {
  return STYLES[clampAccordionDepth(depth)];
}

/** CMS（管理画面）側の子要素エディタ用インデント。LIFF とは配色が違うので別に持つ。
 *  depth は AccordionChildrenEditor の depth（= 子要素が並ぶ階層。1 起点）。 */
export function accordionEditorIndentClass(depth: unknown): string {
  // 管理画面は横幅に余裕があるが、深くなるほど詰めるのは LIFF と同じ考え方。
  return clampAccordionDepth(depth) === 1 ? "pl-3" : "pl-2.5";
}
