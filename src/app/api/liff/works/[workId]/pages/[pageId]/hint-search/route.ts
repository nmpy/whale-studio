// src/app/api/liff/works/[workId]/pages/[pageId]/hint-search/route.ts
//
// POST /api/liff/works/[workId]/pages/[pageId]/hint-search
// 検索型ヒントページ (page_type="hint_search") 専用の公開 API（認証不要）。
//
// なぜ専用 API にするか（ネタバレ防止）:
//   ページ設定 API (`GET .../pages/[pageId]`) は settings_json をそのまま返すため、そこに
//   ヒント本文を載せるとプレイヤーが検索する前に全ヒントがクライアントへ届いてしまう。
//   そのため hint_search_entries / hint_search_guide_options はページ API 側で除去し、
//   検索・詳細・答え・質問ツリーはすべてこのサーバー API を通す。
//   クライアントへ渡るのは「その画面に必要な分だけ」。
//
// mode:
//   - "search" : q に一致したヒントの id/label のみ返す。1 件だけなら detail も同梱する。
//   - "detail" : 指定 id の段階ヒント本文を返す（答え本文は含まない）。
//   - "answer" : 指定 id の答え本文を返す。プレイヤーが確認画面で明示同意した後にだけ呼ばれる。
//   - "guide"  : 「キーワードがわからない場合」の質問ツリーを 1 階層だけ返す。
//                path の 1 つ先までしか返さないので、選んでいない枝の内容は届かない。
//
// 検索語の扱い:
//   - GET の query string ではなく POST body で受ける（アクセスログ / リファラに残さないため）。
//   - サーバー側でも検索語をログに出さない。
//   - 返すのは登録済みデータのみ。生成 AI・推測による補完は一切行わない。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId } from "@/lib/public-id-resolver";
import { normalizeLiffPageType } from "@/types";
import {
  normalizeHintSearchEntries,
  normalizeHintSearchGuide,
  resolveGuidePath,
  searchHintEntries,
  toDetail,
  toResultItem,
  HINT_SEARCH_GUIDE_DEFAULT_QUESTION,
  HINT_SEARCH_GUIDE_MAX_DEPTH,
  HINT_SEARCH_MAX_QUERY_LENGTH,
} from "@/lib/liff/hint-search";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({
    mode:    z.literal("search"),
    q:       z.string().max(HINT_SEARCH_MAX_QUERY_LENGTH * 20),
    preview: z.boolean().optional(),
  }),
  z.object({
    mode:    z.literal("detail"),
    id:      z.string().max(64),
    preview: z.boolean().optional(),
  }),
  z.object({
    mode:    z.literal("answer"),
    id:      z.string().max(64),
    preview: z.boolean().optional(),
  }),
  z.object({
    mode:    z.literal("guide"),
    path:    z.array(z.number().int().min(0).max(64)).max(HINT_SEARCH_GUIDE_MAX_DEPTH).optional(),
    preview: z.boolean().optional(),
  }),
]);

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string; pageId: string }> }
) {
  try {
    const { workId: workIdOrPublic, pageId: pageIdOrPublic } = await ctx.params;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return fail("INVALID_BODY", "リクエストの形式が正しくありません", 400);
    }
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      // 検索語そのものは絶対にログへ出さない。
      return fail("INVALID_BODY", "リクエストの形式が正しくありません", 400);
    }
    const body = parsed.data;
    const preview = body.preview === true;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return fail("NOT_FOUND", "ページを読み込めませんでした。URLが正しいか確認してください。", 404);

    if (!preview && (work as { liffEnabled?: boolean }).liffEnabled === false) {
      return fail("LIFF_DISABLED", "このLIFFは現在無効になっています", 404);
    }

    const configMeta = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
    if (!configMeta) return fail("NOT_FOUND", "ページを読み込めませんでした。URLが正しいか確認してください。", 404);

    const config = await prisma.liffPageConfig.findUnique({
      where:  { id: configMeta.id },
      select: { isEnabled: true, publishStatus: true, pageType: true, settingsJson: true },
    });
    if (!config || !config.isEnabled) return fail("LIFF_DISABLED", "このLIFFページは無効です", 404);
    if (!preview && config.publishStatus !== "published") {
      return fail("LIFF_NOT_PUBLISHED", "このLIFFページはまだ公開されていません", 404);
    }
    if (normalizeLiffPageType(config.pageType) !== "hint_search") {
      return fail("NOT_FOUND", "ページを読み込めませんでした。URLが正しいか確認してください。", 404);
    }

    const settings = (config.settingsJson ?? {}) as {
      hint_search_entries?: unknown;
      hint_search_guide_options?: unknown;
      hint_search_guide_question?: unknown;
    };
    const entries = normalizeHintSearchEntries(settings.hint_search_entries);

    if (body.mode === "detail" || body.mode === "answer") {
      const entry = entries.find((e) => e.id === body.id);
      if (!entry) return fail("NOT_FOUND", "ヒントが見つかりませんでした", 404);
      if (body.mode === "detail") {
        return NextResponse.json({ success: true, data: { detail: toDetail(entry) } });
      }
      if (!entry.answer) return fail("NOT_FOUND", "答えは登録されていません", 404);
      return NextResponse.json({ success: true, data: { answer: entry.answer } });
    }

    if (body.mode === "guide") {
      const root = normalizeHintSearchGuide(settings.hint_search_guide_options);
      const path = body.path ?? [];
      const resolved = resolveGuidePath(root, path);
      if (!resolved.ok) return fail("NOT_FOUND", "選択肢が見つかりませんでした", 404);

      const node = resolved.node;
      const options = node ? node.options : root;

      // 葉に到達したら該当ヒントの詳細を返す。到達していない枝の内容は一切返さない。
      if (options.length === 0 && node?.hintId) {
        const entry = entries.find((e) => e.id === node.hintId);
        if (!entry) return fail("NOT_FOUND", "ヒントが見つかりませんでした", 404);
        return NextResponse.json({
          success: true,
          data: { breadcrumb: resolved.breadcrumb, question: null, options: [], detail: toDetail(entry) },
        });
      }

      const rootQuestion = typeof settings.hint_search_guide_question === "string"
        && settings.hint_search_guide_question.trim() !== ""
        ? settings.hint_search_guide_question.trim()
        : HINT_SEARCH_GUIDE_DEFAULT_QUESTION;

      return NextResponse.json({
        success: true,
        data: {
          breadcrumb: resolved.breadcrumb,
          question:   node ? (node.question ?? HINT_SEARCH_GUIDE_DEFAULT_QUESTION) : rootQuestion,
          // ラベルだけを返す。子の中身（さらに先の選択肢 / 紐づくヒント）は含めない。
          options:    options.map((o) => ({ label: o.label })),
          detail:     null,
        },
      });
    }

    // mode === "search"
    const matches = searchHintEntries(entries, body.q);
    return NextResponse.json({
      success: true,
      data: {
        items: matches.map((m) => toResultItem(m.entry)),
        // 1 件ヒットはそのままヒント詳細を表示する仕様なので、往復を減らして同梱する。
        detail: matches.length === 1 ? toDetail(matches[0].entry) : null,
      },
    });
  } catch (err) {
    console.error("[LIFF hint-search API Error]", err);
    return fail("INTERNAL_SERVER_ERROR", "サーバーエラーが発生しました", 500);
  }
}
