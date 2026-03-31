// src/app/api/oas/[id]/sheets-cache/route.ts
// GET    — キャッシュ状態を返す
// DELETE — キャッシュを破棄して次回強制再取得

import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { getSheetsCacheStatus, invalidateSheetsCache, loadSheetsData } from "@/lib/sheets-db";

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    if (!oa.spreadsheetId) {
      return ok({ sheets_mode: false, message: "この OA は Sheets モードが未設定です" });
    }

    const status = getSheetsCacheStatus(oa.spreadsheetId);
    return ok({
      sheets_mode:    true,
      spreadsheet_id: oa.spreadsheetId,
      ...status,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");
    if (!oa.spreadsheetId) {
      return ok({ refreshed: false, message: "Sheets モードが未設定です" });
    }
    invalidateSheetsCache(oa.spreadsheetId);
    // 強制リロード
    const data = await loadSheetsData(oa.spreadsheetId, true);
    return ok({
      refreshed:  true,
      loaded_at:  data.loadedAt.toISOString(),
      counts: {
        works:            data.works.length,
        characters:       data.characters.length,
        phases:           data.phases.length,
        messages:         data.messages.length,
        transitions:      data.transitions.length,
        welcome_messages: data.welcomeMessages.length,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
