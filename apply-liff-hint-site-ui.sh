#!/usr/bin/env bash
# apply-liff-hint-site-ui.sh
# Whale Studio に LIFF ヒントサイト UI 拡張（commit 5a1320a 相当）を適用する。
# リポジトリのルートで実行すること。
set -euo pipefail

if [ ! -f prisma/schema.prisma ] || [ ! -d src ]; then
  echo "ERROR: whale-studio リポジトリのルートで実行してください" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "ERROR: python3 が見つかりません" >&2; exit 1; }

# ============================================================
# 既存3ファイルへの安全な regex 置換（Python）
#   - prisma/schema.prisma
#   - src/types/index.ts
#   - src/lib/validations/index.ts
# 冪等: 既に適用済みなら skip。マッチしなければ非0終了。
# ============================================================
python3 <<'PYEOF'
import re, sys, pathlib

ROOT = pathlib.Path(".")

# ---- 1. prisma/schema.prisma : LiffPageConfig model 全置換 ----
SCHEMA_NEW = """model LiffPageConfig {
  id          String          @id @default(uuid())
  workId      String          @unique @map("work_id")
  isEnabled   Boolean         @default(false) @map("is_enabled")
  title       String?
  description String?
  /// "default" | "hint_site"（将来 page 種別を増やすための識別子）
  pageType    String          @default("default") @map("page_type")
  /// "draft" | "published" | "archived"
  publishStatus String        @default("draft") @map("publish_status")
  /// ページ全体の設定（ヘッダー / CTA / テーマ など）。詳細は LiffPageConfigSettings 型を参照。
  settingsJson Json           @default("{}") @map("settings_json") @db.JsonB
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  blocks      LiffPageBlock[]
  work        Work            @relation(fields: [workId], references: [id], onDelete: Cascade)

  @@index([pageType])
  @@index([publishStatus])
  @@map("liff_page_configs")
}"""

p = ROOT / "prisma/schema.prisma"
t = p.read_text(encoding="utf-8")
if 'pageType    String          @default("default") @map("page_type")' in t:
    print("[schema.prisma] already patched, skip")
else:
    pat = re.compile(r'^model LiffPageConfig \{.*?^\}', re.MULTILINE | re.DOTALL)
    new, n = pat.subn(SCHEMA_NEW, t, count=1)
    if n != 1:
        print("[schema.prisma] FAIL: LiffPageConfig model not found", file=sys.stderr); sys.exit(1)
    p.write_text(new, encoding="utf-8")
    print("[schema.prisma] patched")

# ---- 2. src/types/index.ts : LIFF セクション全置換 ----
TYPES_NEW = """export type LiffBlockType =
  | "free_text"
  | "start_button"
  | "resume_button"
  | "progress"
  | "evidence_list"
  | "hint_list"
  | "character_list"
  | "image"
  | "video"
  // ── ヒントサイト用ブロック ────────────────────
  | "heading"
  | "text"
  | "warning"
  | "button_link"
  | "divider"
  | "accordion";

export type VisibilityCondition = "always" | "before_start" | "in_progress" | "completed";

/** LIFF ページ種別 — 表示ロジック分岐用 */
export type LiffPageType = "default" | "hint_site";

/** LIFF ページの公開状態（draft = 編集中 / published = 公開中 / archived = 退避） */
export type LiffPublishStatus = "draft" | "published" | "archived";

/** セクション色のバリエーション（テーマで色を出し分けるためのキー） */
export type LiffSectionVariant = "default" | "dark" | "purple";

/** 画像表示サイズ */
export type LiffImageSize = "normal" | "wide" | "full";

export interface FreeTextSettings {
  body?: string;
  align?: "left" | "center";
  emphasis?: "normal" | "strong";
}

export interface StartButtonSettings {
  label?: string;
  confirm_message?: string;
  api_action?: string;
}

export interface ResumeButtonSettings {
  label?: string;
}

export interface ProgressSettings {
  display_format?: "bar" | "text";
  show_denominator?: boolean;
}

export interface EvidenceListSettings {
  max_display_count?: number;
  hide_undiscovered?: boolean;
  empty_message?: string;
}

export interface HintListSettings {
  max_display_count?: number;
  empty_message?: string;
}

export interface CharacterListSettings {
  show_icon?: boolean;
  show_description?: boolean;
}

export interface ImageBlockSettings {
  image_url?: string;
  alt?: string;
  caption?: string;
  /** 表示サイズ（normal=通常 / wide=コンテナ余白なし / full=画面端まで） */
  size?: LiffImageSize;
}

export interface VideoBlockSettings {
  video_url?: string;
  poster_url?: string;
  caption?: string;
}

// ── ヒントサイト用ブロック設定 ──────────────────
export interface HeadingSettings {
  text?: string;
  level?: 1 | 2 | 3;
  align?: "left" | "center";
}

export interface TextSettings {
  body?: string;
  align?: "left" | "center";
  emphasis?: "normal" | "strong";
}

export interface WarningSettings {
  body?: string;
  /** "spoiler" | "info" | "danger" — UIスタイルのヒント */
  tone?: "spoiler" | "info" | "danger";
}

export interface ButtonLinkSettings {
  label?: string;
  url?: string;
  /** 外部リンクとして開くか（LIFF外で開く） */
  open_external?: boolean;
  variant?: LiffSectionVariant;
}

export interface DividerSettings {
  /** "solid" | "dashed"。省略時は solid */
  style?: "solid" | "dashed";
}

/**
 * accordion ブロック設定。
 * children には任意の AnyLiffBlockSettings を含むネスト可能なブロックを格納する。
 * ネストは最大 3 階層に制限する（バリデーション側で担保）。
 */
export interface AccordionSettings {
  title?: string;
  default_open?: boolean;
  variant?: LiffSectionVariant;
  children?: NestedLiffBlock[];
}

/** accordion の中に直接埋め込めるネスト可能ブロック（DBには載らないインライン構造） */
export interface NestedLiffBlock {
  /** 子要素の安定 ID（クライアントで生成・保存） */
  id?: string;
  block_type: LiffBlockType;
  title?: string | null;
  settings_json?: AnyLiffBlockSettings;
}

export type AnyLiffBlockSettings =
  | FreeTextSettings
  | StartButtonSettings
  | ResumeButtonSettings
  | ProgressSettings
  | EvidenceListSettings
  | HintListSettings
  | CharacterListSettings
  | ImageBlockSettings
  | VideoBlockSettings
  | HeadingSettings
  | TextSettings
  | WarningSettings
  | ButtonLinkSettings
  | DividerSettings
  | AccordionSettings;

export type LiffBlockSettings = AnyLiffBlockSettings;

export interface LiffPageBlock {
  id:                        string;
  page_config_id:            string;
  block_type:                LiffBlockType;
  sort_order:                number;
  is_enabled:                boolean;
  title:                     string | null;
  settings_json:             LiffBlockSettings;
  visibility_condition_json: VisibilityCondition | null;
  created_at:                string;
  updated_at:                string;
}

/**
 * LIFF ページ全体の設定。
 *
 * ヒントサイト機能ではヘッダー（ロゴ・CTA）やテーマ設定などをここに格納する。
 * 既存の LiffPageConfig を壊さないように、すべての項目はオプショナル。
 */
export interface LiffPageConfigSettings {
  /** 固定ヘッダーを使用するか（hint_site のとき有効） */
  header_fixed?: boolean;
  /** ロゴ画像 URL（枠内に contain で表示される） */
  header_logo_url?: string;
  /** ロゴの alt テキスト */
  header_logo_alt?: string;
  /** CTA ボタンのラベル（例: "チケットを購入する"） */
  header_cta_label?: string;
  /** CTA ボタンの URL */
  header_cta_url?: string;
  /** ハンバーガーメニューを表示するか（将来の拡張用。現状は枠のみ確保） */
  show_hamburger?: boolean;
  /** 本文上部に表示するネタバレ注意帯のテキスト */
  spoiler_warning_text?: string;
  /** テーマ設定 */
  theme?: {
    /** ヘッダー背景色（CSS color 文字列） */
    header_bg?: string;
    /** ヘッダー文字色 */
    header_fg?: string;
    /** デフォルト variant 色のオーバーライド */
    variants?: {
      default?: { bg?: string; fg?: string; border?: string };
      dark?:    { bg?: string; fg?: string; border?: string };
      purple?:  { bg?: string; fg?: string; border?: string };
    };
  };
}

export interface LiffPageConfig {
  id:             string;
  work_id:        string;
  is_enabled:     boolean;
  title:          string | null;
  description:    string | null;
  page_type:      LiffPageType;
  publish_status: LiffPublishStatus;
  settings_json:  LiffPageConfigSettings;
  blocks:         LiffPageBlock[];
  created_at:     string;
  updated_at:     string;
}

export interface UpdateLiffConfigBody {
  is_enabled?:     boolean;
  title?:          string | null;
  description?:    string | null;
  page_type?:      LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?:  LiffPageConfigSettings;
}

export interface CreateLiffBlockBody {
  block_type:                LiffBlockType;
  sort_order?:               number;
  is_enabled?:               boolean;
  title?:                    string | null;
  settings_json?:            LiffBlockSettings;
  visibility_condition_json?: VisibilityCondition | null;
}

export interface UpdateLiffBlockBody {
  block_type?:               LiffBlockType;
  sort_order?:               number;
  is_enabled?:               boolean;
  title?:                    string | null;
  settings_json?:            LiffBlockSettings;
  visibility_condition_json?: VisibilityCondition | null;
}

export interface ReorderLiffBlocksBody {
  block_ids: string[];
}"""

p = ROOT / "src/types/index.ts"
t = p.read_text(encoding="utf-8")
if 'export type LiffPageType = "default" | "hint_site"' in t:
    print("[types/index.ts] already patched, skip")
else:
    pat = re.compile(
        r'^export type LiffBlockType =.*?^export interface ReorderLiffBlocksBody \{[^}]*?^\}',
        re.MULTILINE | re.DOTALL,
    )
    new, n = pat.subn(TYPES_NEW, t, count=1)
    if n != 1:
        print("[types/index.ts] FAIL: LIFF section not matched", file=sys.stderr); sys.exit(1)
    p.write_text(new, encoding="utf-8")
    print("[types/index.ts] patched")

