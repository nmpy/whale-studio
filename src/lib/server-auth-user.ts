import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export type ServerAuthUser = { id: string; email?: string };

export async function getServerAuthUser(): Promise<ServerAuthUser | null> {
  const bypassRaw = process.env.BYPASS_AUTH;
  const bypassOn =
    bypassRaw?.trim().toLowerCase() === "true" &&
    process.env.NODE_ENV !== "production";

  if (bypassOn) return { id: "bypass-admin" };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return process.env.NODE_ENV === "development" ? { id: "dev-user" } : null;
  }

  const cookieStore = cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll() {
        // Server Components cannot persist refreshed cookies; middleware handles refresh.
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
