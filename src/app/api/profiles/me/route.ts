// src/app/api/profiles/me/route.ts
// GET  /api/profiles/me — 現在ユーザーの profile を返す
// PUT  /api/profiles/me — username を upsert

import { withAuth } from "@/lib/auth";
import { ok, notFound, badRequest, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) return notFound("Profile");
    return ok({
      id:         profile.id,
      user_id:    profile.userId,
      username:   profile.username,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!username) return badRequest("ユーザー名を入力してください");
    if (username.length > 20) return badRequest("ユーザー名は20文字以内で入力してください");

    const profile = await prisma.profile.upsert({
      where:  { userId: user.id },
      update: { username },
      create: { userId: user.id, username },
    });
    return ok({
      id:         profile.id,
      user_id:    profile.userId,
      username:   profile.username,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    });
  } catch (err) {
    return serverError(err);
  }
});
