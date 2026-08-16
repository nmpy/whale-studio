"use client";

// src/app/oas/[id]/broadcasts/_components.tsx
//
// 配信メッセージ画面の共通 UI。**配信専用**。
// 応答メッセージ側の editor / preview コンポーネントは、フェーズ遷移や quick reply など
// 応答固有の props と結合しているため流用しない（coupling を増やさない）。

import type { ReactNode } from "react";
import { useState } from "react";
import { BROADCAST_KIND_LABEL, type BroadcastContentDto } from "./_client";

/**
 * 画面上部に常に出す見出し。
 * 「応答メッセージ」と取り違えたまま操作されることを防ぐのが目的なので、
 * タイトルと説明文はどの画面でも省略しない。
 */
export function BroadcastPageHeading({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[20px] font-bold text-ink">配信メッセージ</h1>
      <p className="mt-1 text-[12px] leading-[1.6] text-ink-3">
        LINEユーザーへ任意のタイミングで一斉またはセグメント配信する機能です。
        <br />
        ユーザー操作に応じて送信される「応答メッセージ」とは別の機能です。
      </p>
      {subtitle && <p className="mt-2 text-[13px] font-semibold text-ink">{subtitle}</p>}
    </div>
  );
}

/** LINE トーク画面での見え方（吹き出し）。送信前の確認用。 */
export function LinePreview({ text }: { text: string }) {
  return (
    <PreviewFrame>
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[18px] bg-white px-3.5 py-2.5 text-[14px] leading-[1.7] text-ink shadow-sm">
        {text.trim() === "" ? <span className="text-ink-3">（本文が未入力です）</span> : text}
      </div>
    </PreviewFrame>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-[#8CABD8] p-4">
      <div className="mb-1 text-[10px] font-semibold text-white/80">LINE でのプレビュー</div>
      <div className="flex justify-start">{children}</div>
    </div>
  );
}

/** 読み込めない画像 URL でも画面全体を壊さないプレビュー。 */
function ImageBubble({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  if (url.trim() === "") {
    return (
      <div className="rounded-[18px] bg-white px-3.5 py-2.5 text-[12px] text-ink-3 shadow-sm">
        （画像 URL が未入力です）
      </div>
    );
  }
  if (broken) {
    return (
      <div className="max-w-[80%] rounded-[18px] bg-white px-3.5 py-2.5 text-[12px] leading-[1.6] text-ink-3 shadow-sm">
        画像を読み込めませんでした。URL が https で公開されているか確認してください。
        <span className="mt-1 block break-all font-mono text-[10px]">{url}</span>
      </div>
    );
  }
  return (
    // 外部ホストの任意 URL なので next/image の最適化は通さず素の img を使う
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url} alt="配信画像のプレビュー" onError={() => setBroken(true)}
      className="max-h-[240px] max-w-[80%] rounded-[18px] object-contain shadow-sm"
    />
  );
}

/**
 * 形式に応じたプレビュー。
 *
 * Flex は LINE の見た目を Whale 側で完全再現しない（Simulator を再実装しない）。
 * altText / コンテナ種別 / 整形した JSON を出し、実際の見え方はテスト送信で確認してもらう。
 */
export function BroadcastContentPreview({ content }: { content: BroadcastContentDto }) {
  if (content.kind === "text") return <LinePreview text={content.text} />;

  if (content.kind === "image") {
    return (
      <>
        <PreviewFrame><ImageBubble url={content.previewImageUrl || content.originalContentUrl} /></PreviewFrame>
        <p className="mt-1 text-[11px] text-ink-3">
          トーク一覧では小さいプレビュー画像、タップすると元画像が表示されます。
        </p>
      </>
    );
  }

  const containerType = typeof content.contents?.type === "string" ? content.contents.type : "—";
  return (
    <div className="rounded-card border border-line bg-bg px-3 py-3">
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[12px]">
        <dt className="text-ink-3">代替テキスト</dt>
        <dd className="break-words text-ink">{content.altText}</dd>
        <dt className="text-ink-3">コンテナ</dt>
        <dd className="text-ink">{containerType}</dd>
      </dl>
      <pre className="mt-2 max-h-[280px] overflow-auto rounded-lg border border-line bg-surface p-2 text-[11px] leading-[1.5] text-ink-2">
{JSON.stringify(content.contents, null, 2)}
      </pre>
      <p className="mt-2 text-[11px] leading-[1.5] text-ink-3">
        Flex の実際の見た目は管理画面では再現していません。<strong>テスト送信で確認してください。</strong>
      </p>
    </div>
  );
}

/** 一覧・確認画面で使う形式バッジ。 */
export function ContentKindBadge({ kind }: { kind: BroadcastContentDto["kind"] }) {
  return (
    <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-[11px] text-ink-2">
      {BROADCAST_KIND_LABEL[kind]}
    </span>
  );
}

/** 配信予定人数。件数を必ず出す（セグメント名だけの表示にしない）。 */
export function AudienceCount({ count, loading }: { count: number | null; loading: boolean }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold text-ink-3">配信予定人数</div>
      <div className="mt-0.5 text-[20px] font-bold text-ink">
        {loading ? "…" : count == null ? "—" : `${count.toLocaleString()}人`}
      </div>
      <p className="mt-1 text-[11px] leading-[1.5] text-ink-3">
        Whale Studio が把握しているこのアカウントのユーザーが対象です（LINE の全友だちではありません）。
      </p>
    </div>
  );
}

/**
 * 本配信の最終確認モーダル。
 * 「配信する」の 1 クリックでは送らず、必ずここを挟む。
 */
export function ConfirmSendModal({
  open, count, sending, onCancel, onConfirm,
}: {
  open: boolean; count: number; sending: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[440px] rounded-card border border-line bg-surface p-5 shadow-lg">
        <h2 className="text-[15px] font-bold text-ink">
          {count.toLocaleString()}人に配信メッセージを送信します
        </h2>
        <ul className="mt-3 space-y-1.5 text-[12px] leading-[1.6] text-ink-2">
          <li>・この操作は「応答メッセージ」の設定には影響しません。</li>
          <li>・LINE公式アカウントの月間メッセージ通数を消費します。</li>
          <li>・送信後に取り消すことはできません。</li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={sending}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={sending}>
            {sending ? "送信中…" : `${count.toLocaleString()}人に配信する`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      {title && <h2 className="mb-3 text-[13px] font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
      {message}
    </div>
  );
}