# ---- 3. src/lib/validations/index.ts : LIFF セクション全置換 ----
VAL_NEW = """export const LIFF_BLOCK_TYPES = [
  "free_text", "start_button", "resume_button", "progress",
  "evidence_list", "hint_list", "character_list", "image", "video",
  // ── ヒントサイト用 ──
  "heading", "text", "warning", "button_link", "divider", "accordion",
] as const;

export const VISIBILITY_CONDITIONS = [
  "always", "before_start", "in_progress", "completed",
] as const;

export const LIFF_PAGE_TYPES = ["default", "hint_site"] as const;
export const LIFF_PUBLISH_STATUSES = ["draft", "published", "archived"] as const;
export const LIFF_SECTION_VARIANTS = ["default", "dark", "purple"] as const;
export const LIFF_IMAGE_SIZES = ["normal", "wide", "full"] as const;

/** accordion ネスト最大深度（最上位 accordion を 1 と数える） */
export const LIFF_MAX_ACCORDION_DEPTH = 3;

const liffBlockTypeSchema = z.enum(LIFF_BLOCK_TYPES);
const visibilityConditionSchema = z.enum(VISIBILITY_CONDITIONS).nullable().optional();
const sectionVariantSchema = z.enum(LIFF_SECTION_VARIANTS).optional();

const freeTextSettingsSchema = z.object({
  body:     z.string().max(5000).optional(),
  align:    z.enum(["left", "center"]).optional(),
  emphasis: z.enum(["normal", "strong"]).optional(),
}).passthrough();

const startButtonSettingsSchema = z.object({
  label:           z.string().max(100).optional(),
  confirm_message: z.string().max(500).optional(),
  api_action:      z.string().max(200).optional(),
}).passthrough();

const resumeButtonSettingsSchema = z.object({
  label: z.string().max(100).optional(),
}).passthrough();

const progressSettingsSchema = z.object({
  display_format:   z.enum(["bar", "text"]).optional(),
  show_denominator: z.boolean().optional(),
}).passthrough();

const evidenceListSettingsSchema = z.object({
  max_display_count: z.number().int().min(1).max(100).optional(),
  hide_undiscovered: z.boolean().optional(),
  empty_message:     z.string().max(200).optional(),
}).passthrough();

const hintListSettingsSchema = z.object({
  max_display_count: z.number().int().min(1).max(100).optional(),
  empty_message:     z.string().max(200).optional(),
}).passthrough();

const characterListSettingsSchema = z.object({
  show_icon:        z.boolean().optional(),
  show_description: z.boolean().optional(),
}).passthrough();

const imageSettingsSchema = z.object({
  image_url: z.string().url().optional(),
  alt:       z.string().max(200).optional(),
  caption:   z.string().max(500).optional(),
  size:      z.enum(LIFF_IMAGE_SIZES).optional(),
}).passthrough();

const videoSettingsSchema = z.object({
  video_url:  z.string().url().optional(),
  poster_url: z.string().url().optional(),
  caption:    z.string().max(500).optional(),
}).passthrough();

// ── ヒントサイト用ブロック設定 ─────────────────
const headingSettingsSchema = z.object({
  text:  z.string().max(300).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  align: z.enum(["left", "center"]).optional(),
}).passthrough();

const textSettingsSchema = z.object({
  body:     z.string().max(5000).optional(),
  align:    z.enum(["left", "center"]).optional(),
  emphasis: z.enum(["normal", "strong"]).optional(),
}).passthrough();

const warningSettingsSchema = z.object({
  body: z.string().max(500).optional(),
  tone: z.enum(["spoiler", "info", "danger"]).optional(),
}).passthrough();

const buttonLinkSettingsSchema = z.object({
  label:         z.string().max(100).optional(),
  url:           z.string().url().optional(),
  open_external: z.boolean().optional(),
  variant:       sectionVariantSchema,
}).passthrough();

const dividerSettingsSchema = z.object({
  style: z.enum(["solid", "dashed"]).optional(),
}).passthrough();

const nestedBlockBaseSchema = z.object({
  id:            z.string().optional(),
  block_type:    liffBlockTypeSchema,
  title:         z.string().max(200).optional().nullable(),
  settings_json: z.record(z.unknown()).optional(),
});

const accordionSettingsSchema: z.ZodTypeAny = z.object({
  title:        z.string().max(300).optional(),
  default_open: z.boolean().optional(),
  variant:      sectionVariantSchema,
  children:     z.array(nestedBlockBaseSchema).optional(),
}).passthrough();

const SETTINGS_SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
  free_text:       freeTextSettingsSchema,
  start_button:    startButtonSettingsSchema,
  resume_button:   resumeButtonSettingsSchema,
  progress:        progressSettingsSchema,
  evidence_list:   evidenceListSettingsSchema,
  hint_list:       hintListSettingsSchema,
  character_list:  characterListSettingsSchema,
  image:           imageSettingsSchema,
  video:           videoSettingsSchema,
  // ── ヒントサイト用 ──
  heading:         headingSettingsSchema,
  text:            textSettingsSchema,
  warning:         warningSettingsSchema,
  button_link:     buttonLinkSettingsSchema,
  divider:         dividerSettingsSchema,
  accordion:       accordionSettingsSchema,
};

/**
 * accordion 内 children を再帰的に検証する。
 */
function validateNestedChildren(
  children: unknown,
  depth: number,
  pathPrefix: (string | number)[],
  issues: z.ZodIssue[],
): void {
  if (children === undefined || children === null) return;
  if (!Array.isArray(children)) {
    issues.push({ code: "custom", path: pathPrefix, message: "children は配列で指定してください" });
    return;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as { block_type?: unknown; settings_json?: unknown };
    const childPath = [...pathPrefix, i];

    if (typeof child !== "object" || child === null) {
      issues.push({ code: "custom", path: childPath, message: "child の形式が不正です" });
      continue;
    }
    const blockType = child.block_type;
    if (typeof blockType !== "string") {
      issues.push({ code: "custom", path: [...childPath, "block_type"], message: "block_type が不正です" });
      continue;
    }
    const schema = SETTINGS_SCHEMA_MAP[blockType];
    if (!schema) {
      issues.push({ code: "custom", path: [...childPath, "block_type"], message: `不明なブロックタイプ: ${blockType}` });
      continue;
    }

    const settings = child.settings_json ?? {};
    const r = schema.safeParse(settings);
    if (!r.success) {
      for (const issue of r.error.issues) {
        issues.push({
          ...issue,
          path: [...childPath, "settings_json", ...issue.path],
        });
      }
    }

    if (blockType === "accordion") {
      const nextDepth = depth + 1;
      if (nextDepth > LIFF_MAX_ACCORDION_DEPTH) {
        issues.push({
          code: "custom",
          path: [...childPath],
          message: `accordion は最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層までしかネストできません`,
        });
        continue;
      }
      const innerSettings = (settings ?? {}) as { children?: unknown };
      validateNestedChildren(
        innerSettings.children,
        nextDepth,
        [...childPath, "settings_json", "children"],
        issues,
      );
    }
  }
}

export function validateBlockSettings(blockType: string, settings: unknown): z.SafeParseReturnType<unknown, unknown> {
  const schema = SETTINGS_SCHEMA_MAP[blockType];
  if (!schema) return { success: false, error: new z.ZodError([{ code: "custom", message: `不明なブロックタイプ: ${blockType}`, path: ["block_type"] }]) } as z.SafeParseError<unknown>;
  const base = schema.safeParse(settings);
  if (!base.success) return base;

  if (blockType === "accordion") {
    const issues: z.ZodIssue[] = [];
    const s = (settings ?? {}) as { children?: unknown };
    validateNestedChildren(s.children, 1, ["children"], issues);
    if (issues.length > 0) {
      return { success: false, error: new z.ZodError(issues) } as z.SafeParseError<unknown>;
    }
  }
  return base;
}

// ── LIFF ページ設定スキーマ（ヒントサイト用フィールドを含む） ──
const liffPageConfigSettingsSchema = z.object({
  header_fixed:         z.boolean().optional(),
  header_logo_url:      z.string().url().optional().or(z.literal("")),
  header_logo_alt:      z.string().max(200).optional(),
  header_cta_label:     z.string().max(100).optional(),
  header_cta_url:       z.string().url().optional().or(z.literal("")),
  show_hamburger:       z.boolean().optional(),
  spoiler_warning_text: z.string().max(500).optional(),
  theme: z.object({
    header_bg: z.string().max(64).optional(),
    header_fg: z.string().max(64).optional(),
    variants: z.object({
      default: z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
      dark:    z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
      purple:  z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
    }).partial().optional(),
  }).partial().optional(),
}).passthrough();

export const updateLiffConfigSchema = z.object({
  is_enabled:     z.boolean().optional(),
  title:          z.string().max(200).optional().nullable(),
  description:    z.string().max(1000).optional().nullable(),
  page_type:      z.enum(LIFF_PAGE_TYPES).optional(),
  publish_status: z.enum(LIFF_PUBLISH_STATUSES).optional(),
  settings_json:  liffPageConfigSettingsSchema.optional(),
});

/**
 * 公開（publish_status="published"）時の必須項目チェック。
 */
export function validatePublishRequirements(args: {
  title:        string | null;
  pageType:     string;
  settings:     unknown;
  blocks:       Array<{ blockType: string; title: string | null; settingsJson: unknown }>;
}): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!args.title || args.title.trim() === "") {
    errors.push("公開するにはタイトルを入力してください");
  }

  const s = (args.settings ?? {}) as Record<string, unknown>;
  if (args.pageType === "hint_site") {
    const ctaLabel = (s.header_cta_label as string | undefined)?.trim();
    const ctaUrl   = (s.header_cta_url   as string | undefined)?.trim();
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
      errors.push("CTA を使う場合はラベルと URL の両方を入力してください");
    }
    if (ctaUrl && !/^https?:\\/\\//.test(ctaUrl)) {
      errors.push("CTA の URL は http:// または https:// で始めてください");
    }
    const logoUrl = (s.header_logo_url as string | undefined)?.trim();
    if (logoUrl && !/^https?:\\/\\//.test(logoUrl)) {
      errors.push("ヘッダーロゴ URL は http:// または https:// で始めてください");
    }
  }

  function walk(blockType: string, title: string | null, settings: unknown, depth: number, label: string) {
    if (blockType === "accordion") {
      const accSettings = (settings ?? {}) as { title?: string; children?: unknown };
      const hasTitle = (accSettings.title?.trim() ?? title?.trim() ?? "") !== "";
      if (!hasTitle) errors.push(`${label}: アコーディオンのタイトルが必要です`);
      if (depth > LIFF_MAX_ACCORDION_DEPTH) {
        errors.push(`${label}: アコーディオンのネストが深すぎます（最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層）`);
      }
      if (Array.isArray(accSettings.children)) {
        accSettings.children.forEach((c, i) => {
          const child = c as { block_type?: string; title?: string | null; settings_json?: unknown };
          if (typeof child?.block_type === "string") {
            walk(child.block_type, child.title ?? null, child.settings_json, depth + 1, `${label} > ${child.block_type}#${i + 1}`);
          }
        });
      }
    } else if (blockType === "image") {
      const imgSettings = (settings ?? {}) as { image_url?: string };
      if (!imgSettings.image_url || imgSettings.image_url.trim() === "") {
        errors.push(`${label}: 画像 URL を設定してください`);
      }
    } else if (blockType === "button_link") {
      const btnSettings = (settings ?? {}) as { url?: string };
      if (!btnSettings.url || btnSettings.url.trim() === "") {
        errors.push(`${label}: リンク URL を設定してください`);
      }
    }
  }
  args.blocks.forEach((b, i) => {
    walk(b.blockType, b.title, b.settingsJson, 1, `${b.blockType}#${i + 1}`);
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export const createLiffBlockSchema = z.object({
  block_type:                liffBlockTypeSchema,
  sort_order:                z.number().int().min(0).optional(),
  is_enabled:                z.boolean().optional(),
  title:                     z.string().max(200).optional().nullable(),
  settings_json:             z.record(z.unknown()).optional().default({}),
  visibility_condition_json: visibilityConditionSchema,
});

export const updateLiffBlockSchema = z.object({
  block_type:                liffBlockTypeSchema.optional(),
  sort_order:                z.number().int().min(0).optional(),
  is_enabled:                z.boolean().optional(),
  title:                     z.string().max(200).optional().nullable(),
  settings_json:             z.record(z.unknown()).optional(),
  visibility_condition_json: visibilityConditionSchema,
});

export const reorderLiffBlocksSchema = z.object({
  block_ids: z.array(z.string().uuid()).min(1),
});"""

# ↑ Python リテラル内では `\\/` 表記で TS の `\/` を保持している（regex 中の / エスケープ）
VAL_NEW = VAL_NEW.replace(r'\\/', r'\/')

p = ROOT / "src/lib/validations/index.ts"
t = p.read_text(encoding="utf-8")
if "validatePublishRequirements" in t and "LIFF_MAX_ACCORDION_DEPTH" in t:
    print("[validations/index.ts] already patched, skip")
