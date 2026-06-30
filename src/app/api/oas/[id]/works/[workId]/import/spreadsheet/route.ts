// POST /api/oas/[id]/works/[workId]/import/spreadsheet
// スプレッドシート(.xlsx 1ファイル・3シート)取り込み。mode=validate(検証+プレビュー・DB書込なし) / mode=apply(検証→transaction upsert)。
// UI は PR3。権限: 対象 OA/work の editor 以上。他作品・他OA の参照/更新は不可（workId は oaId 所属を確認）。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, forbidden, unprocessable, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { logEvent } from "@/lib/event-logger";
import { parseWorkbook } from "@/lib/spreadsheet-import/parse";
import { normalizeSheets } from "@/lib/spreadsheet-import/normalize";
import { validateImport } from "@/lib/spreadsheet-import/validate";
import { buildPreview } from "@/lib/spreadsheet-import/preview";
import { applyImport } from "@/lib/spreadsheet-import/apply";
import { checkImportFile } from "@/lib/spreadsheet-import/file-guard";
import type { ExistingData, ImportPreview } from "@/lib/spreadsheet-import/types";

export const dynamic = "force-dynamic";

/** 取り込み時に参照する既存DBスナップショットを構築（対象 work スコープのみ）。 */
async function loadExisting(workId: string): Promise<ExistingData> {
  const [chars, phases, msgs, transitions] = await Promise.all([
    prisma.character.findMany({ where: { workId, characterKey: { not: null } }, select: { characterKey: true } }),
    prisma.phase.findMany({ where: { workId }, select: { id: true, phaseKey: true, phaseType: true } }),
    prisma.message.findMany({ where: { workId, messageKey: { not: null } }, select: { messageKey: true } }),
    prisma.transition.findMany({ where: { workId }, select: { condition: true, fromPhaseId: true } }),
  ]);

  const phaseKeys = new Set<string>();
  const phaseTypeByKey = new Map<string, string>();
  const idToKey = new Map<string, string>();
  let existingStartPhase: ExistingData["existingStartPhase"] = null;
  for (const p of phases) {
    if (p.phaseKey) { phaseKeys.add(p.phaseKey); phaseTypeByKey.set(p.phaseKey, p.phaseType); idToKey.set(p.id, p.phaseKey); }
    if (p.phaseType === "start" && !existingStartPhase) existingStartPhase = { phaseKey: p.phaseKey ?? null };
  }
  const transitionKeys = new Set<string>();
  for (const t of transitions) {
    const fromKey = idToKey.get(t.fromPhaseId);
    if (fromKey && t.condition) transitionKeys.add(`${fromKey}::${t.condition}`);
  }

  return {
    characterKeys: new Set(chars.map((c) => c.characterKey!).filter(Boolean)),
    phaseKeys,
    messageKeys: new Set(msgs.map((m) => m.messageKey!).filter(Boolean)),
    phaseTypeByKey,
    existingStartPhase,
    transitionKeys,
  };
}

export const POST = withAuth<{ id: string; workId: string }>(async (req: NextRequest, { params }, user) => {
  try {
    const oaId = params.id;
    const { workId } = params;

    // 権限: 対象 OA の editor 以上。
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // work が oaId 所属か（他OA/他作品スコープ防止）。
    const work = await prisma.work.findFirst({ where: { id: workId, oaId }, select: { id: true } });
    if (!work) return notFound("作品");

    // multipart からファイル取得。
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return badRequest("xlsx ファイル(file)を multipart/form-data で送信してください");

    // 拡張子 / MIME / サイズ上限(10MB)チェック。
    const fileCheck = checkImportFile(file);
    if (!fileCheck.ok) return badRequest(fileCheck.message, { code: [fileCheck.code] });

    const mode = (new URL(req.url).searchParams.get("mode") || String(form.get("mode") || "validate")).toLowerCase();
    if (mode !== "validate" && mode !== "apply") return badRequest("mode は validate / apply のいずれかです");

    // parse → normalize（apply でも必ず再実行＝フロントの結果を信用しない）。
    let raw;
    try {
      raw = await parseWorkbook(await file.arrayBuffer());
    } catch {
      return badRequest("xlsx の解析に失敗しました。ファイル形式を確認してください", { code: ["INVALID_FILE"] });
    }
    const normalized = normalizeSheets(raw);

    const existing = await loadExisting(workId);
    const errors = validateImport(raw, normalized, existing);
    const { summary, rows } = buildPreview(normalized, existing);
    const preview: ImportPreview = { ok: errors.length === 0, errors, summary, rows };

    if (mode === "validate") return ok(preview);

    // mode === "apply"
    if (!preview.ok) return unprocessable("取り込みデータに誤りがあります", "IMPORT_VALIDATION", preview as unknown as Record<string, unknown>);

    await prisma.$transaction((tx) => applyImport(tx, workId, normalized));

    const appliedAt = new Date().toISOString();
    logEvent("spreadsheet_imported", { workId, oaId, summary, appliedAt }, { userId: user.id, oaId });

    return ok({ ok: true, applied: summary, appliedAt });
  } catch (err) {
    return serverError(err);
  }
});
