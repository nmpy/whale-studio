// src/app/tester/[oaId]/layout.tsx
//
// テスターポータル用レイアウト。
// サーバーサイドで OA の存在を確認し、不正な oaId の場合は 404 を返す。
// ログイン・権限管理は β 版のため省略。URL ベースの制限のみ。

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TesterModeActivator from "./TesterModeActivator";

export default async function TesterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { oaId: string };
}) {
  // OA の存在確認（存在しない oaId へのアクセスは 404）
  // try-catch で Prisma 接続エラー等をキャッチして 500 ページを防ぐ
  let oa: { id: string } | null = null;
  try {
    oa = await prisma.oa.findUnique({
      where:  { id: params.oaId },
      select: { id: true },
    });
  } catch (err) {
    console.error("[TesterLayout] prisma.oa.findUnique エラー:", err);
    // DB 接続失敗時は 404 として処理（情報漏洩防止）
    notFound();
  }

  if (!oa) {
    notFound();
  }

  return (
    <>
      {/* sessionStorage に testerOaId をセット。/oas/ 配下ページでも tester 判定が効く */}
      <TesterModeActivator oaId={params.oaId} />
      {children}
    </>
  );
}
