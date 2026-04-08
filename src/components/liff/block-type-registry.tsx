"use client";

// src/components/liff/block-type-registry.tsx
// ブロックタイプの統一レジストリ
// switch文の重複を排除し、新しいblock_type追加時にこの1ファイルだけ編集すれば済むようにする。

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
} from "./block-settings-forms";

// ── 共通 Props 型 ────────────────────────────────
// settings form が受け取る共通シグネチャ
export type SettingsFormProps<T = Record<string, unknown>> = {
  settings: T;
  onChange: (s: T) => void;
  readOnly?: boolean;
};

// ── レジストリエントリ型 ─────────────────────────
export interface BlockTypeEntry {
  /** UIラベル */
  label: string;
  /** 絵文字アイコン */
  icon: string;
  /** 概要説明 */
  description: string;
  /** 新規作成時のデフォルト設定 */
  defaultSettings: Record<string, unknown>;
  /** 管理画面: 設定フォームコンポーネント */
  SettingsForm: ComponentType<SettingsFormProps<any>>;
}

// ── レジストリ本体 ───────────────────────────────
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
    defaultSettings: { image_url: "", alt: "", caption: "" } satisfies ImageBlockSettings,
    SettingsForm:    ImageBlockForm as ComponentType<SettingsFormProps<any>>,
  },
  video: {
    label:           "動画",
    icon:            "🎬",
    description:     "動画を表示",
    defaultSettings: { video_url: "", poster_url: "", caption: "" } satisfies VideoBlockSettings,
    SettingsForm:    VideoBlockForm as ComponentType<SettingsFormProps<any>>,
  },
};

// ── ヘルパー ─────────────────────────────────────
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
