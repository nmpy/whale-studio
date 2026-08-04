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
  /** LINE ユーザーID（ログイン済みの場合）。※ client 取得値。サーバー検証には
   *  accessToken を POST /api/liff/session に渡して lineUserId を取り直すこと。 */
  lineUserId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** LIFF アクセストークン（ログイン済みの場合）。POST /api/liff/session に渡してサーバー検証する。 */
  accessToken: string | null;
  /** エラーメッセージ（初期化失敗時） */
  error: string | null;
  /** LIFF ウィンドウを閉じる */
  closeWindow: () => void;
}

/**
 * LIFF SDK を初期化し、ログイン状態とプロフィールを取得する。
 *
 * @param liffId - 初期化に使う LIFF アプリ ID。3 状態を区別する:
 *   - `string`    … その LIFF ID で init する（OA 固有ページはこれを使う）
 *   - `null`      … **解決待ち**。init を実行せず、liffId が確定するまで待つ。
 *                   誤った LIFF ID での仮初期化 → 再初期化を防ぐための状態。
 *   - `undefined` … **レガシー経路専用**。NEXT_PUBLIC_LIFF_ID へフォールバックする。
 *                   OA 固有ページ（/liff/w 配下）からは使わないこと。
 *                   env は全 OA 共通のため、対象 OA と別プロバイダーのログインチャネルで
 *                   init され、lineUserId が対象 OA で解決できなくなる（友だち判定が 404 になる）。
 *
 * @example
 * // レガシー（/liff/r/[slotToken] など env 依存のまま残す経路）
 * const liff = useLiffSDK();
 * // OA 固有ページ: config API で解決してから渡す（未解決の間は null）
 * const liff = useLiffSDK(resolvedLiffId);
 */
export function useLiffSDK(liffId?: string | null): LiffSDKState {
  const [state, setState] = useState<LiffSDKState>({
    ready: false,
    loading: true,
    isInClient: false,
    lineUserId: null,
    displayName: null,
    accessToken: null,
    error: null,
    closeWindow: () => {},
  });
  const initialized = useRef(false);

  useEffect(() => {
    // liffId === null は「まだ解決できていない」。init せずに待つ（誤 ID での仮初期化を防ぐ）。
    // 解決後に string が渡ると、この effect が再実行されて初めて init する。
    if (liffId === null) return;
    if (initialized.current) return;
    initialized.current = true;

    // undefined のときだけ env へフォールバックする（レガシー経路専用）。
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
        const isLoggedIn = liff.isLoggedIn();

        // LINE クライアント内では LIFF にログイン済みのことが多いが、念のため未ログインなら login() を呼ぶ。
        // 外部ブラウザでは login() を呼ぶと LINE の OAuth ページにリダイレクトされ、
        // 「実機確認用ブラウザ URL」で開いただけのユーザーが混乱するため auto-login しない。
        // (外部ブラウザでも UID が必要な操作は呼び出し側で個別にハンドリングする想定)
        if (inClient && !isLoggedIn) {
          liff.login({ redirectUri: window.location.href });
          return; // リダイレクトされるので state 更新不要
        }

        if (isLoggedIn) {
          const profile = await liff.getProfile();
          let accessToken: string | null = null;
          try { accessToken = liff.getAccessToken(); } catch { accessToken = null; }
          setState({
            ready: true,
            loading: false,
            isInClient: inClient,
            lineUserId: profile.userId,
            displayName: profile.displayName,
            accessToken,
            error: null,
            closeWindow: () => {
              if (inClient) {
                liff.closeWindow();
              }
            },
          });
        } else {
          // 未ログイン (外部ブラウザでの確認用) — ページの描画は許可し、UID は null のまま。
          setState({
            ready: true,
            loading: false,
            isInClient: inClient,
            lineUserId: null,
            displayName: null,
            accessToken: null,
            error: null,
            closeWindow: () => {},
          });
        }
      } catch (err) {
        console.error("[LIFF] 初期化失敗:", err);
        // init 自体に失敗しても画面を真っ白にしない。プレビュー用途を優先。
        setState((prev) => ({
          ...prev,
          ready: true,
          loading: false,
          isInClient: false,
          error: "LIFF を初期化できませんでした。LINE アプリ内で開くとすべての機能をご利用いただけます。",
        }));
      }
    })();
  }, [liffId]);

  return state;
}