else:
    pat = re.compile(
        r'^export const LIFF_BLOCK_TYPES = \[.*?^export const reorderLiffBlocksSchema = z\.object\(\{[^}]*?\}\);',
        re.MULTILINE | re.DOTALL,
    )
    new, n = pat.subn(VAL_NEW, t, count=1)
    if n != 1:
        print("[validations/index.ts] FAIL: LIFF section not matched", file=sys.stderr); sys.exit(1)
    p.write_text(new, encoding="utf-8")
    print("[validations/index.ts] patched")
PYEOF

# ============================================================
# ディレクトリ作成（新規ファイル用）
# ============================================================
mkdir -p prisma/migrations/20260506000000_liff_hint_site
mkdir -p src/components/liff/renderers
mkdir -p src/lib

# ============================================================
# 新規・全文上書きファイル
# ============================================================

cat > prisma/migrations/20260506000000_liff_hint_site/migration.sql <<'EOF'
-- AlterTable: liff_page_configs にヒントサイト用カラムを追加
ALTER TABLE "liff_page_configs"
  ADD COLUMN "page_type"       TEXT  NOT NULL DEFAULT 'default',
  ADD COLUMN "publish_status"  TEXT  NOT NULL DEFAULT 'draft',
  ADD COLUMN "settings_json"   JSONB NOT NULL DEFAULT '{}';

-- 既存レコードを is_enabled に合わせて publish_status を補正する
-- （既に有効な LIFF はそのまま published として扱う）
UPDATE "liff_page_configs"
   SET "publish_status" = 'published'
 WHERE "is_enabled" = TRUE;

-- CreateIndex
CREATE INDEX "liff_page_configs_page_type_idx"      ON "liff_page_configs"("page_type");
CREATE INDEX "liff_page_configs_publish_status_idx" ON "liff_page_configs"("publish_status");
EOF

cat > src/lib/liff-analytics.ts <<'EOF'
// src/lib/liff-analytics.ts
// LIFF（特にヒントサイト）からの軽量分析ログ。
// fire-and-forget で動作し、失敗しても表示には影響しない。

export type HintSiteEventName =
  | "page_view"
  | "accordion_open"
  | "accordion_close"
  | "cta_click";

export interface HintSiteEventPayload {
  work_id?: string;
  url?: string;
  label?: string;
  block_id?: string;
  source?: string;
  depth?: number;
  [k: string]: unknown;
}

/**
 * ヒントサイトのクライアント側分析イベントを発火する。
 *
 * - SSR 中（typeof window === "undefined"）は no-op。
 * - window.__hintSiteAnalytics?.push() があればそちらに渡す。
 * - 開発モードでは console.debug で確認できる。
 */
