"use client";

// src/app/oas/[id]/works/[workId]/liff/_TicketLinkTab.tsx
//
// LIFF 管理画面「チケット連携」タブ。
//   - 作品単位のチケット連携設定（Work.liffHomeSettingsJson の ticket_link）を編集する。
//   - ticket_link ページの作成・公開もここから行う（アンケート/FAQ タブと同じ「指定ページ」方式）。
//   - 保存は ticket-link-settings API に **チケット連携部分だけ** を渡す。
//     JSON 全体をクライアントから送って上書きしない（survey 等の既存設定はサーバー側で保持される）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonClass } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { liffConfigApi, getDevToken, type LiffPageSummary } from "@/lib/api-client";
import type { TicketLinkSettings, TicketLinkTicketTypeSetting } from "@/types";
import { findDesignatedLiffPage } from "./_tabs-config";

const MAX_PARTICIPANTS = 20;

interface Props {
  workId: string;
  pages: LiffPageSummary[];
  isReadOnly: boolean;
  onSaved: () => void;
}

type FieldErrors = Record<string, string[]>;

const emptyRow = (sortOrder: number): TicketLinkTicketTypeSetting => ({
  ticketTypeKey: "",
  ticketTypeLabel: "",
  participantCount: 1,
  enabled: true,
  sortOrder,
});

