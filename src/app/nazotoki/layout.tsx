// src/app/nazotoki/layout.tsx
// onboarding ガードを掛ける Server Component layout。

import { enforceOnboarding } from "@/lib/onboarding-guard";

export default async function NazotokiLayout({ children }: { children: React.ReactNode }) {
  await enforceOnboarding("/nazotoki");
  return <>{children}</>;
}
