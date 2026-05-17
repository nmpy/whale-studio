import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getServerAuthUser } from "@/lib/server-auth-user";
import type { Role } from "@/lib/types/permissions";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoSansJP = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto" });

export const metadata: Metadata = {
  title: "Whale Studio",
  description: "LINEで物語体験をつくるスタジオ",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Whale Studio",
    description: "LINEで物語体験をつくるスタジオ",
    url: "https://whale-studio.app", // 本番URLに合わせて変更してください
    siteName: "Whale Studio",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Whale Studio",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whale Studio",
    description: "LINEで物語体験をつくるスタジオ",
    images: ["/og.png"],
  },
};

type InitialShellRoleState = {
  initialIsAnyOaOwner: boolean;
  initialDefaultWorkspaceRole: Role | null;
  initialWorkspaceRoles: Record<string, Role>;
};

async function getInitialShellRoleState(): Promise<InitialShellRoleState> {
  const user = await getServerAuthUser();
  if (!user) {
    return {
      initialIsAnyOaOwner: false,
      initialDefaultWorkspaceRole: null,
      initialWorkspaceRoles: {},
    };
  }

  const isDevOwner =
    process.env.NODE_ENV === "development"
    && !process.env.NEXT_PUBLIC_SUPABASE_URL
    && (user.id === "bypass-admin" || user.id === "dev-user");

  if (isPlatformOwner(user.id) || isDevOwner) {
    return {
      initialIsAnyOaOwner: true,
      initialDefaultWorkspaceRole: "owner",
      initialWorkspaceRoles: {},
    };
  }

  const [members, ownerKeyOas] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: {
        userId: user.id,
        status: "active",
      },
      select: {
        workspaceId: true,
        role: true,
      },
    }),
    prisma.oa.findMany({
      where: { ownerKey: user.id },
      select: { id: true },
    }).catch(() => []),
  ]);

  const initialWorkspaceRoles: Record<string, Role> = {};
  for (const member of members) {
    initialWorkspaceRoles[member.workspaceId] = member.role as Role;
  }
  for (const oa of ownerKeyOas) {
    initialWorkspaceRoles[oa.id] = "owner";
  }

  return {
    initialIsAnyOaOwner: Object.values(initialWorkspaceRoles).includes("owner"),
    initialDefaultWorkspaceRole: null,
    initialWorkspaceRoles,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const {
    initialIsAnyOaOwner,
    initialDefaultWorkspaceRole,
    initialWorkspaceRoles,
  } = await getInitialShellRoleState();

  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body>
        <ToastProvider>
          {/* CMS では <AppHeader /> + container を被せ、/liff/* ではどちらも被せない。
              詳細は AppShell.tsx を参照。 */}
          <AppShell
            initialIsAnyOaOwner={initialIsAnyOaOwner}
            initialDefaultWorkspaceRole={initialDefaultWorkspaceRole}
            initialWorkspaceRoles={initialWorkspaceRoles}
          >
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