export function TicketLinkTab({ workId, pages, isReadOnly, onSaved }: Props) {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [blockReason, setBlockReason] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [manualInputEnabled, setManualInputEnabled] = useState(false);
  const [completionMessage, setCompletionMessage] = useState("");
  const [reportButtonEnabled, setReportButtonEnabled] = useState(false);
  const [reportButtonLabel, setReportButtonLabel] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [types, setTypes] = useState<TicketLinkTicketTypeSetting[]>([]);

  // 既存の ticket_link ページ（アンケート/FAQ と同じ指定ページ方式で 1 枚に収束させる）
  const designated = useMemo(() => findDesignatedLiffPage(pages, "ticket_link"), [pages]);

  const apply = useCallback((s: TicketLinkSettings, reason: string | null) => {
    setEnabled(s.enabled);
    setManualInputEnabled(s.manualInputEnabled);
    setCompletionMessage(s.completionMessage);
    setReportButtonEnabled(s.reportButtonEnabled);
    setReportButtonLabel(s.reportButtonLabel);
    setReportMessage(s.reportMessage);
    setTypes(s.ticketTypes);
    setBlockReason(reason);
    setDirty(false);
    setFieldErrors({});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/works/${encodeURIComponent(workId)}/ticket-link-settings`, {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.success) apply(j.data.settings as TicketLinkSettings, j.data.blockReason ?? null);
        else showToast("読み込みに失敗しました", "error");
      })
      .catch(() => { if (alive) showToast("読み込みに失敗しました", "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workId, apply, showToast]);

  // 未保存のまま離脱しようとしたら警告する。
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const touch = () => setDirty(true);

  const updateType = (i: number, patch: Partial<TicketLinkTicketTypeSetting>) => {
    setTypes((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
    touch();
  };

  const move = (i: number, dir: -1 | 1) => {
    setTypes((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      // 並び替え結果を sortOrder として保存する。
      return next.map((t, idx) => ({ ...t, sortOrder: idx }));
    });
    touch();
  };

  const handleSave = useCallback(async () => {
    if (saving || isReadOnly) return; // 多重送信防止
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/ticket-link-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getDevToken()}` },
        body: JSON.stringify({
          // チケット連携部分だけを渡す。liffHomeSettingsJson 全体は送らない。
          enabled,
          manualInputEnabled,
          completionMessage,
          reportButtonEnabled,
          reportButtonLabel,
          reportMessage,
          ticketTypes: types.map((t, i) => ({
            ticketTypeKey: t.ticketTypeKey.trim(),
            ticketTypeLabel: t.ticketTypeLabel.trim(),
            participantCount: Number(t.participantCount),
            enabled: t.enabled,
            sortOrder: Number.isFinite(t.sortOrder) ? t.sortOrder : i,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) {
        // 項目単位のエラーを出す（どの行のどの項目かが分かるようにする）。
        setFieldErrors((j?.error?.details as FieldErrors) ?? {});
        showToast(j?.error?.message ?? "保存に失敗しました", "error");
        return; // 入力内容は消さない
      }
      apply(j.data.settings as TicketLinkSettings, j.data.blockReason ?? null);
      onSaved();
      showToast("設定を保存しました", "success");
    } catch {
      showToast("保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }, [saving, isReadOnly, workId, enabled, manualInputEnabled, completionMessage,
      reportButtonEnabled, reportButtonLabel, reportMessage, types, apply, onSaved, showToast]);

  // ticket_link ページを冪等に用意する（既にあれば作らない）。
  const handleCreatePage = useCallback(async () => {
    if (creatingPage || designated) return;
    setCreatingPage(true);
    try {
      await liffConfigApi.createPage(getDevToken(), workId, {
        page_type: "ticket_link",
        title: "チケット連携",
      });
      onSaved();
      showToast("チケット連携ページを作成しました（非公開の下書きです）", "success");
    } catch {
      showToast("作成に失敗しました", "error");
    } finally {
      setCreatingPage(false);
    }
  }, [creatingPage, designated, workId, onSaved, showToast]);

  const togglePublish = useCallback(async () => {
    if (!designated || creatingPage) return;
    setCreatingPage(true);
    const next = designated.publish_status === "published" ? "draft" : "published";
    try {
      await liffConfigApi.updatePage(getDevToken(), workId, designated.id, { publish_status: next });
      onSaved();
      showToast(next === "published" ? "ページを公開しました" : "ページを非公開にしました", "success");
    } catch {
      showToast("更新に失敗しました", "error");
    } finally {
      setCreatingPage(false);
    }
  }, [designated, creatingPage, workId, onSaved, showToast]);

  if (loading) return <p className="text-sm text-gray-500">読み込み中…</p>;

  const pagePublished = designated?.publish_status === "published";
  // 「保存できたか」と「公開できるか」は別の状態として表示する。
  const publishReady = !blockReason && pagePublished;

  const err = (field: string) => fieldErrors[field]?.[0];

  return (
    <div className="space-y-6">
      {/* 公開可否 */}
      <section
        className={`rounded border p-3 text-sm ${publishReady ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}
      >
        <p className="font-medium">
          {publishReady ? "プレイヤーへの公開準備が完了しています" : "プレイヤーにはまだ公開されません"}
        </p>
        <ul className="mt-1 list-disc pl-5 text-gray-700">
          {blockReason && <li>{blockReason}</li>}
          {!designated && <li>チケット連携ページが作成されていません。</li>}
          {designated && !pagePublished && <li>チケット連携ページが未公開のため、プレイヤーには表示されません。</li>}
        </ul>
      </section>

      {/* ページ作成・公開 */}
      <section className="space-y-2">
        <h3 className="font-bold">チケット連携ページ</h3>
        {!designated ? (
          <button className={buttonClass()} onClick={handleCreatePage} disabled={isReadOnly || creatingPage}>
            {creatingPage ? "作成中…" : "チケット連携ページを作成"}
          </button>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span>状態：{pagePublished ? "公開中" : "非公開（下書き）"}</span>
            <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={togglePublish} disabled={isReadOnly || creatingPage}>
              {pagePublished ? "非公開にする" : "公開する"}
            </button>
          </div>
        )}
      </section>

      {/* 基本設定 */}
      <section className="space-y-3">
        <h3 className="font-bold">基本設定</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} disabled={isReadOnly}
            onChange={(e) => { setEnabled(e.target.checked); touch(); }} />
          チケット連携を有効にする
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={manualInputEnabled} disabled={isReadOnly}
            onChange={(e) => { setManualInputEnabled(e.target.checked); touch(); }} />
          手動入力を有効にする
        </label>
        {/* PR4 まで動作しないため操作させない。 */}
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={false} disabled />
          スクリーンショット登録を有効にする（準備中）
        </label>

        <div>
          <label className="block text-sm font-medium">登録完了画面の案内文</label>
          <textarea
            className="mt-1 w-full rounded border p-2 text-sm"
            rows={3}
            value={completionMessage}
            disabled={isReadOnly}
            onChange={(e) => { setCompletionMessage(e.target.value); touch(); }}
          />
        </div>
      </section>

      {/* チケット種別 */}
      <section className="space-y-2">
        <h3 className="font-bold">チケット種別</h3>
        <p className="text-xs text-gray-500">
          チケット種別キーは登録データの識別に使用されます。利用開始後の変更は推奨されません。
        </p>
        <p className="text-xs text-gray-500">
          参加人数はここで設定した値だけを使用します（チケット名からは推測しません）。
        </p>

        <div className="space-y-2">
          {types.map((t, i) => (
            <div key={i} className="rounded border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="w-36 rounded border p-1 text-sm" placeholder="キー (例: 2group)"
                  value={t.ticketTypeKey} disabled={isReadOnly}
                  onChange={(e) => updateType(i, { ticketTypeKey: e.target.value })}
                />
                <input
                  className="w-56 rounded border p-1 text-sm" placeholder="表示名 (例: 2名グループチケット)"
                  value={t.ticketTypeLabel} disabled={isReadOnly}
                  onChange={(e) => updateType(i, { ticketTypeLabel: e.target.value })}
                />
                <input
                  type="number" min={1} max={MAX_PARTICIPANTS}
                  className="w-20 rounded border p-1 text-sm"
                  value={t.participantCount} disabled={isReadOnly}
                  onChange={(e) => updateType(i, { participantCount: Number(e.target.value) })}
                />
                <span className="text-sm">人</span>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={t.enabled} disabled={isReadOnly}
                    onChange={(e) => updateType(i, { enabled: e.target.checked })} />
                  有効
                </label>
                <button className={buttonClass({ variant: "ghost", size: "sm" })} disabled={isReadOnly || i === 0}
                  onClick={() => move(i, -1)} aria-label="上へ">↑</button>
                <button className={buttonClass({ variant: "ghost", size: "sm" })} disabled={isReadOnly || i === types.length - 1}
                  onClick={() => move(i, 1)} aria-label="下へ">↓</button>
                <button className={buttonClass({ variant: "ghost", size: "sm" })} disabled={isReadOnly}
                  onClick={() => { setTypes((p) => p.filter((_, idx) => idx !== i)); touch(); }}>削除</button>
              </div>
              {(err(`ticketTypes[${i}].ticketTypeKey`) || err(`ticketTypes[${i}].ticketTypeLabel`) || err(`ticketTypes[${i}].participantCount`)) && (
                <ul className="mt-1 list-disc pl-5 text-xs text-red-600">
                  {err(`ticketTypes[${i}].ticketTypeKey`) && <li>{err(`ticketTypes[${i}].ticketTypeKey`)}</li>}
                  {err(`ticketTypes[${i}].ticketTypeLabel`) && <li>{err(`ticketTypes[${i}].ticketTypeLabel`)}</li>}
                  {err(`ticketTypes[${i}].participantCount`) && <li>{err(`ticketTypes[${i}].participantCount`)}</li>}
                </ul>
              )}
            </div>
          ))}
        </div>

        <button className={buttonClass({ variant: "ghost", size: "sm" })} disabled={isReadOnly}
          onClick={() => { setTypes((p) => [...p, emptyRow(p.length)]); touch(); }}>
          チケット種別を追加
        </button>
        {err("ticketTypes") && <p className="text-xs text-red-600">{err("ticketTypes")}</p>}
      </section>

      {/* 報告ボタン */}
      <section className="space-y-3">
        <h3 className="font-bold">登録完了画面の報告ボタン</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reportButtonEnabled} disabled={isReadOnly}
            onChange={(e) => { setReportButtonEnabled(e.target.checked); touch(); }} />
          報告ボタンを表示する
        </label>
        <div>
          <label className="block text-sm font-medium">ボタンに表示する文字</label>
          <input className="mt-1 w-full rounded border p-2 text-sm"
            value={reportButtonLabel} disabled={isReadOnly}
            onChange={(e) => { setReportButtonLabel(e.target.value); touch(); }} />
          <p className="mt-1 text-xs text-gray-500">画面表示専用です。この文字は LINE へ送信されません。</p>
        </div>
        <div>
          <label className="block text-sm font-medium">LINEへ送信するメッセージ</label>
          <input className="mt-1 w-full rounded border p-2 text-sm"
            value={reportMessage} disabled={isReadOnly}
            onChange={(e) => { setReportMessage(e.target.value); touch(); }} />
          <p className="mt-1 text-xs text-gray-500">プレイヤーのトークルームへ実際に送信される本文です。</p>
          {reportButtonEnabled && reportMessage.trim().length === 0 && (
            <p className="mt-1 text-xs text-red-600">
              送信メッセージが空のため、報告ボタンを有効にできません。
            </p>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          className={buttonClass()}
          onClick={handleSave}
          disabled={isReadOnly || saving || (reportButtonEnabled && reportMessage.trim().length === 0)}
        >
          {saving ? "保存中…" : "設定を保存"}
        </button>
        {dirty && <span className="text-xs text-amber-700">未保存の変更があります</span>}
      </div>
    </div>
  );
}
