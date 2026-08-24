// src/components/liff/liff-style-helpers.ts
//
// LIFF プレイヤー / プレビュー共通のスタイル計算ヘルパー。
// 個別の renderer から直接参照されるため、副作用は一切持たないこと。

import type {
  LiffColorMode,
  LiffFontFamily,
  LiffFontPreset,
  LiffFontScale,
  LiffFontTheme,
  LiffFontWeight,
  LiffFontWeightLevel,
  LiffLayoutDensity,
  LiffHeadingLevel,
  LiffDescriptionAlign,
  LiffPageConfigSettings,
  LiffPageType,
  HeadingSettings,
  TextSettings,
} from "@/types";
import type { LiffHomeSettings, LiffHomeFontFamily } from "@/types";
import { normalizeLiffPageType } from "@/types";

/** works.liff_home_settings_json（任意 JSON）を安全に正規化する。
 *  - null / {} / 配列 / 不正値 → 全 null（= 未設定 = 従来表示）
 *  - 空文字・空白のみの文字列 → null（説明文は内部の改行は保持する）
 *  サーバー(API)・クライアント(プレビュー)双方から使う純粋関数。 */
export function parseLiffHomeSettings(json: unknown): LiffHomeSettings {
  const o =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  return {
    title:        str(o.title),
    description:  str(o.description),
    image_url:    str(o.image_url),
    header_title: str(o.header_title),
    font_family:  parseHomeFontFamily(o.font_family),
    home_menu_layout: o.home_menu_layout === "list" ? "list" : "card",
  };
}

/** liff_home_settings_json.font_family を安全に正規化する。未知値/未設定 → null（= 従来フォント）。 */
export function parseHomeFontFamily(v: unknown): LiffHomeFontFamily | null {
  if (v === "meiryo" || v === "hiragino" || v === "yu_gothic" || v === "ud") return v;
  return null; // "default" / null / 不正値 → 従来フォント
}

/** ホームフォントを LIFF ホーム + 配下ページにカスケード適用するためのラッパー class。
 *  null/"default" は空文字（= 従来フォント・class なし）。liff-font.css の .liff-home-font--* に対応。 */
export function homeFontWrapperClass(font: LiffHomeFontFamily | null | undefined): string {
  switch (font) {
    case "meiryo":    return "liff-home-font--meiryo";
    case "hiragino":  return "liff-home-font--hiragino";
    case "yu_gothic": return "liff-home-font--yu-gothic";
    case "ud":        return "liff-home-font--ud";
    default:          return "";
  }
}

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

// ── フォントテーマ / カラーモード (現行仕様) ──────────────────────────────
//
// どちらも settings_json に文字列で入るだけで、DB migration は不要。
// 「未設定 = 現行既定と完全に同じ見た目」を最優先の不変条件とする。

/** 旧 font_preset の値を新 font_theme の値にマップする（読み取り側変換・data migration なし）。 */
function legacyFontPresetToTheme(preset: LiffFontPreset | undefined): LiffFontTheme | undefined {
  switch (preset) {
    case "noto_sans_jp": return "gothic";
    case "serif":        return "classic";
    case "system_sans":  return "modern";
    case "line_seed_jp": return "default";
    default:             return undefined;
  }
}

const FONT_THEMES: readonly LiffFontTheme[] = ["default", "gothic", "rounded", "classic", "modern"];

/** settings から **最終的に適用するフォントテーマ** を解決する。
 *  優先順位: font_theme (現行) → font_preset (旧) → font_family (最旧) → "default"。
 *  不正値・未知値はすべて "default" に倒す（= 現行既定フォント）。 */
export function resolveFontTheme(settings: LiffPageConfigSettings | undefined): LiffFontTheme {
  const theme = settings?.font_theme;
  if (theme && FONT_THEMES.includes(theme)) return theme;
  // font_preset / font_family は resolveFontPreset が既にフォールバック済み（未設定なら line_seed_jp）。
  return legacyFontPresetToTheme(resolveFontPreset(settings)) ?? "default";
}

/** font theme → root クラス名。"default" は既定なので空文字を返す（= 既存 DOM と一致）。 */
export function fontThemeClass(theme: LiffFontTheme): string {
  switch (theme) {
    case "gothic":  return "liff-font-theme--gothic";
    case "rounded": return "liff-font-theme--rounded";
    case "classic": return "liff-font-theme--classic";
    case "modern":  return "liff-font-theme--modern";
    case "default":
    default:        return "";
  }
}

