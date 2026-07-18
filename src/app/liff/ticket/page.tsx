"use client";

// src/app/liff/ticket/page.tsx
// 予約完了メールの専用 LIFF URL（/liff/ticket?t=<token>）で開くチケット表示 + LINE 連携ページ。
//   Phase 1: トークンからチケット情報を表示（本人確認なし・resolve API）。
//   Phase 2: 「LINE でチケットを認証」で LIFF アクセストークンを取得し link API へ。
//            サーバーが本人確認（lineUserId 確定）・友だち確認・定員判定・LiveParticipant 連携を行う。
//
//   セキュリティ/UX:
//     - token / accessToken は画面・console・監視ログへ出さない。
//     - 二重押下防止（submitting）。未ログインは liff.login（redirectUri=現 URL でチケット URL を保持）。
//     - クライアントから lineUserId は送らない（サーバーが accessToken から確定）。

import { useEffect, useRef, useState, useCallback } from "react";
import { LiffExperienceShell, LiffResultState } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";
import { resolveTicketEntryToken } from "@/lib/liff/ticket-entry";
import { formatDateTime } from "@/lib/format-datetime";

type TicketView = {
  maskedTicketId: string;
  workTitle: string;
  sessionName: string | null;
  scheduledAt: string | null;
  venueName: string | null;
  groupType: string | null;
  status: string;
};

type Loaded = { ticket: TicketView; liffId: string | null };

type State =
  | { step: "loading" }
  | { step: "ready"; loaded: Loaded }
  | { step: "friend"; loaded: Loaded; addFriendUrl: string | null }
  | { step: "done"; ticket: TicketView; addFriendUrl: string | null }
  | { step: "error"; code: string };

/** 内部エラーコード → ユーザー向け日本語（内部コードは表示しない）。 */
const ERROR_COPY: Record<string, { title: string; description: string; retry?: boolean }> = {
  TOKEN_NOT_FOUND:      { title: "チケットが見つかりません", description: "URL が正しいか、最新の予約完了メールからお開きください。" },
  TOKEN_EXPIRED:        { title: "有効期限が切れています", description: "この認証 URL は期限切れです。お手数ですが運営までお問い合わせください。" },
  TOKEN_REVOKED:        { title: "無効な URL です", description: "この認証 URL は無効化されています。最新の予約完了メールをご確認ください。" },
  TICKET_NOT_FOUND:     { title: "チケットを特定できません", description: "チケット情報を確認できませんでした。運営までお問い合わせください。" },
  WORK_NOT_ACTIVE:      { title: "受付開始前です", description: "この公演の受付が開始されるまで、しばらくお待ちください。" },
  ACCESS_TOKEN_REQUIRED:{ title: "LINE ログインが必要です", description: "LINE アプリからこの URL を開き、もう一度お試しください。", retry: true },
  ACCESS_TOKEN_INVALID: { title: "認証に失敗しました", description: "お手数ですが、同じ URL からもう一度開き直してお試しください。", retry: true },
  TEAM_FULL:            { title: "連携人数の上限に達しています", description: "このチケットで連携できる人数の上限に達しています。同じグループの別の方がすでに連携していないかご確認ください。心当たりがない場合は、運営までお問い合わせください。" },
  OA_LINE_CONFIG_ERROR: { title: "アカウント設定に問題があります", description: "お手数ですが、運営までお問い合わせください。" },
  NETWORK_ERROR:        { title: "通信エラー", description: "電波の良い場所で、もう一度お試しください。", retry: true },
  UNKNOWN:              { title: "エラーが発生しました", description: "時間をおいて、同じ URL からもう一度お試しください。", retry: true },
};

function groupTypeLabel(g: string | null): string | null {
  if (g === "two") return "2名";
  if (g === "four") return "4名";
  return null;
}

