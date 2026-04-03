"use client";

// src/hooks/useTesterMode.ts
//
// テスターモード判定フック。
// `/tester/[oaId]` に入ったとき sessionStorage に testerOaId がセットされる。
// `/oas/` 配下のページでもこの値を読むことで tester 由来かどうかを判定できる。
//
// β版のため認証不要。URL ベース + sessionStorage による簡易制御。

import { useEffect, useState } from "react";

export function useTesterMode() {
  const [testerOaId, setTesterOaId] = useState<string | null>(null);

  useEffect(() => {
    // sessionStorage はブラウザ専用 API のため useEffect 内で読む
    const val = sessionStorage.getItem("testerOaId");
    if (val) setTesterOaId(val);
  }, []);

  return {
    /** テスターセッション中かどうか */
    isTester: testerOaId !== null,
    /** テスターがアクセスを許可された OA ID */
    testerOaId,
  };
}
