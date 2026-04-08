"use client";

// src/hooks/useLiffSDK.ts
// LIFF SDK の初期化・認証・プロフィール取得を隠蔽するカスタムフック。
// useWorkspaceRole と同様、{ ... state, loading } を返す。

import { useEffect, useState, useRef } from "react";

export interface LiffSDKState {
  /** LIFF SDK 初期化完了かどうか */
  ready: boolean;
  /** 初期化中 */
  loading: boolean;
  /** LIFF アプリ内ブラウザかどうか */
  isInClient: boolean;
  /** LINE ユーザーID（ログイン済みの場合） */
  lineUserId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** エラーメッセージ（初期化失敗時） */
  error: string | null;
  /** LIFF ウィンドウを閉じる */
  closeWindow: () => void;
}

/**
 * LIFF SDK を初期化し、ログイン状態とプロフィールを取得する。
 *
 * @param liffId - LIFF アプリ ID（未指定なら NEXT_PUBLIC_LIFF_ID を使用）
 *
 * @example
 * const { lineUserId, isInClient, ready, error } = useLiffSDK();
 */
export function useLiffSDK(liffId?: string): LiffSDKState {
  const [state, setState] = useState<LiffSDKState>({
    ready: false,
    loading: true,
    isInClient: false,
    lineUserId: null,
    displayName: null,
    error: null,
    closeWindow: () => {},
  });
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const id = liffId ?? process.env.NEXT_PUBLIC_LIFF_ID;

    if (!id) {
      console.warn("[LIFF] NEXT_PUBLIC_LIFF_ID が未設定です");
      setState((prev) => ({
        ...prev,
        ready: true,
        loading: false,
        isInClient: false,
        error: null, // 開発環境では LIFF なしでも動作させる
      }));
      return;
    }

    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: id });

        const inClient = liff.isInClient();

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return; // リダイレクトされるので state 更新不要
        }

        const profile = await liff.getProfile();

        setState({
          ready: true,
          loading: false,
          isInClient: inClient,
          lineUserId: profile.userId,
          displayName: profile.displayName,
          error: null,
          closeWindow: () => {
            if (inClient) {
              liff.closeWindow();
            }
          },
        });
      } catch (err) {
        console.error("[LIFF] 初期化失敗:", err);
        setState((prev) => ({
          ...prev,
          ready: true,
          loading: false,
          isInClient: false,
          error: "LINEアプリ内で開くとすべての機能をご利用いただけます",
        }));
      }
    })();
  }, [liffId]);

  return state;
}