export default function TicketLiffPage() {
  const [state, setState] = useState<State>({ step: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const tokenRef = useRef<string | null>(null);

  // ── 1. resolve でチケット情報 + liffId を取得（Phase 1 と同じ・本人確認なし） ──
  const load = useCallback(async () => {
    setState({ step: "loading" });
    const token = resolveTicketEntryToken(typeof window !== "undefined" ? window.location.href : null);
    tokenRef.current = token;
    if (!token) {
      setState({ step: "error", code: "TOKEN_NOT_FOUND" });
      return;
    }
    try {
      const res = await fetch("/api/liff/tickets/resolve", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data?.ticket) {
        setState({ step: "ready", loaded: { ticket: json.data.ticket as TicketView, liffId: json.data.liffId ?? null } });
      } else {
        setState({ step: "error", code: typeof json?.error?.code === "string" ? json.error.code : "UNKNOWN" });
      }
    } catch {
      setState({ step: "error", code: "NETWORK_ERROR" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── 2. 「LINE で認証」: LIFF SDK 初期化 → 未ログインなら login（URL 保持）→ accessToken → link API ──
  const authenticate = useCallback(async (loaded: Loaded) => {
    if (submitting) return; // 二重押下防止
    setSubmitting(true);
    try {
      const token = tokenRef.current;
      if (!token) { setState({ step: "error", code: "TOKEN_NOT_FOUND" }); return; }

      let accessToken: string | null = null;
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: loaded.liffId ?? "" });
        if (!liff.isLoggedIn()) {
          // チケット URL（?t=...）を保持したまま LINE ログインへ。戻ると同じ画面が再描画される。
          liff.login({ redirectUri: typeof window !== "undefined" ? window.location.href : undefined });
          return; // ここで離脱（リダイレクト）
        }
        accessToken = liff.getAccessToken();
      } catch {
        setState({ step: "error", code: "NETWORK_ERROR" });
        return;
      }
      if (!accessToken) { setState({ step: "error", code: "ACCESS_TOKEN_REQUIRED" }); return; }

      const res = await fetch("/api/liff/tickets/link", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, accessToken }),
      });
      const json = await res.json().catch(() => null);

      if (res.ok && json?.success && json.data?.ticket) {
        setState({ step: "done", ticket: json.data.ticket as TicketView, addFriendUrl: json.data.addFriendUrl ?? null });
        return;
      }
      const code = typeof json?.error?.code === "string" ? json.error.code : "UNKNOWN";
      if (code === "FRIEND_REQUIRED") {
        setState({ step: "friend", loaded, addFriendUrl: typeof json?.addFriendUrl === "string" ? json.addFriendUrl : null });
      } else {
        setState({ step: "error", code });
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  // ── loading ──
  if (state.step === "loading") {
    return (
      <LiffExperienceShell>
        <LiffResultState variant="loading" title="チケット情報を確認しています" description="このまま少しだけお待ちください。" />
      </LiffExperienceShell>
    );
  }

  // ── error ──
  if (state.step === "error") {
    const copy = ERROR_COPY[state.code] ?? ERROR_COPY.UNKNOWN;
    return (
      <LiffExperienceShell>
        <LiffResultState
          variant="error"
          title={copy.title}
          description={copy.description}
          primaryActionLabel={copy.retry ? "もう一度試す" : undefined}
          onPrimaryAction={copy.retry ? () => void load() : undefined}
        />
      </LiffExperienceShell>
    );
  }

  // ── friend required（友だち追加が必要） ──
  if (state.step === "friend") {
    const hasUrl = !!state.addFriendUrl;
    return (
      <LiffExperienceShell>
        <LiffResultState
          variant="warning"
          title="LINE公式アカウントの友だち追加が必要です"
          description={
            hasUrl
              ? "LINE公式アカウントを友だち追加してから、もう一度お試しください。すでに追加済みの場合は、ブロックを解除して再度お試しください。"
              : "友だち追加の導線を準備できませんでした。お手数ですが運営までお問い合わせください。"
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            {hasUrl && (
              <LiffButton variant="primary" onClick={() => { if (state.addFriendUrl) window.location.href = state.addFriendUrl; }}>
                友だち追加する
              </LiffButton>
            )}
            <LiffButton variant="outline" loading={submitting} loadingLabel="確認中…" onClick={() => void authenticate(state.loaded)}>
              追加済みなので再確認する
            </LiffButton>
          </div>
        </LiffResultState>
      </LiffExperienceShell>
    );
  }

  // ── done（認証完了） ──
  if (state.step === "done") {
    const { ticket } = state;
    return (
      <LiffExperienceShell>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <LiffResultState variant="success" title="チケット認証が完了しました" description="このチケットを、現在の LINE アカウントへ連携しました。" />
          <dl style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0 }}>
            <Row label="作品" value={ticket.workTitle || "公演チケット"} />
            {ticket.scheduledAt && <Row label="日時" value={formatDateTime(ticket.scheduledAt)} />}
            <Row label="チケットID" value={ticket.maskedTicketId} mono />
          </dl>
          <div style={{ background: "var(--liff-info-bg,#F0F7F3)", borderRadius: 10, padding: "12px 14px", fontSize: 13, lineHeight: 1.7, color: "var(--liff-secondary-text,#5B6168)" }}>
            対象の LINE 公式アカウントと連携済みです。
          </div>
          {state.addFriendUrl && (
            <LiffButton as="a" variant="outline" href={state.addFriendUrl}>トークを開く</LiffButton>
          )}
        </div>
      </LiffExperienceShell>
    );
  }

  // ── ready（チケット表示 + 認証ボタン活性） ──
  const { ticket, liffId } = state.loaded;
  const groupLabel = groupTypeLabel(ticket.groupType);
  return (
    <LiffExperienceShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--liff-line-green,#06C755)", margin: 0, letterSpacing: "0.04em" }}>チケット認証</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--liff-primary-text,#1F2329)", margin: "6px 0 0", lineHeight: 1.4 }}>
            {ticket.workTitle || "公演チケット"}
          </h1>
        </div>

        <dl style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0 }}>
          {ticket.sessionName && <Row label="公演" value={ticket.sessionName} />}
          {ticket.scheduledAt && <Row label="日時" value={formatDateTime(ticket.scheduledAt)} />}
          {ticket.venueName && <Row label="会場" value={ticket.venueName} />}
          <Row label="チケットID" value={ticket.maskedTicketId} mono />
          {groupLabel && <Row label="人数" value={groupLabel} />}
        </dl>

        <div style={{ background: "var(--liff-info-bg,#F0F7F3)", borderRadius: 10, padding: "12px 14px", fontSize: 13, lineHeight: 1.7, color: "var(--liff-secondary-text,#5B6168)" }}>
          このチケットを、現在ご利用中の LINE アカウントへ連携します。<br />
          <strong>この URL は他の方と共有しないでください。</strong>
        </div>

        <div>
          <LiffButton
            variant="primary"
            loading={submitting}
            loadingLabel="認証しています…"
            disabled={!liffId}
            onClick={() => void authenticate(state.loaded)}
          >
            LINE でチケットを認証
          </LiffButton>
          {!liffId && (
            <p style={{ fontSize: 12, color: "var(--liff-secondary-text,#5B6168)", textAlign: "center", margin: "8px 0 0" }}>
              このアカウントは認証を利用できません。運営までお問い合わせください。
            </p>
          )}
        </div>
      </div>
    </LiffExperienceShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 10, alignItems: "baseline" }}>
      <dt style={{ fontSize: 12, fontWeight: 700, color: "var(--liff-secondary-text,#5B6168)" }}>{label}</dt>
      <dd style={{ fontSize: 14, color: "var(--liff-primary-text,#1F2329)", margin: 0, fontFamily: mono ? "ui-monospace, monospace" : undefined, wordBreak: "break-word" }}>{value}</dd>
    </div>
  );
}
