"use client";

// src/components/landing/LandingEmailForm.tsx
// 公開LPのメール入力 → 新規登録導線。
//
// /signup 専用ルートは存在せず、/login が register モードを内包しているため、
// メールアドレスを ?mode=register&email=... で引き継いで /login に遷移する。
// （login ページ側で initialMode / initialEmail を読み取る）
//
// トーン: 明るい背景に合わせ、白入力欄 + 緑の丸みボタン。

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** ボタンラベル（既定: 今すぐ始める） */
  ctaLabel?: string;
  /** レイアウト識別用（計測などに使う余地、現状は見た目に影響しない） */
  source?: string;
}

export function LandingEmailForm({ ctaLabel = "今すぐ始める", source }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");

  function handleStart() {
    const trimmed = email.trim();
    const params = new URLSearchParams({ mode: "register" });
    if (trimmed) params.set("email", trimmed);
    if (source) params.set("from", source);
    router.push(`/login?${params.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleStart(); }}
      className="flex w-full max-w-[480px] flex-col gap-3 sm:flex-row"
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="メールアドレス"
        autoComplete="email"
        aria-label="メールアドレス"
        className="h-12 flex-1 rounded-full border border-[#E3EAE4] bg-white px-5 text-[15px] text-[#1F2A24] placeholder:text-[#9aa49d] outline-none transition focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/25"
      />
      <button
        type="submit"
        className="h-12 shrink-0 rounded-full bg-[#06C755] px-7 text-[15px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:brightness-105 active:translate-y-0"
      >
        {ctaLabel}
      </button>
    </form>
  );
}
