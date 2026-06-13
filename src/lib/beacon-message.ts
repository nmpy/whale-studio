// src/lib/beacon-message.ts
//
// action_type="message" の beacon トリガーが送る、登録済み Message（チェーン）を
// LineMessage[] に解決する共有ローダー。
//
// webhook ルート（本番）にも同等の loadBeaconMessageChain があるが、そちらは
// readCtrlStorage（AsyncLocalStorage の読み演出コントローラ）に 1 通目 timing を流す
// webhook 専用ラッパーを噛ませている。テスト発火ルートにはそのコントローラが存在しない
// ため、本ファイルでは素の buildKeywordMessages（per-message _timing は各 LineMessage に
// 付与される）を使う。lag_ms / typing / loading / quickReply / chain の解決ロジックは同一。

import { prisma } from "@/lib/prisma";
import { buildKeywordMessages, type KeywordMessageRecord, type LineMessage } from "@/lib/line";
import type { MessageTimingConfig, ReadReceiptMode } from "@/types";

// webhook 側 BEACON_MSG_SELECT と同一カラム集合。
const BEACON_MSG_SELECT = {
  id: true, messageType: true, body: true, assetUrl: true, altText: true, flexPayloadJson: true,
  quickReplies: true, nextMessageId: true, sortOrder: true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  freeInputEnabled: true,
  lagMs: true, readReceiptMode: true, readDelayMs: true,
  typingEnabled: true, typingMinMs: true, typingMaxMs: true,
  loadingEnabled: true, loadingThresholdMs: true, loadingMinSeconds: true, loadingMaxSeconds: true,
  character: { select: { name: true, iconImageUrl: true } },
} as const;

/** DB raw Message から MessageTimingConfig を組み立てる（webhook の buildKeywordTiming と同一ロジック）。 */
function buildTiming(r: {
  readReceiptMode?:    string | null;
  readDelayMs?:        number | null;
  typingEnabled?:      boolean | null;
  typingMinMs?:        number | null;
  typingMaxMs?:        number | null;
  loadingEnabled?:     boolean | null;
  loadingThresholdMs?: number | null;
  loadingMinSeconds?:  number | null;
  loadingMaxSeconds?:  number | null;
}): MessageTimingConfig | null {
  const hasAny =
    r.readReceiptMode != null || r.readDelayMs != null ||
    r.typingEnabled != null || r.typingMinMs != null || r.typingMaxMs != null ||
    r.loadingEnabled != null || r.loadingThresholdMs != null ||
    r.loadingMinSeconds != null || r.loadingMaxSeconds != null;
  if (!hasAny) return null;
  return {
    read_receipt_mode:    (r.readReceiptMode as ReadReceiptMode | null) ?? null,
    read_delay_ms:        r.readDelayMs        ?? null,
    typing_enabled:       r.typingEnabled      ?? null,
    typing_min_ms:        r.typingMinMs        ?? null,
    typing_max_ms:        r.typingMaxMs        ?? null,
    loading_enabled:      r.loadingEnabled     ?? null,
    loading_threshold_ms: r.loadingThresholdMs ?? null,
    loading_min_seconds:  r.loadingMinSeconds  ?? null,
    loading_max_seconds:  r.loadingMaxSeconds  ?? null,
  };
}

/**
 * messageId から DB Message chain（最大 5 通）を読み、LineMessage[] を構築する。
 * head が無い / 非アクティブなら null。
 */
export async function loadBeaconMessageChain(
  messageId: string,
  accountName: string,
): Promise<LineMessage[] | null> {
  const head = await prisma.message.findFirst({ where: { id: messageId, isActive: true }, select: BEACON_MSG_SELECT });
  if (!head) return null;
  const rows: (typeof head)[] = [head];
  const visited = new Set<string>([head.id]);
  let cur = head;
  while (rows.length < 5 && cur.nextMessageId && !cur.freeInputEnabled) {
    if (visited.has(cur.nextMessageId)) break;
    const next = await prisma.message.findFirst({ where: { id: cur.nextMessageId, isActive: true }, select: BEACON_MSG_SELECT });
    if (!next) break;
    visited.add(next.id);
    rows.push(next);
    if (next.freeInputEnabled) break;
    cur = next;
  }
  const records: KeywordMessageRecord[] = rows.map((m) => ({ ...m, timing: buildTiming(m) }));
  const msgs = buildKeywordMessages(records, undefined, { accountName });
  return msgs.length > 0 ? msgs : null;
}
