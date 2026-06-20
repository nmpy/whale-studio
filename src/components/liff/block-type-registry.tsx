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
  CodeReaderSettings,
  RiddleListSettings,
  CheckinHistorySettings,
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
  CodeReaderForm,
  RiddleListForm,
  CheckinHistoryForm,
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
    description:     "14px",
    defaultSettings: { body: "", align: "left", emphasis: "normal" } satisfies FreeTextSettings,
    SettingsForm:    FreeTextForm as ComponentType<SettingsFormProps<any>>,
  },
  start_button: {
    label:           "開始ボタン",
    icon:            "▶️",
    description:     "作品開始ボタン",
    defaultSettings: { label: "作品を始める", confirm_message: "" } satisfies StartButtonSettings,
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
    description:     "バー・ステップ",
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
    label:           "キャラクター",
    icon:            "👥",
    description:     "3列グリッド",
    defaultSettings: { show_icon: true, show_description: true } satisfies CharacterListSettings,
    SettingsForm:    CharacterListForm as ComponentType<SettingsFormProps<any>>,
  },
  image: {
    label:           "画像",
    icon:            "🖼️",
    description:     "比率選択可",
    defaultSettings: { image_url: "", alt: "", caption: "", size: "normal" } satisfies ImageBlockSettings,
    SettingsForm:    ImageBlockForm as ComponentType<SettingsFormProps<any>>,
  },
  video: {
    label:           "動画",
    icon:            "🎬",
    description:     "動画表示",
    defaultSettings: { video_url: "", poster_url: "", caption: "" } satisfies VideoBlockSettings,
    SettingsForm:    VideoBlockForm as ComponentType<SettingsFormProps<any>>,
  },
  heading: {
    label:           "見出し",
    icon:            "🅷",
    description:     "H1〜H3",
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
    label:           "バナー",
    icon:            "⚠️",
    description:     "警告・情報・注意",
    defaultSettings: { body: "ネタバレ注意：このサイトではヒントが見られます。", tone: "spoiler", icon: "auto" } satisfies WarningSettings,
    SettingsForm:    WarningForm as ComponentType<SettingsFormProps<any>>,
  },
  button_link: {
    label:           "ボタン",
    icon:            "🔘",
    description:     "Filled・Outline",
    defaultSettings: { label: "", url: "", open_external: true, variant: "default", link_type: "external" } satisfies ButtonLinkSettings,
    SettingsForm:    ButtonLinkForm as ComponentType<SettingsFormProps<any>>,
  },
  divider: {
    label:           "区切り線",
    icon:            "—",
    description:     "3パターン",
    defaultSettings: { style: "solid" } satisfies DividerSettings,
    SettingsForm:    DividerForm as ComponentType<SettingsFormProps<any>>,
  },
  accordion: {
    label:           "アコーディオン",
    icon:            "▾",
    description:     "汎用折りたたみ",
    defaultSettings: { title: "", default_open: false, variant: "default", children: [] } satisfies AccordionSettings,
    SettingsForm:    AccordionForm as ComponentType<SettingsFormProps<any>>,
  },
  code_reader: {
    label:           "コードリーダー",
    icon:            "📷",
    description:     "bottom sheet",
    defaultSettings: { label: "チェックインする", modal_title: "コードリーダー", description: "", after_scan: "location_checkin" } satisfies CodeReaderSettings,
    SettingsForm:    CodeReaderForm as ComponentType<SettingsFormProps<any>>,
  },
  riddle_list: {
    label:           "謎・問題",
    icon:            "",
    description:     "テキスト・画像型",
    defaultSettings: { title: "謎・問題", show_status: true } satisfies RiddleListSettings,
    SettingsForm:    RiddleListForm as ComponentType<SettingsFormProps<any>>,
  },
  checkin_history: {
    label:           "チェックイン履歴",
    icon:            "📍",
    description:     "マップ・地名",
    defaultSettings: { title: "チェックイン履歴" } satisfies CheckinHistorySettings,
    SettingsForm:    CheckinHistoryForm as ComponentType<SettingsFormProps<any>>,
  },
};

export const ALL_BLOCK_TYPES = Object.keys(BLOCK_TYPE_REGISTRY) as LiffBlockType[];

/** ブロック追加メニューに出す 13 種類を「明示的な順序付き allow-list」で定義（01〜13）[PR-BLK1]。
 *  type 文字列は不変（保存データ互換）。CMS 表示ラベル/補足のみ統一済み。
 *  ここに無い type（text / hint_list / start_button / resume_button / evidence_list）は
 *  追加 UI に出さないが、registry / renderer / validation には残置＝既存データは表示・編集できる。 */
export const ADDABLE_BLOCK_TYPES: LiffBlockType[] = [
  "heading",         // 01 見出し
  "free_text",       // 02 フリーテキスト
  "divider",         // 03 区切り線
  "accordion",       // 04 アコーディオン
  "warning",         // 05 バナー
  "image",           // 06 画像
  "video",           // 07 動画
  "button_link",     // 08 ボタン
  "character_list",  // 09 キャラクター
  "riddle_list",     // 10 謎・問題
  "progress",        // 11 進捗表示
  "checkin_history", // 12 チェックイン履歴
  "code_reader",     // 13 コードリーダー
];

/** 追加 UI に出さない legacy / ゲーム・システム用ブロック（type/renderer/validation は残置＝非破壊）。
 *  - text       : free_text と重複のため legacy 化（既存ブロックの描画・編集は維持）
 *  - hint_list  : ゲーム用（ヒント一覧）
 *  - start_button / resume_button / evidence_list : ゲーム・進行用
 *  ※ ADDABLE と合わせて全 18 type を網羅する（取りこぼし検知用の参考定義）。 */
export const NON_ADDABLE_BLOCK_TYPES: LiffBlockType[] = [
  "text", "hint_list", "start_button", "resume_button", "evidence_list",
];

export function getBlockEntry(blockType: string): BlockTypeEntry | undefined {
  return BLOCK_TYPE_REGISTRY[blockType as LiffBlockType];
}

export const VISIBILITY_CONDITION_LABELS: Record<VisibilityCondition, string> = {
  always:       "常に表示",
  before_start: "開始前のみ",
  in_progress:  "プレイ中のみ",
  completed:    "クリア後のみ",
};
