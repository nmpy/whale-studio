// src/components/upgrade/TesterUpgradeCard.tsx
// ⚠️ 後方互換 re-export シム（Phase 5 でリネーム済み）
// 新規コードでは WorkLimitCard を直接 import してください。
//
//   import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";

export { WorkLimitCard as TesterUpgradeCard } from "./WorkLimitCard";
export type { WorkLimitCardProps as TesterUpgradeCardProps } from "./WorkLimitCard";
