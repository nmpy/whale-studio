// src/lib/x-posts/response.ts
// XPost(Prisma) → API レスポンス（snake_case）変換。クリック数は呼び出し側で集計して渡す。

import type { XPost as PrismaXPost } from "@prisma/client";
import type { XPost, XPostStatus } from "@/types";
import { parseHashtagsJson } from "./format";

export function toXPostResponse(
  p: PrismaXPost,
  counts: { total: number; unique: number } = { total: 0, unique: 0 },
): XPost {
  return {
    id:                 p.id,
    oa_id:              p.oaId,
    work_id:            p.workId,
    title:              p.title,
    body:               p.body,
    hashtags:           parseHashtagsJson(p.hashtags),
    image_url:          p.imageUrl,
    uploaded_image_url: p.uploadedImageUrl,
    link_url:           p.linkUrl,
    utm_enabled:        p.utmEnabled,
    utm_name:           p.utmName,
    utm_source:         p.utmSource,
    utm_medium:         p.utmMedium,
    utm_campaign:       p.utmCampaign,
    utm_content:        p.utmContent,
    utm_term:           p.utmTerm,
    generated_url:      p.generatedUrl,
    tracking_code:      p.trackingCode,
    tracking_url:       p.trackingUrl,
    x_post_url:         p.xPostUrl,
    status:             (p.status as XPostStatus),
    note:               p.note,
    posted_at:          p.postedAt ? p.postedAt.toISOString() : null,
    scheduled_at:       p.scheduledAt ? p.scheduledAt.toISOString() : null,
    sort_order:         p.sortOrder,
    created_at:         p.createdAt.toISOString(),
    updated_at:         p.updatedAt.toISOString(),
    click_count:        counts.total,
    unique_click_count: counts.unique,
  };
}
