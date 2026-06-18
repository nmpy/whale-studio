// src/app/api/liff/works/[workId]/contact/route.ts
// POST /api/liff/works/[workId]/contact — LIFF お問い合わせ送信（認証不要・公開）
//
// LIFF プレイヤーの ContactRenderer から呼ばれる。送信内容を LiffSubmission に保存し、
// LiffEventLog(contact_submit) を記録する。Slack 通知は本PRでは行わない（PR5b 予定）。
// honeypot に値があれば bot とみなし、保存せず success を返す。

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import {
  findWorkByIdOrPublicId,
  findLiffPageConfigByIdOrPublicId,
} from "@/lib/public-id-resolver";
import { normalizeLiffPageType } from "@/types";
import type { LiffPageConfigSettings } from "@/types";
import {
  resolveContactConfig,
  validateContactSubmission,
  buildContactSubmissionBlocks,
} from "@/components/liff/contact-helpers";

export const dynamic = "force-dynamic";

const customAnswerValueSchema = z.union([z.string().max(5000), z.array(z.string().max(500)).max(50)]);

const contactBodySchema = z.object({
  // どの contact ページから送られたか。設定読込・計測に必須。
  page_id:        z.string().min(1).max(200),
  line_user_id:   z.string().max(100).optional().nullable(),
  display_name:   z.string().max(200).optional().nullable(),
  category:       z.string().max(200).optional().nullable(),
  name:           z.string().max(200).optional().nullable(),
  email:          z.string().max(254).optional().nullable(),
  // 本文の論理上限(100)は validateContactSubmission で検証。ここは防御的な hard cap。
  body:           z.string().max(2000).optional().nullable(),
  custom_answers: z.record(customAnswerValueSchema).optional().nullable(),
  // bot 検出用の隠しフィールド。人間は空のはず。
  honeypot:       z.string().max(500).optional().nullable(),
});

function ok() {
  return NextResponse.json({ ok: true });
}
function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return fail(404, "NOT_FOUND", "作品が見つかりません");

    const data = contactBodySchema.parse(await req.json());

    // 対象ページを解決し、work 配下 + contact + 公開中 + 有効 を検証。
    const page = await findLiffPageConfigByIdOrPublicId(data.page_id, { workScope: work.id });
    if (!page) return fail(404, "NOT_FOUND", "ページが見つかりません");
    if (normalizeLiffPageType(page.pageType) !== "contact") {
      return fail(400, "BAD_REQUEST", "お問い合わせページではありません");
    }
    if (page.publishStatus !== "published" || page.isEnabled !== true) {
      return fail(404, "NOT_FOUND", "このページは公開されていません");
    }

    // honeypot に値 → bot。保存せず success を返す（攻撃者に挙動を悟らせない）。
    if ((data.honeypot ?? "").trim() !== "") return ok();

    const settings = (page.settingsJson ?? {}) as LiffPageConfigSettings;
    const cfg = resolveContactConfig(settings);

    // サーバ側でも必ず検証（公開エンドポイントのため）。
    const validationError = validateContactSubmission(cfg, {
      category: data.category, name: data.name, email: data.email, body: data.body,
      custom_answers: data.custom_answers ?? {},
    });
    if (validationError) return fail(400, "BAD_REQUEST", validationError);

    const blocks = buildContactSubmissionBlocks(cfg, {
      category: data.category, name: data.name, email: data.email, body: data.body,
      custom_answers: data.custom_answers ?? {},
    });
    if (blocks.length === 0) return fail(400, "BAD_REQUEST", "送信内容が空です");

    const saved = await prisma.liffSubmission.create({
      data: {
        oaId:        work.oaId,
        workId:      work.id,
        liffPageId:  page.id,
        lineUserId:  data.line_user_id ?? null,
        displayName: data.display_name ?? null,
        answersJson: { blocks } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // 計測: contact_submit（失敗しても送信自体は成功扱い）。
    prisma.liffEventLog
      .create({
        data: {
          workId:          work.id,
          liffPageConfigId: page.id,
          lineUserId:      data.line_user_id ?? null,
          eventType:       "contact_submit",
          metadataJson:    { submission_id: saved.id, block_count: blocks.length } as Prisma.InputJsonValue,
        },
      })
      .catch((e) => console.error("[LIFF Contact] event log failed:", e));

    return ok();
  } catch (err) {
    if (err instanceof ZodError) return fail(400, "BAD_REQUEST", "入力内容に誤りがあります");
    console.error("[LIFF Contact Submit Error]", err);
    return fail(500, "INTERNAL_SERVER_ERROR", "サーバーエラーが発生しました");
  }
}