const COLOR_MODES: readonly LiffColorMode[] = ["light", "dark", "system", "sepia", "bordeaux", "terminal"];

/** settings から **最終的に適用するカラーモード** を解決する。
 *  未設定 / 不正値 / 未知値 → "light"（= 現行既定の白ベース）。 */
export function resolveColorMode(settings: LiffPageConfigSettings | undefined): LiffColorMode {
  const mode = settings?.color_mode;
  return mode && COLOR_MODES.includes(mode) ? mode : "light";
}

/** color mode → root クラス名。"light" は既定なので空文字を返す（= 既存 DOM / 見た目と完全一致）。 */
export function colorModeClass(mode: LiffColorMode): string {
  switch (mode) {
    case "dark":     return "liff-color-mode-dark";
    case "system":   return "liff-color-mode-system";
    case "sepia":    return "liff-color-mode-sepia";
    case "bordeaux": return "liff-color-mode-bordeaux";
    case "terminal": return "liff-color-mode-terminal";
    case "light":
    default:         return "";
  }
}

// ── 文字サイズ / 文字の太さ (ページ全体) ───────────────────────────────
//
// どちらも settings_json に文字列で入るだけで DB migration は不要。
// 「未設定 = 現行既定と完全に同じ見た目（= class なし）」を不変条件とする。

const FONT_SCALES: readonly LiffFontScale[] = ["sm", "md", "lg", "xl"];

/** settings から **最終的に適用する文字サイズ倍率** を解決する。
 *  未設定 / 不正値 / 未知値 → "md"（= 現行と同じ大きさ）。 */
export function resolveFontScale(settings: LiffPageConfigSettings | undefined): LiffFontScale {
  const scale = settings?.font_scale;
  return scale && FONT_SCALES.includes(scale) ? scale : "md";
}

/** font scale → root クラス名。"md" は既定なので空文字を返す（= 既存 DOM と一致）。 */
export function fontScaleClass(scale: LiffFontScale): string {
  switch (scale) {
    case "sm": return "liff-font-size--sm";
    case "lg": return "liff-font-size--lg";
    case "xl": return "liff-font-size--xl";
    case "md":
    default:   return "";
  }
}

/** settings から **見出し系に適用する文字サイズ倍率** を解決する。
 *  優先順位: heading_scale → font_scale（本文系）→ "md"。
 *  未指定時に font_scale へ倒すことで、見出し／本文を分ける前のページの見た目が変わらない。 */
export function resolveHeadingScale(settings: LiffPageConfigSettings | undefined): LiffFontScale {
  const scale = settings?.heading_scale;
  if (scale && FONT_SCALES.includes(scale)) return scale;
  return resolveFontScale(settings);
}

/** heading scale → root クラス名。"md" は既定なので空文字を返す。 */
export function headingScaleClass(scale: LiffFontScale): string {
  switch (scale) {
    case "sm": return "liff-heading-size--sm";
    case "lg": return "liff-heading-size--lg";
    case "xl": return "liff-heading-size--xl";
    case "md":
    default:   return "";
  }
}

const FONT_WEIGHT_LEVELS: readonly LiffFontWeightLevel[] = ["light", "normal", "bold"];

/** settings から **最終的に適用する文字の太さ** を解決する。
 *  未設定 / 不正値 / 未知値 → "normal"（= 現行と同じ太さ）。 */
export function resolveFontWeightLevel(
  settings: LiffPageConfigSettings | undefined,
): LiffFontWeightLevel {
  const level = settings?.font_weight_level;
  return level && FONT_WEIGHT_LEVELS.includes(level) ? level : "normal";
}

/** font weight level → root クラス名。"normal" は既定なので空文字を返す。 */
export function fontWeightLevelClass(level: LiffFontWeightLevel): string {
  switch (level) {
    case "light": return "liff-font-weight--light";
    case "bold":  return "liff-font-weight--bold";
    case "normal":
    default:      return "";
  }
}

/** settings から **見出し系に適用する文字の太さ** を解決する。
 *  優先順位: heading_weight → font_weight_level（本文系）→ "normal"。 */
export function resolveHeadingWeightLevel(
  settings: LiffPageConfigSettings | undefined,
): LiffFontWeightLevel {
  const level = settings?.heading_weight;
  if (level && FONT_WEIGHT_LEVELS.includes(level)) return level;
  return resolveFontWeightLevel(settings);
}

