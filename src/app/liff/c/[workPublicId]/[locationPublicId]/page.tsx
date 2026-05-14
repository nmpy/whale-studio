"use client";

// src/app/liff/c/[workPublicId]/[locationPublicId]/page.tsx
//
// 短縮チェックイン URL。
// 例: /liff/c/a7k3m9qx/b2c4d6f8 (workPublicId=a7k3m9qx, locationPublicId=b2c4d6f8)
//
// 内部的には旧来のチェックインフロー (/liff?work_id=X&location_id=Y) と同じ UI を使う。
// publicId のまま query string に詰めて /liff へ replace する。
// /liff 側の API resolver が UUID / publicId のどちらでも受け付けるよう対応済み。

import { useEffect } from "react";
import { useParams } from "next/navigation";

export default function ShortCheckinRedirect() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  const locationPublicId = params.locationPublicId as string;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!workPublicId || !locationPublicId) return;
    // /liff?work_id=X&location_id=Y にリダイレクトしてチェックイン UI を起動。
    // 既存の location_id / work_id query は API resolver が publicId としても受け付ける。
    const url = `/liff?work_id=${encodeURIComponent(workPublicId)}&location_id=${encodeURIComponent(locationPublicId)}${window.location.hash}`;
    window.location.replace(url);
  }, [workPublicId, locationPublicId]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "24px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      color: "#6b7280",
    }}>
      <p>チェックイン画面を読み込み中...</p>
    </div>
  );
}
