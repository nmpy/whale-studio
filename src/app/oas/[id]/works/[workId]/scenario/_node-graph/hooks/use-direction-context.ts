// _node-graph/hooks/use-direction-context.ts — レイアウト方向 Context

"use client";

import { createContext, useContext } from "react";
import type { LayoutDirection } from "../layout/dagre-layout";

export const DirectionContext = createContext<LayoutDirection>("TB");

export function useDirection(): LayoutDirection {
  return useContext(DirectionContext);
}