/** heading weight level → root クラス名。"normal" は既定なので空文字を返す。 */
export function headingWeightLevelClass(level: LiffFontWeightLevel): string {
  switch (level) {
    case "light": return "liff-heading-weight--light";
    case "bold":  return "liff-heading-weight--bold";
    case "normal":
    default:      return "";
  }
}

const LAYOUT_DENSITIES: readonly LiffLayoutDensity[] = ["normal", "compact"];

/** settings から **最終的に適用する余白の詰め具合** を解決する。
 *  未設定 / 不正値 / 未知値 → "normal"（= 現行と同じ余白）。 */
export function resolveLayoutDensity(
  settings: LiffPageConfigSettings | undefined,
): LiffLayoutDensity {
  const d = settings?.layout_density;
  return d && LAYOUT_DENSITIES.includes(d) ? d : "normal";
}

/** layout density → root クラス名。"normal" は既定なので空文字を返す。 */
export function layoutDensityClass(density: LiffLayoutDensity): string {
  return density === "compact" ? "liff-density--compact" : "";
}

/** page settings から root クラス文字列を組み立てる。
 *  既存の className と組み合わせて使う想定: `${ROOT_BASE} ${liffRootClass(settings)}`
 *
 *  返す class:
 *    - フォント: `.liff-font-theme--*`（旧 `.liff-font--*` は fontPresetClass 側に残置。
 *      旧 class を併記すると `.liff-home-font--*` との優先順位が変わるため、ここでは新 class のみ返す）
 *    - カラー : `.liff-color-mode-*`
 *    - サイズ : `.liff-font-size--*`（本文系 = `--liff-fs-mul`）
 *               `.liff-heading-size--*`（見出し系 = `--liff-heading-mul`）
 *    - 太さ   : `.liff-font-weight--*`（本文系 = `--liff-fw-*`）
 *               `.liff-heading-weight--*`（見出し系 = `--liff-heading-fw*`）
 *    - 余白   : `.liff-density--compact`（項目高さ・行間・ブロック間の余白を詰める）
 *  すべて既定値のときは空文字なので、未設定ページの DOM は従来と 1 文字も変わらない。 */
