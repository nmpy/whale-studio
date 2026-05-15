// src/components/liff/liff-style-helpers.ts
//
// LIFF プレイヤー / プレビュー共通のスタイル計算ヘルパー。
// 個別の renderer から直接参照されるため、副作用は一切持たないこと。

import type {
  LiffFontFamily,
  LiffFontPreset,
  LiffFontWeight,
  LiffHeadingLevel,
  LiffDescriptionAlign,
  LiffPageConfigSettings,
  LiffPageType,
  HeadingSettings,
  TextSettings,
} from "@/types";
import { normalizeLiffPageType } from "@/types";

/** 旧 font_family の値を新 font_preset の値にマップする (data migration なしの読み取り側変換)。 */
function legacyFontFamilyToPreset(family: LiffFontFamily | undefined): LiffFontPreset | undefined {
  if (family === "mincho") return "serif";
  if (family === "gothic") return "line_seed_jp";
  return undefined;
}

/** settings から **最終的に適用するフォントプリセット** を解決する。
 *  優先順位: font_preset (新) → font_family (旧) → "line_seed_jp" (既定)。 */
export function resolveFontPreset(settings: LiffPageConfigSettings | undefined): LiffFontPreset {
  if (settings?.font_preset) return settings.font_preset;
  const legacy = legacyFontFamilyToPreset(settings?.font_family);
  if (legacy) return legacy;
  return "line_seed_jp";
}

/** font preset → root クラス名。"line_seed_jp" は default なので空文字を返す。 */
export function fontPresetClass(preset: LiffFontPreset): string {
  switch (preset) {
    case "system_sans":  return "liff-font--system-sans";
    case "noto_sans_jp": return "liff-font--noto-sans-jp";
    case "serif":        return "liff-font--serif";
    case "line_seed_jp":
    default:             return "";
  }
}

/** @deprecated `liffRootClass(settings)` (= font_preset 経由) を使ってください。
 *  旧 API: font_family のみを見て class を返す。新 API では font_preset 優先。 */
export function fontFamilyClass(family: LiffFontFamily | undefined): string {
  return family === "mincho" ? "liff-font--mincho" : "";
}

/** page settings から root クラス文字列を組み立てる。
 *  既存の className と組み合わせて使う想定: `${ROOT_BASE} ${liffRootClass(settings)}` */
export function liffRootClass(settings: LiffPageConfigSettings | undefined): string {
  return fontPresetClass(resolveFontPreset(settings));
}

/** ヘッダーに表示する文字列を解決する。
 *  優先順位: settings.header_title (CMS で編集可能) → workTitle → pageTitle → "LIFF"
 *  すべて空のときは "LIFF" を返す。 */
export function resolveHeaderTitle(args: {
  settings?:  LiffPageConfigSettings | null;
  workTitle?: string | null;
  pageTitle?: string | null;
}): string {
  const h = args.settings?.header_title?.trim();
  if (h) return h;
  const w = args.workTitle?.trim();
  if (w) return w;
  const p = args.pageTitle?.trim();
  if (p) return p;
  return "LIFF";
}

/** Tailwind の font-weight class へのマッピング。
 *  値が不明 / 未指定の場合は default を返す。
 *  - normal → font-normal (400)
 *  - medium → font-semibold (600)  (LINE Design System の medium は 500-600 のため semibold で代用)
 *  - bold   → font-bold (700) */
export function fontWeightClass(
  weight: LiffFontWeight | undefined,
  fallback: LiffFontWeight = "normal",
): string {
  const w = weight ?? fallback;
  if (w === "medium") return "font-semibold";
  if (w === "bold")   return "font-bold";
  return "font-normal";
}

/** Heading レベルに対応する font-size / line-height の Tailwind クラス。
 *  LINE Gift のような落ち着いた見出しスケールに合わせ、大見出しでも 19-20px に抑える。
 *  数値で受け取り、不明値は H2 (= 17px) にフォールバック。 */
export function headingSizeClass(level: LiffHeadingLevel | undefined): string {
  switch (level) {
    case 1: return "text-[19px] leading-snug";  // 旧 22 → 19 (ページタイトル h2 を廃止したのに合わせ大見出しも控えめに)
    case 2: return "text-[17px] leading-snug";  // 旧 20 → 17 (LINE Gift のセクション見出し相当)
    case 3: return "text-[16px] leading-snug";  // 旧 18 → 16
    case 4: return "text-[15px] leading-snug";  // 旧 16 → 15
    case 5: return "text-[13px] leading-snug";  // 旧 14 → 13 (補助見出し)
    default: return "text-[17px] leading-snug";
  }
}

/** HeadingSettings から最終的に適用する font-weight class を出す。
 *  未指定なら "bold" を既定とする (見出しの既定)。 */
export function headingWeightClass(settings: HeadingSettings): string {
  return fontWeightClass(settings.font_weight, "bold");
}

/** TextSettings から最終的に適用する font-weight class を出す。
 *  互換ルール: 旧 emphasis="strong" は font_weight 未指定でも bold 扱いする。 */
export function textWeightClass(settings: TextSettings): string {
  if (settings.font_weight) return fontWeightClass(settings.font_weight, "normal");
  if (settings.emphasis === "strong") return "font-bold";
  return "font-normal";
}

