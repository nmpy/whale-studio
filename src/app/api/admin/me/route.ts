// src/app/api/admin/me/route.ts
// GET /api/admin/me — 現在ユーザーのプラットフォームロールを返す

import { withAuth } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { isPlatformOwner } from "@/lib/platform-admin";

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    return ok({ is_platform_owner: isPlatformOwner(user.id) });
  } catch (err) {
    return serverError(err);
  }
});
