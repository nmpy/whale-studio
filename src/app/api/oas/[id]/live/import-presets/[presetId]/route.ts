// src/app/api/oas/[id]/live/import-presets/[presetId]/route.ts
// PATCH  — プリセット編集 (name / description / mapping / teamMode / duplicateMode 等)
// DELETE — プリセット削除
//
// 認可: live admin 集合。OA 横断アクセス防止のため oaId 検証あり。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const mappingFieldEnum = z.enum([
  "display_name",
  "email",
  "line_user_id",
  "reservation_number",
  "__date",
  "__time",
  "team_name",
  "current_step",
  "memo",
  "status",
]);

const patchPresetSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  description:    z.string().max(500).optional().nullable(),
  mapping:        z.record(mappingFieldEnum, z.string().max(200)).optional(),
  team_mode:      z.enum(["by_reservation", "by_4", "by_team_name_column", "none"]).optional(),
  duplicate_mode: z.enum(["skip", "overwrite", "duplicate"]).optional(),
  delimiter:      z.enum(["auto", "comma", "tab"]).optional().nullable(),
  encoding:       z.enum(["auto", "utf-8", "shift_jis"]).optional().nullable(),
}).refine(
  (v) =>
    v.name           !== undefined ||
    v.description    !== undefined ||
    v.mapping        !== undefined ||
    v.team_mode      !== undefined ||
    v.duplicate_mode !== undefined ||
    v.delimiter      !== undefined ||
    v.encoding       !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

type PresetRow = {
  id: string;
  oaId: string;
  name: string;
  description: string | null;
  mapping: Prisma.JsonValue;
  teamMode: string;
  duplicateMode: string;
  delimiter: string | null;
  encoding: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(p: PresetRow) {
  return {
    id:             p.id,
    oa_id:          p.oaId,
    name:           p.name,
    description:    p.description,
    mapping:        p.mapping,
    team_mode:      p.teamMode,
    duplicate_mode: p.duplicateMode,
    delimiter:      p.delimiter,
    encoding:       p.encoding,
    created_at:     p.createdAt,
    updated_at:     p.updatedAt,
  };
}

async function findPreset(presetId: string, oaId: string) {
  return prisma.liveImportPreset.findFirst({
    where:  { id: presetId, oaId },
    select: { id: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; presetId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findPreset(params.presetId, params.id);
  if (!existing) return notFound("LiveImportPreset");

  try {
    const body = await req.json();
    const data = patchPresetSchema.parse(body);
    const updated = await prisma.liveImportPreset.update({
      where: { id: params.presetId },
      data: {
        ...(data.name           !== undefined ? { name:          data.name }           : {}),
        ...(data.description    !== undefined ? { description:   data.description }    : {}),
        ...(data.mapping        !== undefined ? { mapping:       data.mapping as Prisma.InputJsonValue } : {}),
        ...(data.team_mode      !== undefined ? { teamMode:      data.team_mode }      : {}),
        ...(data.duplicate_mode !== undefined ? { duplicateMode: data.duplicate_mode } : {}),
        ...(data.delimiter      !== undefined ? { delimiter:     data.delimiter }      : {}),
        ...(data.encoding       !== undefined ? { encoding:      data.encoding }       : {}),
      },
    });
    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; presetId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findPreset(params.presetId, params.id);
  if (!existing) return notFound("LiveImportPreset");

  try {
    await prisma.liveImportPreset.delete({ where: { id: params.presetId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
