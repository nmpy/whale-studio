import { SettingsClient } from "./SettingsClient";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
};

export default async function OaSettingsPage({ params }: PageProps) {
  const oa = await prisma.oa.findUnique({
    where: { id: params.id },
    select: { title: true },
  });

  return <SettingsClient oaId={params.id} initialOaTitle={oa?.title ?? ""} />;
}
