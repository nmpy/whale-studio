"use client";

// src/app/liff/ticket/page.tsx
// 予約完了メールの専用 LIFF URL（/liff/ticket?t=<token>）で開くチケット表示ページ（Phase 1）。
//   - Phase 1 は「表示確認」まで。LINE 本人確認・連携・友だち追加は Phase 2 で実装する。
//     → 認証ボタンは非活性（見た目上押せて処理が無いボタンは置かない）。
//   - トークンは resolveTicketEntryToken(location.href) で復元（?t= / liff.state 両対応・URL は変更しない）。

import { useEffect, useState, useCallback } from "react";
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

type State =
  | { step: "loading" }
  | { step: "valid"; ticket: TicketView }
  | { step: "error"; code: string };

/** 内部エラーコード → ユーザー向け日本語（内部コードは表示しない）。 */
const ERROR_COPY: Record<string, { title: string; description: string; retry?: boolean }> = {
  TOKEN_NOT_FOUND: { title: "チケットが見つかりません", description: "URL が正しいか、最新の予約完了メールからお開きください。" },
  TOKEN_EXPIRED:   { title: "有効期限が切れています", description: "この認証 URL は期限切れです。お手数ですが運営までお問い合わせください。" },
  TOKEN_REVOKED:   { title: "無効な URL です", description: "この認証 URL は無効化されています。最新の予約完了メールをご確認ください。" },
  TICKET_NOT_FOUND:{ title: "チケットを特定できません", description: "チケット情報を確認できませんでした。運営までお問い合わせください。" },
  WORK_NOT_ACTIVE: { title: "受付開始前です", description: "この公演の受付が開始されるまで、しばらくお待ちください。" },
  NETWORK_ERROR:   { title: "通信エラー", description: "電波の良い場所で、同じ URL からもう一度お試しください。", retry: true },
  UNKNOWN:         { title: "エラーが発生しました", description: "時間をおいて、同じ URL からもう一度お試しください。", retry: true },
};

function groupTypeLabel(g: string | null): string | null {
  if (g === "two") return "2名";
  if (g === "four") return "4名";
  return null;
}

export default function TicketLiffPage() {
  const [state, setState] = useState<State>({ step: "loading" });

  const load = useCallback(async () => {
    setState({ step: "loading" });
    const token = resolveTicketEntryToken(typeof window !== "undefined" ? window.location.href : null);
    if (!token) {
      setState({ step: "error", code: "TOKEN_NOT_FOUND" });
      return;
    }
    try {
      const res = await fetch("/api/liff/tickets/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data?.ticket) {
        setState({ step: "valid", ticket: json.data.ticket as TicketView });
      } else {
        const code = typeof json?.error?.code === "string" ? json.error.code : "UNKNOWN";
        setState({ step: "error", code });
      }
    } catch {
      setState({ step: "error", code: "NETWORK_ERROR" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state.step === "loading") {
    return (
      <LiffExperienceShell>
        <LiffResultState variant="loading" title="チケット情報を確認しています" description="このまま少しだけお待ちください。" />
      </LiffExperienceShell>
    );
  }

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

  const { ticket } = state;
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
          <LiffButton variant="primary" disabled>LINE でチケットを認証</LiffButton>
          <p style={{ fontSize: 12, color: "var(--liff-secondary-text,#5B6168)", textAlign: "center", margin: "8px 0 0" }}>
            認証機能は現在準備中です
          </p>
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
