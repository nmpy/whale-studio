"use client";

// src/hooks/useWorkScopedLiff.ts
//
// 対象 Work に紐づく **OA 固有の LIFF ID** で LIFF SDK を初期化するフック。
//
// なぜ必要か:
//   LINE のユーザー ID はプロバイダー単位でスコープされる。全 OA 共通の
//   NEXT_PUBLIC_LIFF_ID で init すると、対象 OA の Messaging チャネルと別プロバイダーの
//   ログインチャネルでトークンが発行され、得られる lineUserId がその OA で解決できない。
//   結果 GET /v2/bot/profile/{userId} が 404 となり、友だち追加済みでも
//   「友だち追加してください」になる。→ Work → OA → Oa.liffId で init する。
//
// 解決順はサーバー（/api/liff/config）が決める:
//   1. Oa.liffId              → liffIdSource="oa"
//   2. Oa.liffId が NULL のみ → NEXT_PUBLIC_LIFF_ID（liffIdSource="env"・レガシー互換）
//   3. どちらも無い           → liffIdSource="none" → 設定エラー
// クライアントはこの結果を解釈するだけで、env を読んで上書きしない
// （古いビルドに焼き込まれた値で誤初期化しないため）。
//
// 初期化順序:
//   config 取得が終わるまで useLiffSDK には null を渡し、**liff.init() を実行しない**。
//   「共通 ID で仮初期化してから正しい ID で再初期化」はしない。

import { useEffect, useState } from "react";
import { useLiffSDK, type LiffSDKState } from "@/hooks/useLiffSDK";
import {
  resolveRuntimeLiffId,
  toUseLiffSdkArg,
  type RuntimeLiffIdResolution,
} from "@/lib/liff/runtime-liff-id";

export interface WorkScopedLiffState {
  liff: LiffSDKState;
  /** config 取得中（liff.init 未実行）。 */
  resolving: boolean;
  /** LIFF ID を決められなかった（init しない）。呼び出し側で設定エラーを表示する。 */
  notConfigured: boolean;
  /** Oa.liffId が無く env へフォールバックした（レガシー Work）。運用可視化用。 */
  isLegacyEnvFallback: boolean;
  /** LIFF URL (https://liff.line.me/{liffId}/...) 組み立て専用の LIFF ID。
   *  **Oa.liffId で解決できたときだけ** string。env フォールバック時は null。
   *  （env は NEXT_PUBLIC_LIFF_ID = テスト用チャネルなので、URL にすると混線する） */
  liffIdForUrl: string | null;
}

/**
 * @param workIdOrPublicId Work の UUID / publicId のどちらでも可
 *   （/api/liff/config が両方を解決する）。
 */
export function useWorkScopedLiff(workIdOrPublicId: string): WorkScopedLiffState {
  const [resolution, setResolution] = useState<RuntimeLiffIdResolution | null>(null);

  useEffect(() => {
    if (!workIdOrPublicId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/liff/config?workId=${encodeURIComponent(workIdOrPublicId)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        setResolution(resolveRuntimeLiffId(json?.data));
      } catch {
        // 通信失敗も「決められない」として扱う（誤った ID では初期化しない）。
        if (!cancelled) setResolution({ kind: "not_configured", reason: "missing" });
      }
    })();
    return () => { cancelled = true; };
  }, [workIdOrPublicId]);

  // 未解決の間は null（= init しない）。解決後に string が渡って初めて init される。
  const liff = useLiffSDK(toUseLiffSdkArg(resolution));

  return {
    liff,
    resolving:     resolution === null,
    notConfigured: resolution?.kind === "not_configured",
    isLegacyEnvFallback: resolution?.kind === "ready" && resolution.isLegacyEnvFallback,
    // LIFF URL (https://liff.line.me/{liffId}/...) を組み立てる用途の LIFF ID。
    // ⚠️ **source="oa" のときだけ** 返す。env フォールバック (NEXT_PUBLIC_LIFF_ID) は
    //    テスト用チャネルの LIFF なので、これで URL を作るとプレイヤーが別 OA の
    //    LIFF に飛ぶ（= 混線）。init 自体は互換のため env でも通すが、URL 生成には使わない。
    liffIdForUrl:
      resolution?.kind === "ready" && resolution.source === "oa" ? resolution.liffId : null,
  };
}
