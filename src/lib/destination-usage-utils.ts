// src/lib/destination-usage-utils.ts
// destination の使用箇所を集約して返すユーティリティ。
// 画像メッセージ、カルーセルカード、リッチメニューエリア、クイックリプライを横断検索する。

import { prisma } from "./prisma";

export type UsageType = "image_message" | "carousel_button" | "richmenu_area" | "quick_reply";

export interface DestinationUsage {
  usage_type:     UsageType;
  parent_id:      string;
  parent_name:    string;
  location_label: string;
}

/**
 * 指定 destination の使用箇所を全面走査して返す。
 * DB の FK（messages.tapDestinationId, rich_menu_areas.destinationId）と、
 * JSON 内参照（carousel body, quick_replies）の両方を検索する。
 */
export async function getDestinationUsages(destinationId: string, workId: string): Promise<DestinationUsage[]> {
  const usages: DestinationUsage[] = [];

  // 1. 画像メッセージ（tapDestinationId FK）
  const imageMessages = await prisma.message.findMany({
    where: { workId, tapDestinationId: destinationId },
    select: { id: true, body: true, messageType: true, sortOrder: true },
  });
  for (const m of imageMessages) {
    usages.push({
      usage_type:     "image_message",
      parent_id:      m.id,
      parent_name:    m.body?.slice(0, 30) || `メッセージ #${m.sortOrder}`,
      location_label: `${m.messageType === "image" ? "画像" : m.messageType}メッセージ`,
    });
  }

  // 2. カルーセルカード（body JSON 内の destination_id）
  const carouselMessages = await prisma.message.findMany({
    where: { workId, messageType: "carousel" },
    select: { id: true, body: true, sortOrder: true },
  });
  for (const m of carouselMessages) {
    if (!m.body) continue;
    try {
      const cards = JSON.parse(m.body) as Array<{ destination_id?: string; title?: string }>;
      cards.forEach((card, idx) => {
        if (card.destination_id === destinationId) {
          usages.push({
            usage_type:     "carousel_button",
            parent_id:      m.id,
            parent_name:    card.title || `カード ${idx + 1}`,
            location_label: `カルーセル #${m.sortOrder} > カード ${idx + 1}`,
          });
        }
      });
    } catch { /* ignore parse errors */ }
  }

  // 3. リッチメニューエリア（destinationId FK）
  const richMenuAreas = await prisma.richMenuArea.findMany({
    where: { destinationId },
    select: { id: true, actionLabel: true, sortOrder: true, richMenu: { select: { id: true, name: true } } },
  });
  for (const area of richMenuAreas) {
    usages.push({
      usage_type:     "richmenu_area",
      parent_id:      area.richMenu.id,
      parent_name:    area.richMenu.name,
      location_label: `リッチメニュー「${area.richMenu.name}」> エリア ${area.sortOrder + 1}`,
    });
  }

  // 4. クイックリプライ（quickReplies JSON 内の destination_id）
  const messagesWithQr = await prisma.message.findMany({
    where: { workId, NOT: { quickReplies: null } },
    select: { id: true, quickReplies: true, sortOrder: true, body: true },
  });
  for (const m of messagesWithQr) {
    if (!m.quickReplies) continue;
    try {
      const items = JSON.parse(m.quickReplies) as Array<{ destination_id?: string; label?: string }>;
      items.forEach((item) => {
        if (item.destination_id === destinationId) {
          usages.push({
            usage_type:     "quick_reply",
            parent_id:      m.id,
            parent_name:    item.label || "クイックリプライ",
            location_label: `メッセージ #${m.sortOrder} > QR「${item.label || "..."}」`,
          });
        }
      });
    } catch { /* ignore */ }
  }

  return usages;
}

/**
 * 指定 work の全 destination の usage count を一括取得する。
 * 一覧画面で各 destination の使用件数を表示するために使用。
 */
export async function getDestinationUsageCounts(workId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // FK ベース: messages.tapDestinationId
  const msgCounts = await prisma.message.groupBy({
    by: ["tapDestinationId"],
    where: { workId, tapDestinationId: { not: null } },
    _count: true,
  });
  for (const g of msgCounts) {
    if (g.tapDestinationId) counts[g.tapDestinationId] = (counts[g.tapDestinationId] ?? 0) + g._count;
  }

  // FK ベース: richMenuAreas.destinationId（リッチメニューは OA 単位だが work の destination を参照）
  const areaCounts = await prisma.richMenuArea.groupBy({
    by: ["destinationId"],
    where: { destinationId: { not: null } },
    _count: true,
  });
  for (const g of areaCounts) {
    if (g.destinationId) counts[g.destinationId] = (counts[g.destinationId] ?? 0) + g._count;
  }

  // JSON ベース: carousel body + quickReplies はカウントだけなら簡易走査
  const jsonMessages = await prisma.message.findMany({
    where: { workId, OR: [{ messageType: "carousel" }, { NOT: { quickReplies: null } }] },
    select: { body: true, messageType: true, quickReplies: true },
  });
  for (const m of jsonMessages) {
    // carousel
    if (m.messageType === "carousel" && m.body) {
      try {
        const cards = JSON.parse(m.body) as Array<{ destination_id?: string }>;
        for (const card of cards) {
          if (card.destination_id) counts[card.destination_id] = (counts[card.destination_id] ?? 0) + 1;
        }
      } catch { /* ignore */ }
    }
    // quick replies
    if (m.quickReplies) {
      try {
        const items = JSON.parse(m.quickReplies) as Array<{ destination_id?: string }>;
        for (const item of items) {
          if (item.destination_id) counts[item.destination_id] = (counts[item.destination_id] ?? 0) + 1;
        }
      } catch { /* ignore */ }
    }
  }

  return counts;
}
