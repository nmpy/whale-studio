// src/app/oas/[id]/live/admin/page.tsx
// Whale Studio Live for Admin — Phase 2-A 仮UI。
// Server Component で section ガード → 中身は LiveAdminClient。
//
// Phase 2-K: ?workId=xxx を受け取り、対象作品を固定する導線をサポートする。
// 渡された workId が同 OA 配下の Work でなければ無視 (= 通常モードで起動)。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { prisma } from "@/lib/prisma";
import { LiveAdminClient } from "./LiveAdminClient";

export const dynamic = "force-dynamic";

export default async function LiveAdminPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { workId?: string };
}) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "admin"))) {
    notFound();
  }

  // Phase 2-K: workId が指定されていれば同 OA 配下か検証 (= OA 外なら無視)。
  //            title も同時に取得して client に prop で渡す (= 「作品名取得中...」を回避)。
  let lockedWorkId:    string | null = null;
  let lockedWorkTitle: string | null = null;
  if (searchParams.workId) {
    const work = await prisma.work.findFirst({
      where:  { id: searchParams.workId, oaId: params.id },
      select: { id: true, title: true },
    });
    if (work) {
      lockedWorkId    = work.id;
      lockedWorkTitle = work.title;
    }
  }

  return (
    <LiveAdminClient
      oaId={params.id}
      lockedWorkId={lockedWorkId}
      lockedWorkTitle={lockedWorkTitle}
    />
  );
}
