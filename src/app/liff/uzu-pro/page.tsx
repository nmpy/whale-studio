"use client";

// src/app/liff/uzu-pro/page.tsx
// プレイヤー招待用の専用 LIFF URL（/liff/uzu-pro?t=<token>）で開く LINE アカウント連携ページ。
//   1. token（?t=）で resolve API を叩き、リンクが active か・liffId を取得。
//   2. LIFF SDK を初期化し、未ログインなら liff.login（redirectUri=現 URL で token を保持）。
//   3. liff.getIDToken() を取得し、bind-line API へ送信。サーバーが ID Token を検証して
//      lineUserId を確定し、プレイヤーへ連携する。
//
//   セキュリティ/UX:
//     - idToken / LINE User ID は画面・console・監視ログへ絶対に出さない。
//     - クライアントからは { idToken } のみ送信（lineUserId / displayName / playerId は送らない）。
//     - エラー文言は一般化し、内部情報（プレイヤー/予約データ）を出さない。
//     - useSearchParams を使うため <Suspense> でラップする。

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LiffExperienceShell, LiffResultState } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";

// resolve API のリンク状態。active のみ連携に進める。
type ResolveState = "active" | "not_found" | "revoked" | "expired";

// bind-line API が返す status。
type BindStatus =
  | "linked"
  | "already_linked"
  | "conflict_other_account"
  | "conflict_booking_duplicate"
  | "not_found"
  | "revoked"
  | "expired"
  | "line_auth_failed"
  | "line_unavailable"
  | "invalid_code"
  | "id_token_required"
  | "bad_request";

type State =
  | { step: "loading" }
  | { step: "success" }
  | { step: "error"; code: ErrorCode; retry: boolean };

// ユーザー向けの一般化エラーコード（内部情報は含めない）。
type ErrorCode =
  | "invalid_link"          // token 欠落 / resolve が active でない / 利用不可な status
  | "conflict_other_account"
  | "conflict_booking_duplicate"
  | "line_unavailable"      // 一時障害（再試行可）
  | "line_auth"             // LINE 認証失敗
  | "unknown";

const ERROR_COPY: Record<ErrorCode, { title: string; description: string }> = {
  invalid_link: {
    title: "このリンクは利用できません",
    description: "このURLは現在利用できません。最新の案内をご確認ください。",
  },
  conflict_other_account: {
    title: "すでに連携済みです",
    description: "このプレイヤーは、すでに別のLINEアカウントと連携されています。運営へお問い合わせください。",
  },
  conflict_booking_duplicate: {
    title: "すでに連携済みです",
    description: "このプレイヤーはすでに連携されています。ご不明な場合は、運営までお問い合わせください。",
  },
  line_unavailable: {
    title: "時間をおいてお試しください",
    description: "時間をおいて、もう一度お試しください。",
  },
  line_auth: {
    title: "LINE認証に失敗しました",
    description: "LINE認証に失敗しました。開き直してもう一度お試しください。",
  },
  unknown: {
    title: "エラーが発生しました",
    description: "このURLは現在利用できません。最新の案内をご確認ください。",
  },
};

// bind-line の status → 画面状態へのマッピング。
function mapBindStatus(status: BindStatus, retryable: boolean): State {
  switch (status) {
    case "linked":
    case "already_linked":
      return { step: "success" };
    case "conflict_other_account":
      return { step: "error", code: "conflict_other_account", retry: false };
    case "conflict_booking_duplicate":
      return { step: "error", code: "conflict_booking_duplicate", retry: false };
    case "not_found":
    case "revoked":
    case "expired":
    case "invalid_code":
      return { step: "error", code: "invalid_link", retry: false };
    case "line_unavailable":
      return { step: "error", code: "line_unavailable", retry: retryable };
    case "line_auth_failed":
    case "id_token_required":
      return { step: "error", code: "line_auth", retry: false };
    case "bad_request":
    default:
      return { step: "error", code: "unknown", retry: false };
  }
}