/** description (ページ本文上部の説明文) の text-align クラス。
 *  値が不明 / 未指定の場合は "center" (LINE Design System Layout 既定) を返す。 */
export function descriptionAlignClass(align: LiffDescriptionAlign | undefined): string {
  if (align === "left")  return "text-left";
  if (align === "right") return "text-right";
  return "text-center";
}

/** page settings から description 用の text-align クラスを出す。
 *  settings 自体が undefined / align 未設定の場合も "text-center" にフォールバック。 */
export function liffDescriptionAlignClass(settings: LiffPageConfigSettings | undefined): string {
  return descriptionAlignClass(settings?.description_align);
}

// ───────────────────────────────────────────────────────────
// 作品メニュー shell (タブ UI) 用ヘルパー
//
// LIFF プレイヤー画面は「1 work = 複数 LiffPageConfig」を作品メニュー shell で束ねて
// タブで表示する設計。タブ表示順 / 表示名 / 表示有無の解決ロジックをここに集約する。
// ───────────────────────────────────────────────────────────

/** タブ表示順 — 仕様で指示された並び (hint → location → survey → character) を優先し、
 *  その後ろに既存の faq / default を続ける。
 *  存在しない pageType の page は normalizeLiffPageType() で "default" に丸めるため、ここには現れない。 */
const TAB_TYPE_ORDER: LiffPageType[] = [
  "hint",
  "location",
  "survey",
  "character",
  "faq",
  "default",
];

export function tabTypeOrderIndex(pageType: LiffPageType): number {
  const i = TAB_TYPE_ORDER.indexOf(pageType);
  return i === -1 ? TAB_TYPE_ORDER.length : i;
}

/** pageType ごとのフォールバックタブラベル (pageType 由来の既定の日本語ラベル)。 */
export function defaultTabLabel(pageType: LiffPageType): string {
  switch (pageType) {
    case "hint":      return "ヒント";
    case "location":  return "ロケーション";
    case "survey":    return "アンケート";
    case "character": return "キャラクター";
    case "faq":       return "FAQ";
    case "default":   return "メニュー";
  }
}

/** タブバーに出す表示文字列を解決する。
 *  優先順: settings.tab_label → page.title → defaultTabLabel(pageType) */
export function resolveTabLabel(args: {
  pageType: LiffPageType;
  title?:   string | null;
  settings?: LiffPageConfigSettings | null;
}): string {
  const t = args.settings?.tab_label?.trim();
  if (t) return t;
  const p = args.title?.trim();
  if (p) return p;
  return defaultTabLabel(args.pageType);
}

/** タブ本文先頭に出すページタイトルを解決する。
 *  優先順: settings.tab_page_title → page.title → defaultTabLabel(pageType) */
export function resolveTabPageTitle(args: {
  pageType: LiffPageType;
  title?:   string | null;
  settings?: LiffPageConfigSettings | null;
}): string {
  const t = args.settings?.tab_page_title?.trim();
  if (t) return t;
  const p = args.title?.trim();
  if (p) return p;
  return defaultTabLabel(args.pageType);
}

/** 「このページをメニュー shell のタブとして出すか」を判定する。
 *  - `is_enabled === false` ならそもそも公開対象外 → タブにも出さない
 *  - `settings.tab_enabled === false` でも非表示
 *  - 未指定 (undefined) は表示扱い (= 既存データを壊さない default) */
export function isTabVisible(args: {
  is_enabled: boolean;
  settings?: LiffPageConfigSettings | null;
}): boolean {
  if (args.is_enabled === false) return false;
  if (args.settings?.tab_enabled === false) return false;
  return true;
}

export interface MenuTabSource {
  id:             string;
  public_id?:     string | null;
  page_type:      string | null | undefined;
  title:          string | null;
  is_enabled:     boolean;
  settings_json?: LiffPageConfigSettings | null;
}

export interface MenuTab {
  id:        string;
  publicId:  string | null;
  pageType:  LiffPageType;
  tabLabel:  string;
  pageTitle: string;
}

/** raw page リスト → 並び替え済みのタブ配列。
 *  - is_enabled / tab_enabled で非表示を除外
 *  - TAB_TYPE_ORDER で並び替え (同種別なら配列入力順を保持)
 *  - pageType を normalize して未知値は "default" へ */
export function buildMenuTabs(pages: MenuTabSource[]): MenuTab[] {
  return pages
    .map((p, idx) => {
      const pageType = normalizeLiffPageType(p.page_type);
      const settings = p.settings_json ?? null;
      return {
        idx,
        pageType,
        page: p,
        settings,
      };
    })
    .filter(({ page, settings }) => isTabVisible({ is_enabled: page.is_enabled, settings }))
    .sort((a, b) => {
      const oa = tabTypeOrderIndex(a.pageType);
      const ob = tabTypeOrderIndex(b.pageType);
      if (oa !== ob) return oa - ob;
      return a.idx - b.idx;
    })
    .map(({ page, pageType, settings }) => ({
      id:        page.id,
      publicId:  page.public_id ?? null,
      pageType,
      tabLabel:  resolveTabLabel({ pageType, title: page.title, settings }),
      pageTitle: resolveTabPageTitle({ pageType, title: page.title, settings }),
    }));
}
