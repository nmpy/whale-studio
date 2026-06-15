// src/app/api/admin/users/route.ts
// GET /api/admin/users — スタジオ管理（platform admin 専用）ユーザー一覧。
//
// データソース:
//   - Supabase Auth（service role / server-only）: id / email / created_at / last_sign_in_at /
//     provider(app_metadata|identities) / user_metadata(name, avatar)。
//   - DB: Profile（現在の表示名 username / 姓名 / 会社名）、WorkspaceMember（所有 OA 数）、Work（作品数）。
// migration なし。初回ログインの不変スナップショットは持たず、「登録時/現在の Supabase 情報」として扱う。
//
// セキュリティ:
//   - platform admin のみ（withPlatformAdmin は workspace owner も許可するため使わず、isPlatformOwner で限定）。
//   - service role key は server-only（このルート内でのみ使用・レスポンスに含めない）。
//   - 表示する個人情報（email 等）は本管理APIのみ。IP/UA/位置/行動ログは扱わない。

import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { ok, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

const FETCH_PER_PAGE = 1000; // Supabase admin listUsers の最大
const MAX_FETCH_PAGES = 20;  // 安全上限（最大 ~20,000 ユーザー）
const DEFAULT_PER_PAGE = 50;

type SortKey = "created_desc" | "created_asc" | "login_desc" | "login_asc";

interface SupaUser {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  identities?: Array<{ provider?: string }> | null;
  user_metadata?: Record<string, unknown> | null;
}

function metaStr(meta: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!meta) return null;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

function resolveProvider(u: SupaUser): string | null {
  const appProvider = metaStr(u.app_metadata ?? null, "provider");
  if (appProvider) return appProvider;
  const id = u.identities?.find((x) => x?.provider)?.provider;
  return id ?? null;
}

export const GET = withAuth(async (req, _ctx, user) => {
  try {
    // platform admin 限定（workspace owner は不可）。
    if (!isPlatformOwner(user.id)) return forbidden();

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const sort = (url.searchParams.get("sort") ?? "created_desc") as SortKey;
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE));

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      // 設定不足時は空一覧で返す（UI は空状態を表示）。鍵などの秘匿情報は一切返さない。
      return ok({ items: [], total: 0, page, per_page: perPage, total_pages: 0, supabase_configured: false });
    }

    // ── Supabase Auth から全ユーザーを取得（server-only） ──
    // 現状: 全件取得 → DB マージ → メモリで検索/ソート/ページング（= 画面上でページング）。
    //   検索・ソートを横断的に効かせるための割り切り。ユーザー数が少ない前提では問題なし。
    // TODO(将来): Supabase Auth のユーザーが増えてきたら、ページ単位取得（admin.listUsers の page/perPage を
    //   そのままレスポンスのページに対応させ、当該ページ分だけ DB マージする方式）へ変更する。
    //   ※その場合、検索/ソートは Supabase 側の制約上クライアント横断ではなく per-page になる点に注意。
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const all: SupaUser[] = [];
    for (let p = 1; p <= MAX_FETCH_PAGES; p++) {
      const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: FETCH_PER_PAGE });
      if (error) throw error;
      const users = (data?.users ?? []) as SupaUser[];
      all.push(...users);
      if (users.length < FETCH_PER_PAGE) break;
    }

    // ── DB マージ用集計（user id 紐づけ） ──
    const ids = all.map((u) => u.id);
    const [profiles, ownerMemberships] = await Promise.all([
      prisma.profile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, username: true, lastName: true, firstName: true, companyName: true },
      }),
      prisma.workspaceMember.findMany({
        where: { userId: { in: ids }, role: "owner", status: "active" },
        select: { userId: true, workspaceId: true },
      }),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    // 所有 OA 数 + 所有 OA 配下の作品数。
    const oaCountByUser = new Map<string, number>();
    const ownedOaIdsByUser = new Map<string, string[]>();
    for (const m of ownerMemberships) {
      oaCountByUser.set(m.userId, (oaCountByUser.get(m.userId) ?? 0) + 1);
      const arr = ownedOaIdsByUser.get(m.userId) ?? [];
      arr.push(m.workspaceId);
      ownedOaIdsByUser.set(m.userId, arr);
    }
    const ownedOaIds = Array.from(new Set(ownerMemberships.map((m) => m.workspaceId)));
    const workCountByOa = new Map<string, number>();
    if (ownedOaIds.length > 0) {
      const grouped = await prisma.work.groupBy({ by: ["oaId"], where: { oaId: { in: ownedOaIds } }, _count: { _all: true } });
      for (const g of grouped) workCountByOa.set(g.oaId, g._count._all);
    }

    // ── 行データ構築 ──
    const rows = all.map((u) => {
      const prof = profileByUser.get(u.id);
      const metaName = metaStr(u.user_metadata ?? null, "display_name", "name", "full_name");
      const metaAvatar = metaStr(u.user_metadata ?? null, "avatar_url", "picture", "avatar");
      const currentName = prof?.username ?? metaName ?? null;
      const oaIds = ownedOaIdsByUser.get(u.id) ?? [];
      const workCount = oaIds.reduce((s, oaId) => s + (workCountByOa.get(oaId) ?? 0), 0);
      return {
        id:               u.id,
        name:             currentName,
        email:            u.email ?? null,
        image:            metaAvatar,
        // Supabase 登録情報（厳密な不変履歴ではなく、現在 Supabase/Profile に残る登録由来情報）
        meta_name:        metaName,
        meta_email:       u.email ?? null,
        meta_avatar:      metaAvatar,
        provider:         resolveProvider(u),
        last_name:        prof?.lastName ?? null,
        first_name:       prof?.firstName ?? null,
        company_name:     prof?.companyName ?? null,
        created_at:       u.created_at ?? null,
        last_sign_in_at:  u.last_sign_in_at ?? null,
        oa_count:         oaCountByUser.get(u.id) ?? 0,
        work_count:       workCount,
      };
    });

    // ── 検索（user id / email / name / username / metaName） ──
    const filtered = q
      ? rows.filter((r) =>
          r.id.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.meta_name ?? "").toLowerCase().includes(q))
      : rows;

    // ── 並び替え（null は末尾） ──
    const ts = (v: string | null) => (v ? new Date(v).getTime() : NaN);
    filtered.sort((a, b) => {
      if (sort === "created_asc")  return ts(a.created_at) - ts(b.created_at);
      if (sort === "login_desc" || sort === "login_asc") {
        const av = ts(a.last_sign_in_at), bv = ts(b.last_sign_in_at);
        const aNan = isNaN(av), bNan = isNaN(bv);
        if (aNan && bNan) return 0;
        if (aNan) return 1;   // null は常に末尾
        if (bNan) return -1;
        return sort === "login_desc" ? bv - av : av - bv;
      }
      // created_desc（既定）
      return ts(b.created_at) - ts(a.created_at);
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage);

    return ok({ items, total, page, per_page: perPage, total_pages: totalPages, supabase_configured: true });
  } catch (err) {
    return serverError(err);
  }
});
