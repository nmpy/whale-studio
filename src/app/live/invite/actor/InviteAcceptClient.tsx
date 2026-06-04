"use client";

// src/app/live/invite/actor/InviteAcceptClient.tsx
// Phase 2-J: 招待 URL ページ Client コンポーネント。
// マウント時に token を POST → 成功で response.data.redirect_to (= /oas/<id>/live/actor) へ遷移。
// 失敗時は state ごとのメッセージ表示。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type AcceptState = "idle" | "loading" | "success" | "error";

export default function InviteAcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<AcceptState>("idle");
  const [errorCode, setErrorCode] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [actorName, setActorName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState("error");
      setErrorCode("MISSING_TOKEN");
      setErrorMessage("招待 URL に token がありません");
      return;
    }
    setState("loading");
    (async () => {
      try {
        const res = await fetch("/api/live/invite/actor", {
          method:      "POST",
          credentials: "include",
          headers:     { "content-type": "application/json" },
          body:        JSON.stringify({ token }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json?.success && json?.data?.redirect_to) {
          setActorName(json.data.actor_name ?? "");
          setState("success");
          setTimeout(() => router.replace(json.data.redirect_to), 700);
        } else {
          setState("error");
          setErrorCode(json?.error?.code ?? "UNKNOWN");
          setErrorMessage(json?.error?.message ?? "招待 URL の受諾に失敗しました");
        }
      } catch {
        if (cancelled) return;
        setState("error");
        setErrorCode("NETWORK");
        setErrorMessage("ネットワークエラーが発生しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", marginBottom: 12 }}>
        Whale Studio Live — 演者招待
      </h1>

      {state === "loading" && (
        <p style={{ fontSize: 13, color: "#6b7280" }}>招待 URL を検証しています…</p>
      )}

      {state === "success" && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #10b981",
            borderRadius: 10,
            padding: "14px 16px",
            color: "#065f46",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700 }}>受諾しました 🐋</p>
          {actorName && <p style={{ margin: "4px 0 0" }}>演者: <strong>{actorName}</strong></p>}
          <p style={{ margin: "8px 0 0", fontSize: 12 }}>Actor Console に移動します…</p>
        </div>
      )}

      {state === "error" && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            padding: "14px 16px",
            color: "#991b1b",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700 }}>受諾できませんでした</p>
          <p style={{ margin: "4px 0 0" }}>{errorMessage}</p>
          {errorCode && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#7f1d1d" }}>code: {errorCode}</p>
          )}
          <p style={{ margin: "12px 0 0", fontSize: 12 }}>
            URL の再発行は Admin にお問い合わせください。
            <br />
            <Link href="/oas" style={{ color: "#0369a1", textDecoration: "underline" }}>
              ホームへ
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
