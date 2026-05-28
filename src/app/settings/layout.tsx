// src/app/settings/layout.tsx
// onboarding ガードを掛ける Server Component layout。

import { enforceOnboarding } from "@/lib/onboarding-guard";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await enforceOnboarding("/settings");
  return <>{children}</>;
}
