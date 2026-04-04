"use client";

// src/hooks/useIsMobile.ts
// 430px 以下を「スマートフォン」と判定するフック。
// SSR では false を返し、クライアントマウント後に正しい値に切り替わる。

import { useState, useEffect } from "react";

export function useIsMobile(breakpoint = 430): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}
