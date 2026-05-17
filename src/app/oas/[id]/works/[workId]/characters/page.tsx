import { Prisma } from "@prisma/client";
import { CharactersClient } from "./CharactersClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import type { Character } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string; workId: string };
};

function formatCharacter(c: {
  id: string; workId: string; name: string; iconType: string; iconText: string | null;
  iconImageUrl: string | null; iconColor: string | null; sortOrder: number; isActive: boolean;
  createdAt: Date; updatedAt: Date;
}): Character {
  return {
    id: c.id,
    work_id: c.workId,
    name: c.name,
    icon_type: c.iconType as Character["icon_type"],
    icon_text: c.iconText,
    icon_image_url: c.iconImageUrl,
    icon_color: c.iconColor,
    sort_order: c.sortOrder,
    is_active: c.isActive,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

async function loadInitialData(oaId: string, workId: string) {
  const user = await getServerAuthUser();
  if (!user) return { workTitle: "", systemCharId: null, characters: [], error: "ログインが必要です" };

  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { id: true, oaId: true, title: true, systemCharacterId: true },
  });
  if (!work || work.oaId !== oaId) {
    return { workTitle: "", systemCharId: null, characters: [], error: "作品が見つかりません" };
  }

  if (!isPlatformOwner(user.id)) {
    const member = await getWorkspaceRole(oaId, user.id);
    if (!member || member.status !== "active") {
      return { workTitle: work.title, systemCharId: work.systemCharacterId, characters: [], error: "このワークスペースへのアクセス権がありません" };
    }
  }

  const characters = await prisma.character.findMany({
    where: { workId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return {
    workTitle: work.title,
    systemCharId: work.systemCharacterId,
    characters: characters.map(formatCharacter),
    error: null,
  };
}

export default async function WorkCharacterListPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id, params.workId);
    return (
      <CharactersClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle={initial.workTitle}
        initialSystemCharId={initial.systemCharId}
        initialCharacters={initial.characters}
        initialError={initial.error}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/characters] Prisma error", err.code, err.meta);
    } else {
      console.error("[/characters] SSR load failed", err);
    }
    return (
      <CharactersClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle=""
        initialSystemCharId={null}
        initialCharacters={[]}
        initialError="読み込みに失敗しました"
      />
    );
  }
}
