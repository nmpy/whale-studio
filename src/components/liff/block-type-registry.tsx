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
    description:     "自由なテキストを表示",
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
    defaultSettings: { label: "", url: "", open_external: true, variant: "default", link_type: "external" } satisfies ButtonLinkSettings,
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
  code_reader: {
    label:           "コードリーダー",
    icon:            "📷",
    description:     "QRコードを読み取ってチェックイン",
    defaultSettings: { label: "チェックインする", modal_title: "コードリーダー", description: "", after_scan: "location_checkin" } satisfies CodeReaderSettings,
    SettingsForm:    CodeReaderForm as ComponentType<SettingsFormProps<any>>,
  },
  riddle_list: {
    label:           "謎・問題",
    icon:            "",
    description:     "プレイヤーが到達した謎・問題を一覧表示",
    defaultSettings: { title: "謎・問題", show_status: true } satisfies RiddleListSettings,
    SettingsForm:    RiddleListForm as ComponentType<SettingsFormProps<any>>,
  },
  checkin_history: {
    label:           "チェックイン履歴",
    icon:            "📍",
    description:     "プレイヤー本人のチェックイン履歴を一覧表示",
    defaultSettings: { title: "チェックイン履歴" } satisfies CheckinHistorySettings,
    SettingsForm:    CheckinHistoryForm as ComponentType<SettingsFormProps<any>>,
  },
};

export const ALL_BLOCK_TYPES = Object.keys(BLOCK_TYPE_REGISTRY) as LiffBlockType[];

/** ブロック追加メニューから除外する type（registry/renderer/validation には残置＝既存データ非破壊）。
 *  開始/再開ボタン・証拠リストは新規追加 UI から外す。 */
const NON_ADDABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "start_button", "resume_button", "evidence_list",
]);

/** 追加メニューに出すブロック type（除外分を除いた登録順）。 */
export const ADDABLE_BLOCK_TYPES = ALL_BLOCK_TYPES.filter(
  (t) => !NON_ADDABLE_BLOCK_TYPES.has(t),
) as LiffBlockType[];

export function getBlockEntry(blockType: string): BlockTypeEntry | undefined {
  return BLOCK_TYPE_REGISTRY[blockType as LiffBlockType];
}

export const VISIBILITY_CONDITION_LABELS: Record<VisibilityCondition, string> = {
  always:       "常に表示",
  before_start: "開始前のみ",
  in_progress:  "プレイ中のみ",
  completed:    "クリア後のみ",
};
