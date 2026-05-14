"use client";

// src/components/liff/LiffPlayerContext.tsx
// LIFF プレイヤー画面のレンダラー階層に渡す共有コンテキスト。
// 主に各ブロック (button / accordion / faq row 等) から
// 計測イベント送信時に workId / pageId / lineUserId を引くために使う。

import { createContext, useContext } from "react";

interface LiffPlayerContextValue {
  workId:     string;
  /** publicId でなく UUID が望ましいが、resolver があるためどちらでも記録できる */
  pageId?:    string;
  lineUserId?: string | null;
  /** プレビュー中は計測しない */
  preview?:   boolean;
}

const LiffPlayerContext = createContext<LiffPlayerContextValue | null>(null);

export function LiffPlayerProvider({
  value,
  children,
}: {
  value: LiffPlayerContextValue;
  children: React.ReactNode;
}) {
  return <LiffPlayerContext.Provider value={value}>{children}</LiffPlayerContext.Provider>;
}

export function useLiffPlayerContext(): LiffPlayerContextValue | null {
  return useContext(LiffPlayerContext);
}
