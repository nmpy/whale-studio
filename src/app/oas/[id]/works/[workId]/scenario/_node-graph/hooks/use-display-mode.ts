// _node-graph/hooks/use-display-mode.ts — 表示モード Context（標準 / コンパクト）

"use client";

import { createContext, useContext } from "react";

export type DisplayMode = "standard" | "compact";

export const DisplayModeContext = createContext<DisplayMode>("standard");

export function useDisplayMode(): DisplayMode {
  return useContext(DisplayModeContext);
}
