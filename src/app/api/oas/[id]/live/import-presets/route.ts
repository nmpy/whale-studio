// src/app/api/oas/[id]/live/import-presets/route.ts
// GET  — OA 内のユーザー保存済みプリセット一覧 + built-in 一覧
// POST — プリセット保存
//
// 認可: live admin 集合 (= authorizeLive)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { BUILTIN_PRESETS } from "@/lib/live-import-presets-builtin";

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

const createPresetSchema = z.object({
  name:           z.string().min(1, "name は必須です").max(120),
  description:    z.string().max(500).optional().nullable(),
  // mapping: { <internal field>: "<csv header>" } の Record
  mapping:        z.record(mappingFieldEnum, z.string().max(200)),
  team_mode:      z.enum(["by_reservation", "by_4", "by_team_name_column", "none"]),
  duplicate_mode: z.enum(["skip", "overwrite", "duplicate"]),
  delimiter:      z.enum(["auto", "comma", "tab"]).optional().nullable(),
  encoding:       z.enum(["auto", "utf-8", "shift_jis"]).optional().nullable(),
});

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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const presets = await prisma.liveImportPreset.findMany({
      where:   { oaId: params.id },
      orderBy: { createdAt: "asc" },
      take:    200,
    });
    return ok({
      saved:   presets.map(toResponse),
      builtin: BUILTIN_PRESETS,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createPresetSchema.parse(body);
    const preset = await prisma.liveImportPreset.create({
      data: {
        oaId:          params.id,
        name:          data.name,
        description:   data.description ?? null,
        mapping:       data.mapping as Prisma.InputJsonValue,
        teamMode:      data.team_mode,
        duplicateMode: data.duplicate_mode,
        delimiter:     data.delimiter ?? null,
        encoding:      data.encoding ?? null,
      },
    });
    return created(toResponse(preset));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