export function trackHintSiteEvent(name: HintSiteEventName, payload: HintSiteEventPayload = {}): void {
  if (typeof window === "undefined") return;
  try {
    const w = window as unknown as { __hintSiteAnalytics?: { push?: (e: { name: string; payload: unknown; ts: number }) => void } };
    w.__hintSiteAnalytics?.push?.({ name, payload, ts: Date.now() });
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[hint-site] ${name}`, payload);
    }
  } catch {
    // 何もしない — 分析ログは UI を阻害しない
  }
}
EOF

cat > src/lib/liff-utils.ts <<'EOF'
// src/lib/liff-utils.ts
// LIFF 設定関連の共通ユーティリティ

/** DB の LiffPageBlock レコードを API レスポンス形式に変換する */
export function toBlockResponse(b: {
  id: string;
  pageConfigId: string;
  blockType: string;
  sortOrder: number;
  isEnabled: boolean;
  title: string | null;
  settingsJson: unknown;
  visibilityConditionJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:                        b.id,
    page_config_id:            b.pageConfigId,
    block_type:                b.blockType,
    sort_order:                b.sortOrder,
    is_enabled:                b.isEnabled,
    title:                     b.title,
    settings_json:             b.settingsJson,
    visibility_condition_json: b.visibilityConditionJson,
    created_at:                b.createdAt,
    updated_at:                b.updatedAt,
  };
}

/** DB の LiffPageConfig レコード（blocks 含む）を API レスポンス形式に変換する */
export function toConfigResponse(c: {
  id: string;
  workId: string;
  isEnabled: boolean;
  title: string | null;
  description: string | null;
  pageType?: string | null;
  publishStatus?: string | null;
  settingsJson?: unknown;
  createdAt: Date;
  updatedAt: Date;
  blocks: Array<{
    id: string;
    pageConfigId: string;
    blockType: string;
    sortOrder: number;
    isEnabled: boolean;
    title: string | null;
    settingsJson: unknown;
    visibilityConditionJson: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id:             c.id,
    work_id:        c.workId,
    is_enabled:     c.isEnabled,
    title:          c.title,
    description:    c.description,
    page_type:      (c.pageType ?? "default") as "default" | "hint_site",
    publish_status: (c.publishStatus ?? "draft") as "draft" | "published" | "archived",
    settings_json:  (c.settingsJson ?? {}) as Record<string, unknown>,
    blocks:         c.blocks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toBlockResponse),
    created_at:     c.createdAt,
    updated_at:     c.updatedAt,
  };
}
EOF

cat > "src/app/api/liff/works/[workId]/route.ts" <<'EOF'
// src/app/api/liff/works/[workId]/route.ts
// GET /api/liff/works/[workId] — LIFF表示用公開API（認証不要）
// LIFF側から呼ばれる。有効なブロックのみ返す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId } = await ctx.params;

    const work = await prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, title: true, publishStatus: true, oaId: true },
    });
    if (!work) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } },
        { status: 404 }
      );
    }

    const config = await prisma.liffPageConfig.findUnique({
      where: { workId },
      include: {
        blocks: {
          where: { isEnabled: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    // ?preview=1 が指定されているとき（管理画面プレビュー用）は draft でも返す。
    // 通常は published のみ。is_enabled=false は LIFF 自体無効として 404。
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";
    if (!config || !config.isEnabled) {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_DISABLED", message: "このLIFFページは無効です" } },
        { status: 404 }
      );
    }
    if (!preview && config.publishStatus !== "published") {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_NOT_PUBLISHED", message: "このLIFFページはまだ公開されていません" } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        work_id:        work.id,
        work_title:     work.title,
        title:          config.title,
        description:    config.description,
        page_type:      config.pageType,
        publish_status: config.publishStatus,
        settings_json:  config.settingsJson,
        blocks: config.blocks.map((b) => ({
          id:                        b.id,
          block_type:                b.blockType,
          sort_order:                b.sortOrder,
          title:                     b.title,
          settings_json:             b.settingsJson,
          visibility_condition_json: b.visibilityConditionJson,
        })),
      },
    });
  } catch (err) {
    console.error("[LIFF API Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
EOF

cat > "src/app/api/works/[workId]/liff-config/route.ts" <<'EOF'
// src/app/api/works/[workId]/liff-config/route.ts
// GET  /api/works/[workId]/liff-config — LIFF設定取得（blocks含む）
// PUT  /api/works/[workId]/liff-config — LIFF設定更新（upsert）

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateLiffConfigSchema, formatZodErrors, validatePublishRequirements } from "@/lib/validations";
import { toConfigResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── GET ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    let config = await prisma.liffPageConfig.findUnique({
      where: { workId },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

    if (!config) {
      config = await prisma.liffPageConfig.create({
        data: { workId, isEnabled: false },
        include: { blocks: { orderBy: { sortOrder: "asc" } } },
      });
    }

    return ok(toConfigResponse(config));
  } catch (err) {
    return serverError(err);
  }
});

// ── PUT ─────────────────────────────────────────
// editor 以上 = 設定の作成・編集 / draft 操作
// admin  以上 = publish_status を "published" / "archived" に変更
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateLiffConfigSchema.parse(body);

    // 公開系操作は admin 以上を要求
    if (data.publish_status && data.publish_status !== "draft") {
      const adminCheck = await requireRole(oaId, user.id, "admin");
      if (!adminCheck.ok) return adminCheck.response;
    }

    // 公開しようとしている場合は必須項目を検証
    if (data.publish_status === "published") {
      const existing = await prisma.liffPageConfig.findUnique({
        where: { workId },
        include: { blocks: true },
      });
      const settings = data.settings_json ?? (existing?.settingsJson as Record<string, unknown> | undefined) ?? {};
      const title = data.title ?? existing?.title ?? null;
      const pageType = data.page_type ?? existing?.pageType ?? "default";
      const blocks = (existing?.blocks ?? []).map((b) => ({
        blockType:    b.blockType,
        title:        b.title,
        settingsJson: b.settingsJson,
      }));
      const v = validatePublishRequirements({ title, pageType, settings, blocks });
      if (!v.ok) {
        return badRequest("公開できません: " + v.errors.join(" / "));
      }
    }

    const config = await prisma.liffPageConfig.upsert({
      where: { workId },
      create: {
        workId,
        isEnabled:     data.is_enabled ?? false,
        title:         data.title ?? null,
        description:   data.description ?? null,
        pageType:      data.page_type ?? "default",
        publishStatus: data.publish_status ?? "draft",
        settingsJson:  (data.settings_json ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.page_type !== undefined && { pageType: data.page_type }),
        ...(data.publish_status !== undefined && { publishStatus: data.publish_status }),
        ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
      },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

    return ok(toConfigResponse(config));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
EOF

cat > "src/app/liff/work/[workId]/page.tsx" <<'EOF'
"use client";

// src/app/liff/work/[workId]/page.tsx
// LIFF表示ページ — LINE内ブラウザ / 外部ブラウザ両対応

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffRenderer } from "@/components/liff/LiffRenderer";
import { HintSiteRenderer } from "@/components/liff/HintSiteRenderer";
import type { LiffBlock, UserState, LiffRenderContext } from "@/components/liff/LiffRenderer";
import type { LiffPageType, LiffPageConfigSettings, LiffPublishStatus } from "@/types";

interface LiffPageData {
  work_id: string;
  work_title: string;
  title: string | null;
  description: string | null;
  page_type?: LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?: LiffPageConfigSettings;
  blocks: LiffBlock[];
}

export default function LiffViewerPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workId = params.workId as string;
  const isPreview = searchParams.get("preview") === "1";
  const liff = useLiffSDK();

  const [pageData, setPageData] = useState<LiffPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userState, setUserState] = useState<UserState>("before_start");

  useEffect(() => {
    if (!liff.ready) return;

    (async () => {
      try {
        const url = isPreview
          ? `/api/liff/works/${workId}?preview=1`
          : `/api/liff/works/${workId}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.success) {
          setError(json.error?.message || "データの取得に失敗しました");
          return;
        }
        setPageData(json.data);
      } catch {
        setError("サーバーに接続できませんでした");
      } finally {
        setLoading(false);
      }
    })();
  }, [workId, liff.ready, isPreview]);

  useEffect(() => {
    if (!liff.lineUserId || !workId) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/runtime/progress?work_id=${workId}&line_user_id=${liff.lineUserId}`
        );
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            if (json.data.reached_ending) setUserState("completed");
            else if (json.data.current_phase_id) setUserState("in_progress");
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [liff.lineUserId, workId]);

  if (liff.loading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 shadow-sm text-center max-w-sm w-full">
          <p className="text-4xl mb-3">😢</p>
          <h2 className="text-base font-semibold text-gray-900 mb-2">エラーが発生しました</h2>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!pageData) return null;

  if (pageData.page_type === "hint_site") {
    return (
      <>
        {!liff.isInClient && !isPreview && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
            <p className="text-xs text-amber-700 text-center">
              LINEアプリ内で開くと、すべての機能をご利用いただけます
            </p>
          </div>
        )}
        <HintSiteRenderer
          config={{
            work_id:       pageData.work_id,
            title:         pageData.title || pageData.work_title,
            description:   pageData.description,
            settings_json: pageData.settings_json ?? {},
            blocks:        pageData.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })),
          }}
          preview={isPreview}
        />
      </>
    );
  }

  const ctx: LiffRenderContext = {
    userState,
    progress: { current: 0, total: 1 },
    evidences: [],
    hints: [],
    characters: [],
    canResume: userState === "in_progress",
    onStart: async () => {
      if (!liff.lineUserId) {
        alert("LINE にログインしてください");
        return;
      }
      try {
        const res = await fetch("/api/runtime/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_id: workId, line_user_id: liff.lineUserId }),
        });
        if (res.ok) setUserState("in_progress");
      } catch {
        alert("開始に失敗しました。もう一度お試しください。");
      }
    },
    onResume: async () => {
      alert("LINEトーク画面に戻って続きをプレイしてください");
    },
  };

  return (
    <div>
      {!liff.isInClient && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <p className="text-xs text-amber-700 text-center">
            LINEアプリ内で開くと、すべての機能をご利用いただけます
          </p>
        </div>
      )}

      <LiffRenderer
        blocks={pageData.blocks}
        title={pageData.title || pageData.work_title}
        ctx={ctx}
      />
    </div>
  );
}
EOF

cat > src/hooks/useLiffConfig.ts <<'EOF'
"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック

import { useEffect, useState, useCallback } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageBlock, LiffBlockType, LiffPageType, LiffPublishStatus, LiffPageConfigSettings } from "@/types";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  workTitle: string;
  editingBlockId: string | null;

  toggleEnabled: () => Promise<void>;
  updateConfigField: (field: "title" | "description", value: string | null) => Promise<void>;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;
  updatePageType: (next: LiffPageType) => Promise<void>;
  updatePublishStatus: (next: LiffPublishStatus) => Promise<void>;
  updateSettingsField: (key: keyof LiffPageConfigSettings, value: unknown) => Promise<void>;

  addBlock: (blockType: LiffBlockType) => Promise<void>;
  updateBlock: (block: LiffPageBlock) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  toggleBlockEnabled: (block: LiffPageBlock) => Promise<void>;
  moveBlock: (idx: number, direction: "up" | "down") => Promise<void>;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => Promise<void>;

  setEditingBlockId: (id: string | null) => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

  reload: () => Promise<void>;
}

export function useLiffConfig(
  workId: string,
  opts: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void } = {}
): UseLiffConfigReturn {
  const [config, setConfig] = useState<LiffPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workTitle, setWorkTitle] = useState("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const token = getDevToken();
  const { onSuccess, onError } = opts;

  const reload = useCallback(async () => {
    try {
      const [cfg, work] = await Promise.all([
        liffConfigApi.get(token, workId),
        workApi.get(token, workId),
      ]);
      setConfig(cfg);
      setWorkTitle(work.title);
    } catch {
      onError?.("LIFF設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, workId, onError]);

  useEffect(() => { reload(); }, [reload]);

  const toggleEnabled = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { is_enabled: !config.is_enabled });
      setConfig(updated);
      onSuccess?.(updated.is_enabled ? "LIFFを有効にしました" : "LIFFを無効にしました");
    } catch {
      onError?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigField = useCallback(async (field: "title" | "description", value: string | null) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { [field]: value || null });
      setConfig(updated);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...patch });
  }, [config]);

  const updatePageType = useCallback(async (next: LiffPageType) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { page_type: next });
      setConfig(updated);
      onSuccess?.("ページ種別を更新しました");
    } catch {
      onError?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updatePublishStatus = useCallback(async (next: LiffPublishStatus) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { publish_status: next });
      setConfig(updated);
      onSuccess?.(
        next === "published" ? "公開しました" :
        next === "archived"  ? "アーカイブしました" :
        "下書きに戻しました"
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "公開に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateSettingsField = useCallback(async (key: keyof LiffPageConfigSettings, value: unknown) => {
    if (!config) return;
    const nextSettings = { ...(config.settings_json ?? {}), [key]: value };
    setConfig({ ...config, settings_json: nextSettings });
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { settings_json: nextSettings });
      setConfig(updated);
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onError, reload]);

  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    setSaving(true);
    try {
      const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
      const entry = BLOCK_TYPE_REGISTRY[blockType];
      await liffConfigApi.createBlock(token, workId, {
        block_type: blockType,
        title: entry.label,
        settings_json: entry.defaultSettings,
      });
      await reload();
      onSuccess?.("ブロックを追加しました");
    } catch {
      onError?.("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const updateBlock = useCallback(async (block: LiffPageBlock) => {
    setSaving(true);
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, {
        title: block.title,
        is_enabled: block.is_enabled,
        settings_json: block.settings_json as Record<string, unknown>,
        visibility_condition_json: block.visibility_condition_json,
      });
      await reload();
      setEditingBlockId(null);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!confirm("このブロックを削除しますか？")) return;
    setSaving(true);
    try {
      await liffConfigApi.deleteBlock(token, workId, blockId);
      await reload();
      if (editingBlockId === blockId) setEditingBlockId(null);
      onSuccess?.("削除しました");
    } catch {
      onError?.("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, editingBlockId, onSuccess, onError]);

  const toggleBlockEnabled = useCallback(async (block: LiffPageBlock) => {
    updateBlockLocal(block.id, { is_enabled: !block.is_enabled });
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, { is_enabled: !block.is_enabled });
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    }
  }, [token, workId, reload, onError]);

  const moveBlock = useCallback(async (idx: number, direction: "up" | "down") => {
    if (!config) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= config.blocks.length) return;
    const newBlocks = [...config.blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const reorderBlocks = useCallback(async (newBlocks: LiffPageBlock[]) => {
    if (!config) return;
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    if (!config) return;
    setConfig({
      ...config,
      blocks: config.blocks.map((b) => b.id === blockId ? { ...b, ...patch } : b),
    });
  }, [config]);

  return {
    config, loading, saving, workTitle, editingBlockId,
    toggleEnabled, updateConfigField, updateConfigLocal,
    updatePageType, updatePublishStatus, updateSettingsField,
    addBlock, updateBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, updateBlockLocal,
    reload,
  };
}
EOF

cat > src/components/liff/HintSiteRenderer.tsx <<'EOF'
"use client";

// src/components/liff/HintSiteRenderer.tsx
// ヒントサイト用 LIFF ページの全体レイアウト。
// 固定ヘッダー（ロゴ + CTA + ハンバーガー枠）、ネタバレ注意帯、ブロック描画を担う。

import { useEffect, useMemo, useState } from "react";
import type {
  LiffPageConfigSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ImageBlockSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
  LiffBlockType,
} from "@/types";

export interface HintSiteBlock {
  id: string;
  block_type: LiffBlockType;
  title: string | null;
  settings_json: Record<string, unknown>;
}

export interface HintSiteConfig {
  work_id: string;
  title: string | null;
  description: string | null;
  settings_json: LiffPageConfigSettings;
  blocks: HintSiteBlock[];
}
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ImageBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
} from "./renderers";
import { trackHintSiteEvent } from "@/lib/liff-analytics";

interface Props {
  config: HintSiteConfig;
  preview?: boolean;
}

const HEADER_HEIGHT_PX = 56;

export function HintSiteRenderer({ config, preview }: Props) {
  const settings: LiffPageConfigSettings = config.settings_json || {};
  const fixed = settings.header_fixed !== false;

  useEffect(() => {
    if (preview) return;
    trackHintSiteEvent("page_view", { work_id: config.work_id, source: "hint_site" });
  }, [config.work_id, preview]);

  const themeStyle = useMemo<React.CSSProperties>(() => ({
    "--hint-header-bg": settings.theme?.header_bg ?? "#000000",
    "--hint-header-fg": settings.theme?.header_fg ?? "#ffffff",
  } as React.CSSProperties), [settings.theme]);

  return (
    <div
      className="min-h-screen bg-white text-gray-900"
      style={themeStyle}
    >
      <Header
        fixed={fixed}
        logoUrl={settings.header_logo_url}
        logoAlt={settings.header_logo_alt}
        ctaLabel={settings.header_cta_label}
        ctaUrl={settings.header_cta_url}
        showHamburger={settings.show_hamburger}
        title={config.title}
      />

      <div
        style={fixed ? { paddingTop: `calc(${HEADER_HEIGHT_PX}px + env(safe-area-inset-top, 0px))` } : undefined}
      >
        {settings.spoiler_warning_text && (
          <div className="bg-yellow-300 text-black px-4 py-2 text-sm font-bold text-center break-words">
            {settings.spoiler_warning_text}
          </div>
        )}

        <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-5 pb-24">
          {(config.title || config.description) && (
            <div className="space-y-1.5">
              {config.title && (
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 break-words">
                  {config.title}
                </h1>
              )}
              {config.description && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                  {config.description}
                </p>
              )}
            </div>
          )}

          {config.blocks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              （ブロックが追加されていません）
            </p>
          ) : (
            config.blocks.map((b) => <BlockSwitch key={b.id} block={b} />)
          )}
        </main>
      </div>
    </div>
  );
}

function Header({
  fixed, logoUrl, logoAlt, ctaLabel, ctaUrl, showHamburger, title,
}: {
  fixed: boolean;
  logoUrl?: string;
  logoAlt?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  showHamburger?: boolean;
  title?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header
      className={`${fixed ? "fixed top-0 left-0 right-0 z-30" : ""}`}
      style={{
        background: "var(--hint-header-bg)",
        color: "var(--hint-header-fg)",
        paddingTop: fixed ? "env(safe-area-inset-top, 0px)" : undefined,
      }}
    >
      <div
        className="max-w-md mx-auto flex items-center gap-2 px-3"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        <div className="shrink-0 w-[120px] h-[36px] flex items-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={logoAlt || title || "logo"}
              className="max-w-full max-h-full"
              style={{ objectFit: "contain" }}
            />
          ) : (
            <span className="text-sm font-bold truncate">{title || "LIFF"}</span>
          )}
        </div>

        <div className="flex-1 min-w-0" />

        {ctaLabel && ctaUrl && (
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackHintSiteEvent("cta_click", { url: ctaUrl, label: ctaLabel, source: "header" })}
            className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-full bg-white text-black border border-white whitespace-nowrap"
          >
            {ctaLabel}
          </a>
        )}

        {showHamburger && (
          <button
            type="button"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md border border-white/20"
          >
            <span aria-hidden="true" className="text-xl leading-none">≡</span>
          </button>
        )}
      </div>
    </header>
  );
}

function BlockSwitch({ block }: { block: HintSiteBlock }) {
  const s = (block.settings_json ?? {}) as Record<string, unknown>;
  switch (block.block_type) {
    case "heading":
      return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":
    case "free_text":
      return <TextBlock title={block.title} settings={s as TextSettings} />;
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
          title={block.title}
          settings={s as AccordionSettings}
          depth={1}
          blockId={block.id}
        />
      );
    default:
      return null;
  }
}
EOF

cat > src/components/liff/renderers/HeadingBlock.tsx <<'EOF'
"use client";

import type { HeadingSettings } from "@/types";

export function HeadingBlock({ title, settings }: { title?: string | null; settings: HeadingSettings }) {
  const text = settings.text || title || "";
  if (!text) return null;
  const align = settings.align === "center" ? "text-center" : "text-left";
  const level = settings.level ?? 2;
  const cls = level === 1
    ? "text-2xl font-extrabold tracking-tight"
    : level === 3
      ? "text-base font-bold"
      : "text-xl font-bold";
  if (level === 1) return <h1 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h1>;
  if (level === 3) return <h3 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h3>;
  return <h2 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h2>;
}
EOF

cat > src/components/liff/renderers/TextBlock.tsx <<'EOF'
"use client";

import type { TextSettings } from "@/types";

export function TextBlock({ title, settings }: { title?: string | null; settings: TextSettings }) {
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && <h3 className="text-sm font-semibold mb-1 text-gray-900 break-words">{title}</h3>}
      <p
        className={`text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words ${
          settings.emphasis === "strong" ? "font-bold text-gray-900" : ""
        }`}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
EOF

cat > src/components/liff/renderers/WarningBlock.tsx <<'EOF'
"use client";

import type { WarningSettings } from "@/types";

const TONE_STYLES: Record<NonNullable<WarningSettings["tone"]>, { bg: string; fg: string; icon: string }> = {
  spoiler: { bg: "bg-yellow-100", fg: "text-yellow-900", icon: "⚠️" },
  info:    { bg: "bg-blue-50",    fg: "text-blue-900",   icon: "ℹ️" },
  danger:  { bg: "bg-red-100",    fg: "text-red-900",    icon: "🚫" },
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const style = TONE_STYLES[tone];
  return (
    <div
      className={`${style.bg} ${style.fg} px-4 py-3 rounded-lg text-sm leading-relaxed flex gap-2 items-start break-words`}
      role="note"
    >
      <span aria-hidden="true" className="shrink-0">{style.icon}</span>
      <p className="whitespace-pre-wrap font-semibold">{settings.body}</p>
    </div>
  );
}
EOF

cat > src/components/liff/renderers/DividerBlock.tsx <<'EOF'
"use client";

import type { DividerSettings } from "@/types";

export function DividerBlock({ settings }: { settings: DividerSettings }) {
  const style = settings.style === "dashed" ? "border-dashed" : "border-solid";
  return <hr className={`my-2 border-t ${style} border-gray-300`} aria-hidden="true" />;
}
EOF

cat > src/components/liff/renderers/ButtonLinkBlock.tsx <<'EOF'
"use client";

import type { ButtonLinkSettings, LiffSectionVariant } from "@/types";
import { trackHintSiteEvent } from "@/lib/liff-analytics";

const VARIANT_CLASSES: Record<LiffSectionVariant, string> = {
  default: "bg-white text-gray-900 border border-gray-900 hover:bg-gray-50",
  dark:    "bg-gray-900 text-white border border-gray-900 hover:bg-gray-800",
  purple:  "bg-violet-600 text-white border border-violet-600 hover:bg-violet-700",
};

export function ButtonLinkBlock({ settings }: { settings: ButtonLinkSettings }) {
  if (!settings.url || !settings.label) return null;
  const variant = (settings.variant ?? "default") as LiffSectionVariant;
  const cls = VARIANT_CLASSES[variant];
  const target = settings.open_external ? "_blank" : undefined;
  const rel = settings.open_external ? "noopener noreferrer" : undefined;
  return (
    <a
      href={settings.url}
      target={target}
      rel={rel}
      className={`block w-full text-center px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${cls}`}
      onClick={() => trackHintSiteEvent("cta_click", { url: settings.url, label: settings.label, source: "block" })}
    >
      {settings.label}
    </a>
  );
}
EOF

cat > src/components/liff/renderers/AccordionBlock.tsx <<'EOF'
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
import { HeadingBlock } from "./HeadingBlock";
import { TextBlock } from "./TextBlock";
import { WarningBlock } from "./WarningBlock";
import { ImageBlock } from "./ImageBlock";
import { ButtonLinkBlock } from "./ButtonLinkBlock";
import { DividerBlock } from "./DividerBlock";

const VARIANT_HEADER: Record<LiffSectionVariant, string> = {
  default: "bg-white text-gray-900 border-gray-900",
  dark:    "bg-gray-900 text-white border-gray-900",
  purple:  "bg-violet-600 text-white border-violet-600",
};

const VARIANT_BODY: Record<LiffSectionVariant, string> = {
  default: "bg-white border-gray-900",
  dark:    "bg-white border-gray-900",
  purple:  "bg-white border-violet-600",
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
  };

  const panelId = `acc-panel-${id}`;
  const headerId = `acc-header-${id}`;

  return (
    <section className={`border ${variant === "purple" ? "border-violet-600" : "border-gray-900"} rounded-md overflow-hidden`}>
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={`w-full flex items-center justify-between gap-3 text-left px-4 py-3 ${headerCls} transition-colors`}
        >
          <span className="font-bold text-[15px] leading-snug break-words flex-1 min-w-0">
            {headingText || "（タイトル未設定）"}
          </span>
          <span
            aria-hidden="true"
            className={`shrink-0 w-6 h-6 rounded-full border ${
              variant === "default" ? "border-gray-900" : "border-current"
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
            <p className="text-xs text-gray-400">（中身は未設定です）</p>
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
EOF

cat > src/components/liff/renderers/ImageBlock.tsx <<'EOF'
"use client";

import type { ImageBlockSettings } from "@/types";

const MAX_HEIGHTS: Record<NonNullable<ImageBlockSettings["size"]>, number> = {
  normal: 300,
  wide:   420,
  full:   720,
};

export function ImageBlock({ settings }: { settings: ImageBlockSettings }) {
  if (!settings.image_url) return null;
  const size = settings.size ?? "normal";
  const maxHeight = MAX_HEIGHTS[size];

  const wrapperCls = size === "full" ? "-mx-4" : "";
  const imgCls = size === "full" ? "w-full object-cover" : "w-full rounded-lg object-cover";

  return (
    <figure className={wrapperCls}>
      <img
        src={settings.image_url}
        alt={settings.alt || ""}
        className={imgCls}
        style={{ maxHeight }}
        loading="lazy"
      />
      {settings.caption && (
        <figcaption className="text-xs text-gray-500 mt-1 text-center break-words">
          {settings.caption}
        </figcaption>
      )}
    </figure>
  );
}
EOF

cat > src/components/liff/renderers/index.ts <<'EOF'
export { FreeTextBlock } from "./FreeTextBlock";
export { StartButtonBlock } from "./StartButtonBlock";
export { ResumeButtonBlock } from "./ResumeButtonBlock";
export { ProgressBlock } from "./ProgressBlock";
export { EvidenceListBlock } from "./EvidenceListBlock";
export type { Evidence } from "./EvidenceListBlock";
export { HintListBlock } from "./HintListBlock";
export type { Hint } from "./HintListBlock";
export { CharacterListBlock } from "./CharacterListBlock";
export type { CharacterInfo } from "./CharacterListBlock";
export { ImageBlock } from "./ImageBlock";
export { VideoBlock } from "./VideoBlock";
// ── ヒントサイト用 ──
export { HeadingBlock } from "./HeadingBlock";
export { TextBlock } from "./TextBlock";
export { WarningBlock } from "./WarningBlock";
export { DividerBlock } from "./DividerBlock";
export { ButtonLinkBlock } from "./ButtonLinkBlock";
export { AccordionBlock } from "./AccordionBlock";
EOF

cat > src/components/liff/LiffRenderer.tsx <<'EOF'
"use client";

// src/components/liff/LiffRenderer.tsx
// LIFF表示用ブロックレンダラー — block_type に応じてコンポーネントを切り替え

import type {
  LiffBlockType,
  VisibilityCondition,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
} from "@/types";
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
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
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
    case "heading":
      return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":
      return <TextBlock title={block.title} settings={s as TextSettings} />;
    case "warning":
      return <WarningBlock settings={s as WarningSettings} />;
    case "button_link":
      return <ButtonLinkBlock settings={s as ButtonLinkSettings} />;
    case "divider":
      return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":
      return <AccordionBlock title={block.title} settings={s as AccordionSettings} depth={1} blockId={block.id} />;
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
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">{title || "LIFF"}</h1>
      </header>

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
EOF

cat > src/components/liff/AccordionChildrenEditor.tsx <<'EOF'
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
EOF

cat > src/components/liff/block-settings-forms.tsx <<'EOF'
"use client";

// src/components/liff/block-settings-forms.tsx
// ブロックタイプごとの設定フォーム

import { useState } from "react";
import type {
  LiffBlockType,
  FreeTextSettings,
  StartButtonSettings,
  ResumeButtonSettings,
  ProgressSettings,
  EvidenceListSettings,
  HintListSettings,
  CharacterListSettings,
  ImageBlockSettings,
  VideoBlockSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
  NestedLiffBlock,
  LiffSectionVariant,
} from "@/types";
import { uploadApi, getDevToken } from "@/lib/api-client";

type FieldProps<T> = {
  settings: T;
  onChange: (s: T) => void;
  readOnly?: boolean;
};

const inputClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:bg-gray-50 disabled:text-gray-500";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const selectClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50";

export function FreeTextForm({ settings, onChange, readOnly }: FieldProps<FreeTextSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>本文</label>
        <textarea
          className={inputClass}
          rows={4}
          value={settings.body ?? ""}
          onChange={(e) => onChange({ ...settings, body: e.target.value })}
          disabled={readOnly}
          placeholder="自由テキストを入力..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>配置</label>
          <select
            className={selectClass}
            value={settings.align ?? "left"}
            onChange={(e) => onChange({ ...settings, align: e.target.value as "left" | "center" })}
            disabled={readOnly}
          >
            <option value="left">左揃え</option>
            <option value="center">中央揃え</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>強調</label>
          <select
            className={selectClass}
            value={settings.emphasis ?? "normal"}
            onChange={(e) => onChange({ ...settings, emphasis: e.target.value as "normal" | "strong" })}
            disabled={readOnly}
          >
            <option value="normal">通常</option>
            <option value="strong">強調</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function StartButtonForm({ settings, onChange, readOnly }: FieldProps<StartButtonSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ボタンラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="謎解きを始める"
        />
      </div>
      <div>
        <label className={labelClass}>確認メッセージ（任意）</label>
        <input
          className={inputClass}
          value={settings.confirm_message ?? ""}
          onChange={(e) => onChange({ ...settings, confirm_message: e.target.value })}
          disabled={readOnly}
          placeholder="本当に開始しますか？"
        />
      </div>
    </div>
  );
}

export function ResumeButtonForm({ settings, onChange, readOnly }: FieldProps<ResumeButtonSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ボタンラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="途中から再開する"
        />
      </div>
    </div>
  );
}

export function ProgressForm({ settings, onChange, readOnly }: FieldProps<ProgressSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示形式</label>
        <select
          className={selectClass}
          value={settings.display_format ?? "bar"}
          onChange={(e) => onChange({ ...settings, display_format: e.target.value as "bar" | "text" })}
          disabled={readOnly}
        >
          <option value="bar">プログレスバー</option>
          <option value="text">テキスト</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_denominator ?? true}
          onChange={(e) => onChange({ ...settings, show_denominator: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        分母を表示する
      </label>
    </div>
  );
}

export function EvidenceListForm({ settings, onChange, readOnly }: FieldProps<EvidenceListSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示上限件数</label>
        <input
          className={inputClass}
          type="number"
          min={1}
          max={100}
          value={settings.max_display_count ?? 10}
          onChange={(e) => onChange({ ...settings, max_display_count: Number(e.target.value) })}
          disabled={readOnly}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.hide_undiscovered ?? false}
          onChange={(e) => onChange({ ...settings, hide_undiscovered: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        未取得の証拠を非表示にする
      </label>
      <div>
        <label className={labelClass}>空状態の文言</label>
        <input
          className={inputClass}
          value={settings.empty_message ?? ""}
          onChange={(e) => onChange({ ...settings, empty_message: e.target.value })}
          disabled={readOnly}
          placeholder="まだ証拠はありません"
        />
      </div>
    </div>
  );
}

export function HintListForm({ settings, onChange, readOnly }: FieldProps<HintListSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示上限件数</label>
        <input
          className={inputClass}
          type="number"
          min={1}
          max={100}
          value={settings.max_display_count ?? 10}
          onChange={(e) => onChange({ ...settings, max_display_count: Number(e.target.value) })}
          disabled={readOnly}
        />
      </div>
      <div>
        <label className={labelClass}>空状態の文言</label>
        <input
          className={inputClass}
          value={settings.empty_message ?? ""}
          onChange={(e) => onChange({ ...settings, empty_message: e.target.value })}
          disabled={readOnly}
          placeholder="ヒントはまだありません"
        />
      </div>
    </div>
  );
}

export function CharacterListForm({ settings, onChange, readOnly }: FieldProps<CharacterListSettings>) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_icon ?? true}
          onChange={(e) => onChange({ ...settings, show_icon: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        アイコンを表示する
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_description ?? true}
          onChange={(e) => onChange({ ...settings, show_description: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        説明を表示する
      </label>
    </div>
  );
}

export function ImageBlockForm({ settings, onChange, readOnly }: FieldProps<ImageBlockSettings>) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { url } = await uploadApi.uploadImage(getDevToken(), file);
      onChange({ ...settings, image_url: url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>画像URL</label>
        <input
          className={inputClass}
          value={settings.image_url ?? ""}
          onChange={(e) => onChange({ ...settings, image_url: e.target.value })}
          disabled={readOnly || uploading}
          placeholder="https://..."
        />
        {!readOnly && (
          <div className="mt-2 flex items-center gap-2">
            <label className="inline-block px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-md text-xs text-violet-700 cursor-pointer hover:bg-violet-100">
              {uploading ? "アップロード中..." : "画像をアップロード"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploading}
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="hidden"
              />
            </label>
            {uploadError && <span className="text-xs text-red-600">{uploadError}</span>}
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>alt テキスト</label>
        <input
          className={inputClass}
          value={settings.alt ?? ""}
          onChange={(e) => onChange({ ...settings, alt: e.target.value })}
          disabled={readOnly}
        />
      </div>
      <div>
        <label className={labelClass}>キャプション</label>
        <input
          className={inputClass}
          value={settings.caption ?? ""}
          onChange={(e) => onChange({ ...settings, caption: e.target.value })}
          disabled={readOnly}
        />
      </div>
      <div>
        <label className={labelClass}>表示サイズ</label>
        <select
          className={selectClass}
          value={settings.size ?? "normal"}
          onChange={(e) => onChange({ ...settings, size: e.target.value as ImageBlockSettings["size"] })}
          disabled={readOnly}
        >
          <option value="normal">通常</option>
          <option value="wide">広め</option>
          <option value="full">画面いっぱい</option>
        </select>
      </div>
    </div>
  );
}

export function VideoBlockForm({ settings, onChange, readOnly }: FieldProps<VideoBlockSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>動画URL</label>
        <input
          className={inputClass}
          value={settings.video_url ?? ""}
          onChange={(e) => onChange({ ...settings, video_url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className={labelClass}>ポスター画像URL</label>
        <input
          className={inputClass}
          value={settings.poster_url ?? ""}
          onChange={(e) => onChange({ ...settings, poster_url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className={labelClass}>キャプション</label>
        <input
          className={inputClass}
          value={settings.caption ?? ""}
          onChange={(e) => onChange({ ...settings, caption: e.target.value })}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

export function HeadingForm({ settings, onChange, readOnly }: FieldProps<HeadingSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>見出しテキスト</label>
        <input
          className={inputClass}
          value={settings.text ?? ""}
          onChange={(e) => onChange({ ...settings, text: e.target.value })}
          disabled={readOnly}
          placeholder="HINTを見る前に"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>レベル</label>
          <select
            className={selectClass}
            value={String(settings.level ?? 2)}
            onChange={(e) => onChange({ ...settings, level: Number(e.target.value) as 1 | 2 | 3 })}
            disabled={readOnly}
          >
            <option value="1">H1（最大）</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>配置</label>
          <select
            className={selectClass}
            value={settings.align ?? "left"}
            onChange={(e) => onChange({ ...settings, align: e.target.value as "left" | "center" })}
            disabled={readOnly}
          >
            <option value="left">左揃え</option>
            <option value="center">中央揃え</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function TextForm({ settings, onChange, readOnly }: FieldProps<TextSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>本文</label>
        <textarea
          className={inputClass}
          rows={4}
          value={settings.body ?? ""}
          onChange={(e) => onChange({ ...settings, body: e.target.value })}
          disabled={readOnly}
          placeholder="本文を入力..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>配置</label>
          <select
            className={selectClass}
            value={settings.align ?? "left"}
            onChange={(e) => onChange({ ...settings, align: e.target.value as "left" | "center" })}
            disabled={readOnly}
          >
            <option value="left">左揃え</option>
            <option value="center">中央揃え</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>強調</label>
          <select
            className={selectClass}
            value={settings.emphasis ?? "normal"}
            onChange={(e) => onChange({ ...settings, emphasis: e.target.value as "normal" | "strong" })}
            disabled={readOnly}
          >
            <option value="normal">通常</option>
            <option value="strong">強調</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function WarningForm({ settings, onChange, readOnly }: FieldProps<WarningSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>注意文</label>
        <textarea
          className={inputClass}
          rows={3}
          value={settings.body ?? ""}
          onChange={(e) => onChange({ ...settings, body: e.target.value })}
          disabled={readOnly}
          placeholder="ネタバレ注意：このサイトではヒントが見られます。"
        />
      </div>
      <div>
        <label className={labelClass}>トーン</label>
        <select
          className={selectClass}
          value={settings.tone ?? "spoiler"}
          onChange={(e) => onChange({ ...settings, tone: e.target.value as WarningSettings["tone"] })}
          disabled={readOnly}
        >
          <option value="spoiler">スポイラー（黄）</option>
          <option value="info">情報（青）</option>
          <option value="danger">危険（赤）</option>
        </select>
      </div>
    </div>
  );
}

export function ButtonLinkForm({ settings, onChange, readOnly }: FieldProps<ButtonLinkSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="チケットを購入する"
        />
      </div>
      <div>
        <label className={labelClass}>URL</label>
        <input
          className={inputClass}
          value={settings.url ?? ""}
          onChange={(e) => onChange({ ...settings, url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>variant</label>
          <select
            className={selectClass}
            value={settings.variant ?? "default"}
            onChange={(e) => onChange({ ...settings, variant: e.target.value as LiffSectionVariant })}
            disabled={readOnly}
          >
            <option value="default">default</option>
            <option value="dark">dark</option>
            <option value="purple">purple</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
          <input
            type="checkbox"
            checked={settings.open_external ?? true}
            onChange={(e) => onChange({ ...settings, open_external: e.target.checked })}
            disabled={readOnly}
            className="rounded border-gray-300"
          />
          外部ブラウザで開く
        </label>
      </div>
    </div>
  );
}

export function DividerForm({ settings, onChange, readOnly }: FieldProps<DividerSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>スタイル</label>
        <select
          className={selectClass}
          value={settings.style ?? "solid"}
          onChange={(e) => onChange({ ...settings, style: e.target.value as "solid" | "dashed" })}
          disabled={readOnly}
        >
          <option value="solid">実線</option>
          <option value="dashed">点線</option>
        </select>
      </div>
    </div>
  );
}

import { AccordionChildrenEditor } from "./AccordionChildrenEditor";

export function AccordionForm({ settings, onChange, readOnly }: FieldProps<AccordionSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>タイトル（必須）</label>
        <input
          className={inputClass}
          value={settings.title ?? ""}
          onChange={(e) => onChange({ ...settings, title: e.target.value })}
          disabled={readOnly}
          placeholder="1st STAGE.（無料エリア）"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>variant</label>
          <select
            className={selectClass}
            value={settings.variant ?? "default"}
            onChange={(e) => onChange({ ...settings, variant: e.target.value as LiffSectionVariant })}
            disabled={readOnly}
          >
            <option value="default">default（白）</option>
            <option value="dark">dark（黒）</option>
            <option value="purple">purple（紫）</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
          <input
            type="checkbox"
            checked={settings.default_open ?? false}
            onChange={(e) => onChange({ ...settings, default_open: e.target.checked })}
            disabled={readOnly}
            className="rounded border-gray-300"
          />
          初期状態で開く
        </label>
      </div>

      <div>
        <label className={labelClass}>子要素</label>
        <AccordionChildrenEditor
          items={settings.children ?? []}
          depth={1}
          readOnly={readOnly}
          onChange={(next) => onChange({ ...settings, children: next })}
        />
      </div>
    </div>
  );
}

import { getBlockEntry } from "./block-type-registry";

export function BlockSettingsForm({
  blockType,
  settings,
  onChange,
  readOnly,
}: {
  blockType: LiffBlockType;
  settings: Record<string, unknown>;
  onChange: (s: Record<string, unknown>) => void;
  readOnly?: boolean;
}) {
  const entry = getBlockEntry(blockType);
  if (!entry) return <p className="text-sm text-gray-400">不明なブロックタイプです</p>;

  const { SettingsForm } = entry;
  return <SettingsForm settings={settings} onChange={onChange} readOnly={readOnly} />;
}
EOF

cat > src/components/liff/block-type-registry.tsx <<'EOF'
"use client";

// src/components/liff/block-type-registry.tsx
// ブロックタイプの統一レジストリ

import type { ComponentType } from "react";
import type {
  LiffBlockType,
  VisibilityCondition,
  FreeTextSettings,
  StartButtonSettings,
  ResumeButtonSettings,
  ProgressSettings,
  EvidenceListSettings,
  HintListSettings,
  CharacterListSettings,
  ImageBlockSettings,
  VideoBlockSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
} from "@/types";

import {
  FreeTextForm,
  StartButtonForm,
  ResumeButtonForm,
  ProgressForm,
  EvidenceListForm,
  HintListForm,
  CharacterListForm,
  ImageBlockForm,
  VideoBlockForm,
  HeadingForm,
  TextForm,
  WarningForm,
  ButtonLinkForm,
  DividerForm,
  AccordionForm,
} from "./block-settings-forms";

export type SettingsFormProps<T = Record<string, unknown>> = {
  settings: T;
  onChange: (s: T) => void;
  readOnly?: boolean;
};

export interface BlockTypeEntry {
  label: string;
  icon: string;
  description: string;
  defaultSettings: Record<string, unknown>;
  SettingsForm: ComponentType<SettingsFormProps<any>>;
}

export const BLOCK_TYPE_REGISTRY: Record<LiffBlockType, BlockTypeEntry> = {
  free_text: {
    label:           "フリーテキスト",
    icon:            "📝",
    description:     "自由なテキストを表示",
    defaultSettings: { body: "", align: "left", emphasis: "normal" } satisfies FreeTextSettings,
    SettingsForm:    FreeTextForm as ComponentType<SettingsFormProps<any>>,
  },
  start_button: {
    label:           "開始ボタン",
    icon:            "▶️",
    description:     "謎解き開始ボタン",
    defaultSettings: { label: "謎解きを始める", confirm_message: "" } satisfies StartButtonSettings,
    SettingsForm:    StartButtonForm as ComponentType<SettingsFormProps<any>>,
  },
  resume_button: {
    label:           "再開ボタン",
    icon:            "⏩",
    description:     "途中から再開するボタン",
    defaultSettings: { label: "途中から再開する" } satisfies ResumeButtonSettings,
    SettingsForm:    ResumeButtonForm as ComponentType<SettingsFormProps<any>>,
  },
  progress: {
    label:           "進捗表示",
    icon:            "📊",
    description:     "クリア進捗を表示",
    defaultSettings: { display_format: "bar", show_denominator: true } satisfies ProgressSettings,
    SettingsForm:    ProgressForm as ComponentType<SettingsFormProps<any>>,
  },
  evidence_list: {
    label:           "証拠リスト",
    icon:            "🔍",
    description:     "取得した証拠の一覧",
    defaultSettings: { max_display_count: 10, hide_undiscovered: false, empty_message: "" } satisfies EvidenceListSettings,
    SettingsForm:    EvidenceListForm as ComponentType<SettingsFormProps<any>>,
  },
  hint_list: {
    label:           "ヒントリスト",
    icon:            "💡",
    description:     "使用可能なヒント一覧",
    defaultSettings: { max_display_count: 10, empty_message: "" } satisfies HintListSettings,
    SettingsForm:    HintListForm as ComponentType<SettingsFormProps<any>>,
  },
  character_list: {
    label:           "キャラクター一覧",
    icon:            "👥",
    description:     "登場キャラクターの一覧",
    defaultSettings: { show_icon: true, show_description: true } satisfies CharacterListSettings,
    SettingsForm:    CharacterListForm as ComponentType<SettingsFormProps<any>>,
  },
  image: {
    label:           "画像",
    icon:            "🖼️",
    description:     "画像を表示",
    defaultSettings: { image_url: "", alt: "", caption: "", size: "normal" } satisfies ImageBlockSettings,
    SettingsForm:    ImageBlockForm as ComponentType<SettingsFormProps<any>>,
  },
  video: {
    label:           "動画",
    icon:            "🎬",
    description:     "動画を表示",
    defaultSettings: { video_url: "", poster_url: "", caption: "" } satisfies VideoBlockSettings,
    SettingsForm:    VideoBlockForm as ComponentType<SettingsFormProps<any>>,
  },
  heading: {
    label:           "見出し",
    icon:            "🅷",
    description:     "セクションの見出しを表示",
    defaultSettings: { text: "", level: 2, align: "left" } satisfies HeadingSettings,
    SettingsForm:    HeadingForm as ComponentType<SettingsFormProps<any>>,
  },
  text: {
    label:           "テキスト",
    icon:            "📄",
    description:     "本文テキストを表示",
    defaultSettings: { body: "", align: "left", emphasis: "normal" } satisfies TextSettings,
    SettingsForm:    TextForm as ComponentType<SettingsFormProps<any>>,
  },
  warning: {
    label:           "注意帯",
    icon:            "⚠️",
    description:     "ネタバレ注意などの強調テキスト",
    defaultSettings: { body: "ネタバレ注意：このサイトではヒントが見られます。", tone: "spoiler" } satisfies WarningSettings,
    SettingsForm:    WarningForm as ComponentType<SettingsFormProps<any>>,
  },
  button_link: {
    label:           "ボタンリンク",
    icon:            "🔘",
    description:     "リンクボタンを表示",
    defaultSettings: { label: "", url: "", open_external: true, variant: "default" } satisfies ButtonLinkSettings,
    SettingsForm:    ButtonLinkForm as ComponentType<SettingsFormProps<any>>,
  },
  divider: {
    label:           "区切り線",
    icon:            "—",
    description:     "セクション区切りの線",
    defaultSettings: { style: "solid" } satisfies DividerSettings,
    SettingsForm:    DividerForm as ComponentType<SettingsFormProps<any>>,
  },
  accordion: {
    label:           "アコーディオン",
    icon:            "▾",
    description:     "STAGE 用の開閉セクション（子要素を持てる）",
    defaultSettings: { title: "", default_open: false, variant: "default", children: [] } satisfies AccordionSettings,
    SettingsForm:    AccordionForm as ComponentType<SettingsFormProps<any>>,
  },
};

export const ALL_BLOCK_TYPES = Object.keys(BLOCK_TYPE_REGISTRY) as LiffBlockType[];

export function getBlockEntry(blockType: string): BlockTypeEntry | undefined {
  return BLOCK_TYPE_REGISTRY[blockType as LiffBlockType];
}

export const VISIBILITY_CONDITION_LABELS: Record<VisibilityCondition, string> = {
  always:       "常に表示",
  before_start: "開始前のみ",
  in_progress:  "プレイ中のみ",
  completed:    "クリア後のみ",
};
EOF

cat > src/components/liff/LiffConfigHeader.tsx <<'EOF'
"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + page_type 切替 + ヒントサイト用ヘッダー設定

import type { LiffPageConfig, LiffPageConfigSettings, LiffPageType, LiffPublishStatus } from "@/types";

interface Props {
  config: LiffPageConfig;
  saving: boolean;
  readOnly: boolean;
  canPublish?: boolean;
  onToggleEnabled: () => void;
  onUpdateField: (field: "title" | "description", value: string | null) => void;
  onLocalChange: (patch: Partial<LiffPageConfig>) => void;
  onUpdateSettingsField: (key: keyof LiffPageConfigSettings, value: unknown) => void;
  onUpdatePageType: (next: LiffPageType) => void;
  onUpdatePublishStatus: (next: LiffPublishStatus) => void;
}

export function LiffConfigHeader({
  config, saving, readOnly, canPublish,
  onToggleEnabled, onUpdateField, onLocalChange,
  onUpdateSettingsField, onUpdatePageType, onUpdatePublishStatus,
}: Props) {
  const settings: LiffPageConfigSettings = config.settings_json ?? {};
  const isHintSite = config.page_type === "hint_site";

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">LIFF表示設定</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={config.publish_status}
            onChange={(e) => onUpdatePublishStatus(e.target.value as LiffPublishStatus)}
            disabled={saving || readOnly || !canPublish}
            title={!canPublish ? "公開操作は admin 以上の権限が必要です" : undefined}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white disabled:bg-gray-50"
          >
            <option value="draft">下書き</option>
            <option value="published">公開中</option>
            <option value="archived">アーカイブ</option>
          </select>

          <span className="text-sm text-gray-500">
            {config.is_enabled ? "有効" : "無効"}
          </span>
          <button
            onClick={onToggleEnabled}
            disabled={saving || readOnly}
            className="relative w-12 h-[26px] rounded-full border-none cursor-pointer transition-colors"
            style={{ background: config.is_enabled ? "#06C755" : "#d1d5db" }}
          >
            <div
              className="absolute top-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]"
              style={{ left: config.is_enabled ? 24 : 2 }}
            />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <label className={labelCls + " mb-0"}>ページ種別</label>
          <select
            value={config.page_type}
            onChange={(e) => onUpdatePageType(e.target.value as LiffPageType)}
            disabled={readOnly}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="default">既存LIFF（プレイヤー向け）</option>
            <option value="hint_site">ヒントサイト</option>
          </select>
          <span className="text-[11px] text-gray-400">
            ※「default」はGPS/QRや進捗表示などの従来機能、「hint_site」はSTAGE型ヒントページ
          </span>
        </div>

        <div className="mb-3">
          <label className={labelCls}>LIFFページタイトル</label>
          <input
            className={inputCls}
            value={config.title ?? ""}
            onChange={(e) => onLocalChange({ title: e.target.value || null })}
            onBlur={(e) => onUpdateField("title", e.target.value)}
            disabled={readOnly}
            placeholder={isHintSite ? "例: 都市奇譚ヒントサイト" : "例: 謎解き探偵ゲーム"}
          />
        </div>
        <div>
          <label className={labelCls}>説明</label>
          <input
            className={inputCls}
            value={config.description ?? ""}
            onChange={(e) => onLocalChange({ description: e.target.value || null })}
            onBlur={(e) => onUpdateField("description", e.target.value)}
            disabled={readOnly}
            placeholder="任意の説明文"
          />
        </div>
      </div>

      {isHintSite && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">ヒントサイト ヘッダー設定</h2>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.header_fixed !== false}
              onChange={(e) => onUpdateSettingsField("header_fixed", e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            ヘッダーを固定する
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ロゴ画像URL</label>
              <input
                className={inputCls}
                value={settings.header_logo_url ?? ""}
                onChange={(e) => onUpdateSettingsField("header_logo_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className={labelCls}>ロゴ alt テキスト</label>
              <input
                className={inputCls}
                value={settings.header_logo_alt ?? ""}
                onChange={(e) => onUpdateSettingsField("header_logo_alt", e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CTA ラベル</label>
              <input
                className={inputCls}
                value={settings.header_cta_label ?? ""}
                onChange={(e) => onUpdateSettingsField("header_cta_label", e.target.value)}
                disabled={readOnly}
                placeholder="チケットを購入する"
              />
            </div>
            <div>
              <label className={labelCls}>CTA URL</label>
              <input
                className={inputCls}
                value={settings.header_cta_url ?? ""}
                onChange={(e) => onUpdateSettingsField("header_cta_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.show_hamburger ?? false}
              onChange={(e) => onUpdateSettingsField("show_hamburger", e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            ハンバーガーメニュー枠を表示する（中身は将来拡張）
          </label>

          <div>
            <label className={labelCls}>ネタバレ注意帯テキスト</label>
            <input
              className={inputCls}
              value={settings.spoiler_warning_text ?? ""}
              onChange={(e) => onUpdateSettingsField("spoiler_warning_text", e.target.value)}
              disabled={readOnly}
              placeholder="ネタバレ注意：ここから先はヒントサイトです"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ヘッダー背景色（CSS color）</label>
              <input
                className={inputCls}
                value={settings.theme?.header_bg ?? ""}
                onChange={(e) => onUpdateSettingsField("theme", { ...(settings.theme ?? {}), header_bg: e.target.value })}
                disabled={readOnly}
                placeholder="#000000"
              />
            </div>
            <div>
              <label className={labelCls}>ヘッダー文字色</label>
              <input
                className={inputCls}
                value={settings.theme?.header_fg ?? ""}
                onChange={(e) => onUpdateSettingsField("theme", { ...(settings.theme ?? {}), header_fg: e.target.value })}
                disabled={readOnly}
                placeholder="#ffffff"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
EOF

cat > src/components/liff/LiffPreview.tsx <<'EOF'
"use client";

// src/components/liff/LiffPreview.tsx
// 管理画面用スマホ幅プレビュー — Tailwind ベース

import type { LiffPageBlock, LiffBlockType, LiffPageConfig } from "@/types";
import type {
  FreeTextSettings,
  StartButtonSettings,
  ResumeButtonSettings,
  ProgressSettings,
  EvidenceListSettings,
  HintListSettings,
  CharacterListSettings,
  ImageBlockSettings,
  VideoBlockSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
} from "@/types";
import { HintSiteRenderer } from "./HintSiteRenderer";
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
} from "./renderers";

function PreviewFreeText({ title, settings }: { title?: string | null; settings: FreeTextSettings }) {
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && <h3 className="text-sm font-semibold mb-1">{title}</h3>}
      <p className={`text-[13px] text-gray-700 whitespace-pre-wrap ${settings.emphasis === "strong" ? "font-bold text-gray-900" : ""}`}>
        {settings.body || "（テキスト未設定）"}
      </p>
    </div>
  );
}

function PreviewStartButton({ settings }: { settings: StartButtonSettings }) {
  return (
    <div className="w-full py-3 px-4 bg-[#06C755] text-white rounded-lg font-semibold text-sm text-center">
      {settings.label || "謎解きを始める"}
    </div>
  );
}

function PreviewResumeButton({ settings }: { settings: ResumeButtonSettings }) {
  return (
    <div className="w-full py-3 px-4 bg-blue-500 text-white rounded-lg font-semibold text-sm text-center">
      {settings.label || "途中から再開する"}
    </div>
  );
}

function PreviewProgress({ title, settings }: { title?: string | null; settings: ProgressSettings }) {
  const pct = 60;
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      {settings.display_format === "text" ? (
        <p className="text-[13px] text-gray-700">3 / 5 フェーズ完了</p>
      ) : (
        <div>
          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
            <div className="bg-[#06C755] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-gray-500 mt-1 text-right">
            {settings.show_denominator !== false ? "3 / 5" : `${pct}%`}
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewEvidenceList({ title, settings }: { title?: string | null; settings: EvidenceListSettings }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="bg-gray-50 rounded-lg p-3 text-center">
        <p className="text-xs text-gray-400">{settings.empty_message || "まだ証拠はありません"}</p>
      </div>
    </div>
  );
}

function PreviewHintList({ title, settings }: { title?: string | null; settings: HintListSettings }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="bg-amber-50 rounded-lg p-3 text-center">
        <p className="text-xs text-amber-700">{settings.empty_message || "ヒントはまだありません"}</p>
      </div>
    </div>
  );
}

function PreviewCharacterList({ title }: { title?: string | null }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="flex gap-3">
        {["A", "B", "C"].map((c) => (
          <div key={c} className="flex flex-col items-center gap-1">
            <div className="w-10 h-10 rounded-full bg-violet-200 flex items-center justify-center text-base font-semibold text-violet-600">
              {c}
            </div>
            <span className="text-[11px] text-gray-500">キャラ{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewImage({ settings }: { settings: ImageBlockSettings }) {
  return (
    <div>
      {settings.image_url ? (
        <img src={settings.image_url} alt={settings.alt || ""} className="w-full rounded-lg object-cover max-h-[200px]" />
      ) : (
        <div className="w-full h-[120px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs">
          画像未設定
        </div>
      )}
      {settings.caption && <p className="text-[11px] text-gray-500 mt-1 text-center">{settings.caption}</p>}
    </div>
  );
}

function PreviewVideo({ settings }: { settings: VideoBlockSettings }) {
  return (
    <div>
      <div className="w-full h-[160px] bg-gray-800 rounded-lg flex items-center justify-center text-white text-2xl">
        ▶
      </div>
      {settings.caption && <p className="text-[11px] text-gray-500 mt-1 text-center">{settings.caption}</p>}
    </div>
  );
}

function BlockPreviewContent({ block }: { block: LiffPageBlock }) {
  const s = block.settings_json as Record<string, unknown>;
  const t = block.block_type as LiffBlockType;
  switch (t) {
    case "free_text":      return <PreviewFreeText title={block.title} settings={s as FreeTextSettings} />;
    case "start_button":   return <PreviewStartButton settings={s as StartButtonSettings} />;
    case "resume_button":  return <PreviewResumeButton settings={s as ResumeButtonSettings} />;
    case "progress":       return <PreviewProgress title={block.title} settings={s as ProgressSettings} />;
    case "evidence_list":  return <PreviewEvidenceList title={block.title} settings={s as EvidenceListSettings} />;
    case "hint_list":      return <PreviewHintList title={block.title} settings={s as HintListSettings} />;
    case "character_list": return <PreviewCharacterList title={block.title} />;
    case "image":          return <PreviewImage settings={s as ImageBlockSettings} />;
    case "video":          return <PreviewVideo settings={s as VideoBlockSettings} />;
    case "heading":        return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":           return <TextBlock title={block.title} settings={s as TextSettings} />;
    case "warning":        return <WarningBlock settings={s as WarningSettings} />;
    case "button_link":    return <ButtonLinkBlock settings={s as ButtonLinkSettings} />;
    case "divider":        return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":      return <AccordionBlock title={block.title} settings={s as AccordionSettings} depth={1} blockId={block.id} />;
    default:               return <p className="text-xs text-gray-400">不明なブロック</p>;
  }
}

export function LiffPreview({
  blocks,
  title,
  config,
}: {
  blocks: LiffPageBlock[];
  title?: string | null;
  config?: Pick<LiffPageConfig, "page_type" | "settings_json" | "description"> | null;
}) {
  const enabledBlocks = blocks.filter((b) => b.is_enabled);

  if (config?.page_type === "hint_site") {
    return (
      <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
        <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
          LIFF ヒントサイトプレビュー
        </div>
        <div className="overflow-auto" style={{ maxHeight: 720 }}>
          <HintSiteRenderer
            preview
            config={{
              work_id:       "preview",
              title:         title ?? null,
              description:   config?.description ?? null,
              settings_json: config?.settings_json ?? {},
              blocks:        enabledBlocks.map((b) => ({
                id:            b.id,
                block_type:    b.block_type,
                title:         b.title,
                settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
              })),
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
        LIFF プレビュー
      </div>

      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900">
          {title || "LIFF ページ"}
        </h2>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {enabledBlocks.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">
            ブロックが追加されていません
          </p>
        ) : (
          enabledBlocks.map((block) => (
            <div key={block.id}>
              <BlockPreviewContent block={block} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
EOF

cat > "src/app/oas/[id]/works/[workId]/liff/page.tsx" <<'EOF'
"use client";

// src/app/oas/[id]/works/[workId]/liff/page.tsx
// LIFF表示設定ページ — ブロック追加・編集・削除・並び替え + プレビュー

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useLiffConfig } from "@/hooks/useLiffConfig";
import { ViewerBanner } from "@/components/PermissionGuard";
import { LiffConfigHeader } from "@/components/liff/LiffConfigHeader";
import { LiffBlockItem } from "@/components/liff/LiffBlockItem";
import { LiffAddBlockModal } from "@/components/liff/LiffAddBlockModal";
import { LiffPreview } from "@/components/liff/LiffPreview";

export default function LiffConfigPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading, isAdmin } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";
  const canPublish = isAdmin;

  const liff = useLiffConfig(workId, {
    onSuccess: (msg) => showToast(msg, "success"),
    onError: (msg) => showToast(msg, "error"),
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx || !liff.config) return;
    const newBlocks = [...liff.config.blocks];
    const [moved] = newBlocks.splice(dragIdx, 1);
    newBlocks.splice(idx, 0, moved);
    liff.updateConfigLocal({
      blocks: newBlocks.map((b, i) => ({ ...b, sort_order: i })),
    });
    setDragIdx(idx);
  }, [dragIdx, liff]);

  const handleDragEnd = useCallback(async () => {
    setDragIdx(null);
    if (!liff.config || isReadOnly) return;
    await liff.reorderBlocks(liff.config.blocks);
  }, [liff, isReadOnly]);

  if (liff.loading || roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  const { config } = liff;
  if (!config) return null;

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: liff.workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF表示設定" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      <LiffConfigHeader
        config={config}
        saving={liff.saving}
        readOnly={isReadOnly}
        canPublish={canPublish}
        onToggleEnabled={liff.toggleEnabled}
        onUpdateField={liff.updateConfigField}
        onLocalChange={(patch) => liff.updateConfigLocal(patch)}
        onUpdateSettingsField={liff.updateSettingsField}
        onUpdatePageType={liff.updatePageType}
        onUpdatePublishStatus={liff.updatePublishStatus}
      />

      <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
        <span>プレビュー:</span>
        <a
          href={`/liff/work/${workId}?preview=1`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-600 underline"
        >
          下書きを含むプレビューを開く
        </a>
        <span>/</span>
        <a
          href={`/liff/work/${workId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-600 underline"
        >
          公開ページを開く
        </a>
      </div>

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">表示ブロック</h2>
            {!isReadOnly && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-1.5 bg-violet-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-violet-600 transition-colors"
              >
                + ブロック追加
              </button>
            )}
          </div>

          {config.blocks.length === 0 && (
            <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
              <p className="text-sm text-gray-500 mb-2">
                ブロックがまだ追加されていません
              </p>
              <p className="text-xs text-gray-400">
                「ブロック追加」ボタンから表示したい項目を選んでください
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {config.blocks.map((block, idx) => (
              <LiffBlockItem
                key={block.id}
                block={block}
                index={idx}
                totalBlocks={config.blocks.length}
                isEditing={liff.editingBlockId === block.id}
                readOnly={isReadOnly}
                saving={liff.saving}
                onEdit={() => liff.setEditingBlockId(block.id)}
                onCloseEdit={() => { liff.setEditingBlockId(null); liff.reload(); }}
                onSave={liff.updateBlock}
                onToggleEnabled={() => liff.toggleBlockEnabled(block)}
                onDelete={() => liff.deleteBlock(block.id)}
                onMove={(dir) => liff.moveBlock(idx, dir)}
                onLocalChange={(patch) => liff.updateBlockLocal(block.id, patch)}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        </div>

        <div className="sticky top-6 shrink-0">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">プレビュー</h2>
          <LiffPreview blocks={config.blocks} title={config.title} config={config} />
        </div>
      </div>

      {showAddModal && (
        <LiffAddBlockModal
          saving={liff.saving}
          onAdd={async (type) => {
            await liff.addBlock(type);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
EOF

# ============================================================
# Prisma client 再生成 / build / git status
# ============================================================
echo
echo "============================================================"
echo "Prisma client を再生成します"
echo "============================================================"
npx prisma generate

echo
echo "============================================================"
echo "Next.js build を実行します"
echo "============================================================"
npm run build

echo
echo "============================================================"
echo "git status (適用前の状態確認)"
echo "============================================================"
git status

# ============================================================
# git add（変更対象のファイルだけを明示的に追加。他の untracked
# は巻き込まない。コミット・push は手動で行うこと）
# ============================================================
git add \
  prisma/schema.prisma \
  prisma/migrations/20260506000000_liff_hint_site/migration.sql \
  src/app/api/liff/works/\[workId\]/route.ts \
  src/app/api/works/\[workId\]/liff-config/route.ts \
  src/app/liff/work/\[workId\]/page.tsx \
  src/app/oas/\[id\]/works/\[workId\]/liff/page.tsx \
  src/components/liff/AccordionChildrenEditor.tsx \
  src/components/liff/HintSiteRenderer.tsx \
  src/components/liff/LiffConfigHeader.tsx \
  src/components/liff/LiffPreview.tsx \
  src/components/liff/LiffRenderer.tsx \
  src/components/liff/block-settings-forms.tsx \
  src/components/liff/block-type-registry.tsx \
  src/components/liff/renderers/AccordionBlock.tsx \
  src/components/liff/renderers/ButtonLinkBlock.tsx \
  src/components/liff/renderers/DividerBlock.tsx \
  src/components/liff/renderers/HeadingBlock.tsx \
  src/components/liff/renderers/ImageBlock.tsx \
  src/components/liff/renderers/TextBlock.tsx \
  src/components/liff/renderers/WarningBlock.tsx \
  src/components/liff/renderers/index.ts \
  src/hooks/useLiffConfig.ts \
  src/lib/liff-analytics.ts \
  src/lib/liff-utils.ts \
  src/lib/validations/index.ts \
  src/types/index.ts

echo
echo "============================================================"
echo "適用完了。次のコマンドで commit & push してください："
echo
echo "  git commit -m 'feat: extend LIFF config to support hint-site UI with nested accordions'"
echo "  git push -u origin claude/liff-hint-site-ui-ERcS0"
echo "============================================================"
git status