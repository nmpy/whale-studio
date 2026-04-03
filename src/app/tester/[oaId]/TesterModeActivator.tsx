"use client";

// src/app/tester/[oaId]/TesterModeActivator.tsx
//
// テスターセッションを sessionStorage に記録するクライアントコンポーネント。
// layout.tsx（サーバーコンポーネント）から呼ばれる。
// `/tester/[oaId]` に入った瞬間に `testerOaId` をセットし、
// `/oas/` 配下のページに遷移しても useTesterMode() が true を返せるようにする。

import { useEffect } from "react";

export default function TesterModeActivator({ oaId }: { oaId: string }) {
  useEffect(() => {
    sessionStorage.setItem("testerOaId", oaId);
  }, [oaId]);

  // 描画なし（セッション書き込みのみ）
  return null;
}
