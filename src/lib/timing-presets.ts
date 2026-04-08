// src/lib/timing-presets.ts
// 演出タイミングプリセット定義
//
// 固定プリセットを型安全に管理する。
// DB にプリセットマスターは持たず、コード上の定数として管理。
// 将来カスタムプリセット対応時は、この構造に DB テーブルを追加して
// BUILTIN_PRESETS とマージする形で拡張可能。

import type { MessageTimingConfig, ReadReceiptMode } from "@/types";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

/** 組み込みプリセットキー */
export type BuiltinPresetKey = "immediate" | "natural" | "dramatic" | "tense" | "system";

/**
 * プリセット定義。
 * 将来カスタムプリセット対応時は `key: string` に拡張し、
 * DB テーブルから読み込む形にする。
 */
export interface TimingPresetDefinition {
  key:         BuiltinPresetKey;
  label:       string;
  description: string;
  values:      MessageTimingConfig;
}

// ────────────────────────────────────────────────
// 組み込みプリセット一覧
// ────────────────────────────────────────────────

function preset(
  key: BuiltinPresetKey,
  label: string,
  description: string,
  partial: Partial<MessageTimingConfig>,
): TimingPresetDefinition {
  return {
    key,
    label,
    description,
    values: {
      read_receipt_mode:    partial.read_receipt_mode    ?? null,
      read_delay_ms:        partial.read_delay_ms        ?? null,
      typing_enabled:       partial.typing_enabled       ?? null,
      typing_min_ms:        partial.typing_min_ms        ?? null,
      typing_max_ms:        partial.typing_max_ms        ?? null,
      loading_enabled:      partial.loading_enabled      ?? null,
      loading_threshold_ms: partial.loading_threshold_ms ?? null,
      loading_min_seconds:  partial.loading_min_seconds  ?? null,
      loading_max_seconds:  partial.loading_max_seconds  ?? null,
    },
  };
}

export const BUILTIN_PRESETS: readonly TimingPresetDefinition[] = [
  preset("immediate", "即時", "既読→即返信。システム通知やエラーメッセージ向け", {
    read_receipt_mode: "immediate",
    typing_enabled:    false,
    loading_enabled:   false,
  }),
  preset("natural", "ナチュラル", "人間が読んで少し考えてから返す自然な間", {
    read_receipt_mode:    "delayed",
    read_delay_ms:        1200,
    typing_enabled:       true,
    typing_min_ms:        300,
    typing_max_ms:        800,
    loading_enabled:      true,
    loading_threshold_ms: 3000,
    loading_min_seconds:  5,
    loading_max_seconds:  8,
  }),
  preset("dramatic", "ドラマチック", "じっくり読んでから返答。物語のクライマックス向け", {
    read_receipt_mode:    "delayed",
    read_delay_ms:        1800,
    typing_enabled:       true,
    typing_min_ms:        700,
    typing_max_ms:        1400,
    loading_enabled:      true,
    loading_threshold_ms: 2500,
    loading_min_seconds:  6,
    loading_max_seconds:  10,
  }),
  preset("tense", "テンス", "即既読→短い間→素早い返信。緊迫シーン向け", {
    read_receipt_mode:    "immediate",
    typing_enabled:       true,
    typing_min_ms:        200,
    typing_max_ms:        500,
    loading_enabled:      true,
    loading_threshold_ms: 2000,
    loading_min_seconds:  5,
    loading_max_seconds:  7,
  }),
  preset("system", "システム", "返信直前に既読。演出なし。案内・エラー表示向け", {
    read_receipt_mode: "before_reply",
    typing_enabled:    false,
    loading_enabled:   false,
  }),
] as const;

/** キーからプリセットを検索する */
export function getPresetByKey(key: string): TimingPresetDefinition | undefined {
  return BUILTIN_PRESETS.find((p) => p.key === key);
}

/**
 * プリセットの値を TimingForm 文字列に変換するヘルパー。
 * フォームステートは文字列で管理しているため、数値→文字列変換を行う。
 */
export function presetToFormValues(p: TimingPresetDefinition): Record<string, string> {
  const v = p.values;
  return {
    read_receipt_mode:    v.read_receipt_mode ?? "",
    read_delay_ms:        v.read_delay_ms != null ? String(v.read_delay_ms) : "",
    typing_enabled:       v.typing_enabled != null ? String(v.typing_enabled) : "",
    typing_min_ms:        v.typing_min_ms != null ? String(v.typing_min_ms) : "",
    typing_max_ms:        v.typing_max_ms != null ? String(v.typing_max_ms) : "",
    loading_enabled:      v.loading_enabled != null ? String(v.loading_enabled) : "",
    loading_threshold_ms: v.loading_threshold_ms != null ? String(v.loading_threshold_ms) : "",
    loading_min_seconds:  v.loading_min_seconds != null ? String(v.loading_min_seconds) : "",
    loading_max_seconds:  v.loading_max_seconds != null ? String(v.loading_max_seconds) : "",
  };
}
