"use client";

// src/app/liff/r/[slotToken]/page.tsx
//
// 人狼モード — プレイヤーが QR で開く配役閲覧専用 URL。
// 例: /liff/r/a3b9c2d8e1
//
// 設計:
//   - 短縮 URL (10 文字) で QR 密度を抑える
//   - LIFF SDK 初期化 → /api/liff/werewolf/slots/[slotToken] を fetch
//   - サーバー側で is_started=false の場合は cards が空 → 「開始までお待ちください」表示
//   - プレイヤー側 LINE UID は紐付け不要 (Phase 1 仕様)
//
// マイページ (LocalStorage 履歴) との連携は Phase 3 で実装する。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { WerewolfRoleViewer, type RoleViewerData } from "@/components/liff/WerewolfRoleViewer";

interface ApiResponse {
  success: boolean;
  data?:   RoleViewerData;
  error?:  { code?: string; message?: string };
}

export default function WerewolfRoleViewerPage() {
  const params = useParams();
  const slotToken = params.slotToken as string;
  const liff = useLiffSDK();

  const [data, setData] = useState<RoleViewerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!liff.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/liff/werewolf/slots/${slotToken}`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!json.success || !json.data) {
          setError(json.error?.message ?? "配役を読み込めませんでした");
          return;
        }
        setData(json.data);
      } catch {
        if (!cancelled) setError("サーバーに接続できませんでした");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slotToken, liff.ready]);

  if (liff.loading || loading) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center px-4">
        <div className="text-center">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
            style={{
              borderColor: "var(--liff-border)",
              borderTopColor: "var(--liff-line-green, #06C755)",
            }}
          />
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center p-4">
        <div className="bg-[color:var(--liff-surface)] rounded-[12px] px-4 py-6 border border-[color:var(--liff-border)] text-center max-w-sm w-full">
          <p className="text-4xl mb-3" aria-hidden="true">😢</p>
          <h2 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">配役が見つかりませんでした</h2>
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">
            {error ?? "URL が正しいか確認してください。GM にお問い合わせください。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <WerewolfRoleViewer
      data={data}
      onClose={liff.closeWindow}
    />
  );
}
