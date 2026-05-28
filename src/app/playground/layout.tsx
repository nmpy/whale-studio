// src/app/playground/layout.tsx
// onboarding ガードを掛ける Server Component layout。

import { enforceOnboarding } from "@/lib/onboarding-guard";

export default async function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  await enforceOnboarding("/playground");
  return <>{children}</>;
}