function UzuProLinkView() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>({ step: "loading" });
  // 二重実行防止（LIFF 初期化 → bind は非同期に多段のため）。
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState({ step: "loading" });
    try {
      const t = searchParams.get("t");
      if (!t) {
        setState({ step: "error", code: "invalid_link", retry: false });
        return;
      }

      // ── 1. resolve: リンク状態 + liffId ──
      let liffId: string | null = null;
      try {
        const res = await fetch(`/api/liff/player-links/${encodeURIComponent(t)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const json = await res.json().catch(() => null);
        const resolveState: ResolveState | undefined = json?.data?.state;
        if (!res.ok || !json?.success || resolveState !== "active" || !json.data?.liffId) {
          setState({ step: "error", code: "invalid_link", retry: false });
          return;
        }
        liffId = json.data.liffId as string;
      } catch {
        setState({ step: "error", code: "line_unavailable", retry: true });
        return;
      }

      // ── 2. LIFF 初期化 → 未ログインなら login（現 URL 保持でリダイレクト） ──
      let idToken: string | null = null;
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          // ?t= を保持したまま LINE ログインへ。戻ると同じ画面が再描画される。
          // （LINE アプリ内ブラウザでも動作する）。
          liff.login({ redirectUri: typeof window !== "undefined" ? window.location.href : undefined });
          return; // ここで離脱（リダイレクト）
        }
        idToken = liff.getIDToken();
      } catch {
        setState({ step: "error", code: "line_auth", retry: false });
        return;
      }
      if (!idToken) {
        // ID Token が取れない = 認証情報不足。開き直しで再取得を促す。
        setState({ step: "error", code: "line_auth", retry: false });
        return;
      }

      // ── 3. bind-line: { idToken } のみ送信 ──
      let res: Response;
      try {
        res = await fetch(`/api/liff/player-links/${encodeURIComponent(t)}/bind-line`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
      } catch {
        setState({ step: "error", code: "line_unavailable", retry: true });
        return;
      }
      const json = await res.json().catch(() => null);
      const status: BindStatus | undefined = json?.status;
      if (!status) {
        setState({ step: "error", code: "unknown", retry: false });
        return;
      }
      setState(mapBindStatus(status, json?.retryable === true));
    } finally {
      runningRef.current = false;
    }
  }, [searchParams]);

  useEffect(() => {
    void run();
  }, [run]);

  // ── loading ──
  if (state.step === "loading") {
    return (
      <LiffExperienceShell>
        <LiffResultState
          variant="loading"
          title="LINE連携を確認しています"
          description="このまま少しだけお待ちください。"
        />
      </LiffExperienceShell>
    );
  }

  // ── success（連携完了） ──
  if (state.step === "success") {
    return (
      <LiffExperienceShell>
        <LiffResultState
          variant="success"
          title="LINE連携が完了しました"
          description={"続いてプレイヤーネームの登録に進みます。\n（※次のステップは順次ご案内します）"}
        />
      </LiffExperienceShell>
    );
  }

  // ── error ──
  const copy = ERROR_COPY[state.code];
  return (
    <LiffExperienceShell>
      <LiffResultState variant="error" title={copy.title} description={copy.description}>
        {state.retry && (
          <div style={{ width: "100%", marginTop: 4 }}>
            <LiffButton variant="primary" onClick={() => void run()}>
              もう一度試す
            </LiffButton>
          </div>
        )}
      </LiffResultState>
    </LiffExperienceShell>
  );
}

export default function UzuProLiffPage() {
  return (
    <Suspense
      fallback={
        <LiffExperienceShell>
          <LiffResultState
            variant="loading"
            title="LINE連携を確認しています"
            description="このまま少しだけお待ちください。"
          />
        </LiffExperienceShell>
      }
    >
      <UzuProLinkView />
    </Suspense>
  );
}