export function liffRootClass(settings: LiffPageConfigSettings | undefined): string {
  return [
    fontThemeClass(resolveFontTheme(settings)),
    colorModeClass(resolveColorMode(settings)),
    fontScaleClass(resolveFontScale(settings)),
    fontWeightLevelClass(resolveFontWeightLevel(settings)),
    headingScaleClass(resolveHeadingScale(settings)),
    headingWeightLevelClass(resolveHeadingWeightLevel(settings)),
    layoutDensityClass(resolveLayoutDensity(settings)),
  ].filter(Boolean).join(" ");
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
// 作品メニューホーム (グリッドカード) 用ヘルパー
//
// `/liff/w/[workPublicId]` は work 配下の有効な LiffPageConfig をカードとして
// 一覧表示する設計。並び順 / 表示名 / アイコン / 表示有無の解決ロジックをここに集約。
//
// 旧 tab_* 設定 (PR #59) は backward compat のため fallback で参照する:
//   show_in_menu  未指定なら tab_enabled を見る (どちらも未指定なら表示)
//   menu_label    未指定なら tab_label を見る (どちらも未指定なら title → 既定名)
// 個別ページの本文タイトルは LiffPageConfig.title をそのまま使う (専用フィールドを設けない)。
// ───────────────────────────────────────────────────────────

/** pageType ごとの既定日本語ラベル。menu_label / title が両方未設定の最終フォールバック。 */
export function defaultMenuLabel(pageType: LiffPageType): string {
  switch (pageType) {
    case "hint":      return "ヒント";
    case "location":  return "ロケーション";
    case "survey":    return "アンケート";
    case "character": return "キャラクター";
    case "faq":       return "FAQ";
    case "werewolf":  return "人狼";
    case "contact":   return "お問い合わせ";
    case "puzzle":    return "謎・問題";
    case "ticket_link": return "チケット連携";
    case "hint_search": return "ヒント";
    case "default":   return "メニュー";
  }
}

/** pageType ごとの既定アイコン (emoji)。menu_icon 未指定時のフォールバック。 */
export function defaultMenuIcon(pageType: LiffPageType): string {
  switch (pageType) {
    case "hint":      return "💡";
    case "location":  return "📍";
    case "survey":    return "📝";
    case "character": return "🎭";
    case "faq":       return "❓";
    case "werewolf":  return "🐺";
    case "contact":   return "✉️";
    case "puzzle":    return "🧩";
    case "ticket_link": return "🎫";
    case "hint_search": return "🔍";
    case "default":   return "📄";
  }
}

/** メニューカードに出す表示文字列を解決する。
 *  優先順: settings.menu_label → settings.tab_label (旧) → page.title。
 *  いずれも空なら "" を返す（ページ種別の既定名 fallback は撤去＝タイトル任意化）。
 *  pageType 引数は後方互換のため残す（既定名 fallback には使わない）。 */
export function resolveMenuLabel(args: {
  pageType: LiffPageType;
  title?:   string | null;
  settings?: LiffPageConfigSettings | null;
}): string {
  const m = args.settings?.menu_label?.trim();
  if (m) return m;
  const t = args.settings?.tab_label?.trim();
  if (t) return t;
  const p = args.title?.trim();
  if (p) return p;
  return "";
}

/** メニューカードのアイコン (emoji) を解決する。
 *  優先順: settings.menu_icon → defaultMenuIcon(pageType) */
export function resolveMenuIcon(
  pageType: LiffPageType,
  settings: LiffPageConfigSettings | null | undefined
): string {
  const i = settings?.menu_icon?.trim();
  if (i) return i;
  return defaultMenuIcon(pageType);
}

/** メニューカードのアイコン画像 URL を解決する。
 *  設定があれば trim 済み URL、空文字/未設定なら null（= emoji 表示にフォールバック）。 */
export function resolveMenuIconImageUrl(
  settings: LiffPageConfigSettings | null | undefined
): string | null {
  const u = settings?.menu_icon_image_url?.trim();
  return u ? u : null;
}

/** 「このページをメニューホームのカードに出すか」を判定する。
 *  - `is_enabled === false` なら非表示 (= 公開対象外)
 *  - `settings.show_in_menu === false` 明示で非表示
 *  - 旧 `settings.tab_enabled === false` も尊重 (backward compat)
 *  - それ以外は表示 (default) */
export function isShownInMenu(args: {
  is_enabled: boolean;
  settings?: LiffPageConfigSettings | null;
}): boolean {
  if (args.is_enabled === false) return false;
  if (args.settings?.show_in_menu === false) return false;
  if (args.settings?.show_in_menu === undefined && args.settings?.tab_enabled === false) return false;
  return true;
}

export interface MenuCardSource {
  id:             string;
  public_id?:     string | null;
  page_type:      string | null | undefined;
  title:          string | null;
  is_enabled:     boolean;
  settings_json?: LiffPageConfigSettings | null;
  created_at?:    string | Date | null;
}

export interface MenuCard {
  id:        string;
  publicId:  string | null;
  pageType:  LiffPageType;
  label:     string;
  icon:      string;
  /** アイコン画像 URL。設定時は icon(emoji) より優先して画像表示。未設定は null。 */
  iconImageUrl: string | null;
  order:     number;
  /** カード表示形式。settings.menu_card_style 未指定は "card"。 */
  cardStyle: "card" | "compact";
}

const ORDER_FALLBACK = 9999;

/** raw page リスト → 並び替え済みカード配列。
 *  並び順:
 *    1. settings.menu_order の昇順 (未指定は ORDER_FALLBACK)
 *    2. created_at 昇順 (古い順)
 *    3. 入力配列順 (安定ソート保険)
 *  非表示 (isShownInMenu=false) は事前に除外。 */
export function buildMenuCards(pages: MenuCardSource[]): MenuCard[] {
  return pages
    .map((p, idx) => {
      const pageType = normalizeLiffPageType(p.page_type);
      const settings = p.settings_json ?? null;
      const createdAtMs = p.created_at
        ? (typeof p.created_at === "string" ? Date.parse(p.created_at) : p.created_at.getTime())
        : 0;
      return {
        idx,
        createdAtMs: isNaN(createdAtMs) ? 0 : createdAtMs,
        pageType,
        page: p,
        settings,
        order: settings?.menu_order ?? ORDER_FALLBACK,
      };
    })
    .filter(({ page, settings }) => isShownInMenu({ is_enabled: page.is_enabled, settings }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      return a.idx - b.idx;
    })
    .map(({ page, pageType, settings, order }) => ({
      id:        page.id,
      publicId:  page.public_id ?? null,
      pageType,
      label:     resolveMenuLabel({ pageType, title: page.title, settings }),
      icon:      resolveMenuIcon(pageType, settings),
      iconImageUrl: resolveMenuIconImageUrl(settings),
      order,
      cardStyle: settings?.menu_card_style === "compact" ? "compact" as const : "card" as const,
    }));
}
