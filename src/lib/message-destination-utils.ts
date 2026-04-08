// src/lib/message-destination-utils.ts
// メッセージの遷移先URLを解決する共通ユーティリティ。
// プレビュー・保存・LINE送信の3箇所でズレないよう、ここに集約する。
//
// 優先順位:
//   1. tap_destination_id → destination.resolved_url
//   2. tap_url → そのまま使用
//   3. どちらもなし → null（遷移なし）

import type { LineDestination } from "@/types";
import { resolveDestinationUrlFromApi } from "./destination-url-builder";

/**
 * メッセージのタップ遷移先URLを解決する。
 * プレビュー・送信payload の両方でこの関数を使うことで一貫性を保証する。
 *
 * @param tapDestinationId - 設定されている destination ID（null = 未使用）
 * @param tapUrl - 直接入力URL（null = 未設定）
 * @param destinations - 作品の destination 一覧（resolved_url 解決用）
 */
export function resolveMessageActionUrl(
  tapDestinationId: string | null | undefined,
  tapUrl: string | null | undefined,
  destinations: LineDestination[]
): string | null {
  // 1. destination_id が設定されている場合
  if (tapDestinationId) {
    const dest = destinations.find((d) => d.id === tapDestinationId);
    if (dest) {
      return dest.resolved_url ?? resolveDestinationUrlFromApi(dest);
    }
  }

  // 2. 直接URL
  if (tapUrl) {
    return tapUrl;
  }

  // 3. なし
  return null;
}

/**
 * カルーセルカードのボタンURLを解決する。
 * カードの button_url（直接入力）と destination_id（設定がある場合）を優先順位で解決。
 */
export function resolveCarouselButtonUrl(
  card: { destination_id?: string | null; button_url?: string },
  destinations: LineDestination[]
): string | null {
  if (card.destination_id) {
    const dest = destinations.find((d) => d.id === card.destination_id);
    if (dest) {
      return dest.resolved_url ?? resolveDestinationUrlFromApi(dest);
    }
  }
  return card.button_url || null;
}

/**
 * 遷移先モードを判定する。
 * 既存データの tap_destination_id / tap_url から初期表示モードを決める。
 */
/**
 * 既存データからタップ遷移先のモードを判定する。
 * 新規作成時（両方未設定）は destination モードを推奨する。
 */
export function detectTapMode(
  tapDestinationId: string | null | undefined,
  tapUrl: string | null | undefined
): "destination" | "direct_url" | "none" {
  if (tapDestinationId) return "destination";
  if (tapUrl) return "direct_url";
  return "destination"; // 新規作成時は destination を推奨
}
