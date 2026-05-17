import { AccountClient } from "./AccountClient";
import { prisma } from "@/lib/prisma";
import type { PublishStatus } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
};

export default async function OaAccountPage({ params }: PageProps) {
  const oa = await prisma.oa.findUnique({
    where: { id: params.id },
    select: {
      title: true,
      description: true,
      channelId: true,
      channelSecret: true,
      channelAccessToken: true,
      publishStatus: true,
    },
  });

  return (
    <AccountClient
      oaId={params.id}
      initialOaTitle={oa?.title ?? ""}
      initialForm={oa ? {
        title: oa.title,
        description: oa.description ?? "",
        channel_id: oa.channelId,
        channel_secret: oa.channelSecret,
        channel_access_token: oa.channelAccessToken,
        publish_status: oa.publishStatus as PublishStatus,
      } : null}
      initialError={oa ? null : "OAが見つかりません"}
    />
  );
}
