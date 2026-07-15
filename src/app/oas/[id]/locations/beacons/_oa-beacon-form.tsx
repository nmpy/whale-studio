"use client";

// src/app/oas/[id]/locations/beacons/_oa-beacon-form.tsx
// OA レベルのビーコントリガー作成/編集フォーム（新規・編集共通）。
//
// 作品（work）は任意: 未選択なら OA 共通トリガー、選択するとその作品専用。
// action_type="message"（登録済みメッセージ送信）は作品の選択を必須にする
// （メッセージは作品に属するため）。

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthHeaders, getDevToken, workApi } from "@/lib/api-client";
import { Button } from "@/components/shared";
import { withWorkId } from "../../_lib/work-context";

export type BeaconActionType = "message" | "send_message" | "destination" | "noop";

export type OaBeaconFormValue = {
  id?: string;
  name: string;
  hwid: string;
  work_id: string | null;
  enabled: boolean;
  event_types: string;
  action_type: BeaconActionType;
  action_payload: Record<string, unknown> | null;
  cooldown_seconds: number;
  once_per_user: boolean;
  max_triggers_per_user: number | null;
  /** datetime-local 文字列（"YYYY-MM-DDTHH:mm"）または "" */
  valid_from: string;
  valid_to: string;
  note: string;
};

type WorkOption = { id: string; title: string };
type MessageOption = { id: string; label: string };

const DEFAULT_PAYLOADS: Record<BeaconActionType, Record<string, unknown>> = {
  message:      { message_id: "" },
  send_message: { text: "" },
  destination:  { destination_id: "", text: "" },
  noop:         {},
};

/** ISO 文字列 → datetime-local 入力値（ローカル時刻 "YYYY-MM-DDTHH:mm"）。 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── UI helpers ───────────────────────────────────────────────────────────
const inputCls =
  "w-full rounded-field border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-brand";

function RequiredBadge() {
  return <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">必須</span>;
}
function OptionalBadge() {
  return <span className="ml-1.5 rounded-full bg-line/70 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">任意</span>;
}
function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1 flex items-center text-[13px] font-semibold text-ink">
        {label}
        {required ? <RequiredBadge /> : <OptionalBadge />}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-[1.6] text-ink-3">{hint}</p>}
    </div>
  );
}

export function OaBeaconForm({
  oaId,
  mode,
  initial,
}: {
  oaId: string;
  mode: "create" | "edit";
  initial: OaBeaconFormValue;
}) {
  const router = useRouter();
  // 作品コンテキスト（?workId=）を保存/削除/キャンセルの戻り先にも引き継ぐ。
  //   引き継がないと一覧に戻った時点で共通サイドバーが消える（workId でシェル表示が決まるため）。
  //   ここで参照するのは URL の workId のみ。保存・削除の API 呼び出しや紐づけ作品(v.work_id)は変更しない。
  const ambientWorkId = useSearchParams().get("workId");
  const beaconsListHref = withWorkId(`/oas/${oaId}/locations/beacons`, ambientWorkId);
  const [v, setV] = useState<OaBeaconFormValue>(initial);
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [messages, setMessages] = useState<MessageOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof OaBeaconFormValue>(k: K, val: OaBeaconFormValue[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));
  const setPayload = (k: string, val: unknown) =>
    setV((prev) => ({ ...prev, action_payload: { ...(prev.action_payload ?? {}), [k]: val } }));

  // OA の作品一覧（work selector 用）
  useEffect(() => {
    let cancelled = false;
    workApi.list(getDevToken(), oaId)
      .then((list) => { if (!cancelled) setWorks(list.map((w) => ({ id: w.id, title: w.title }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [oaId]);

  // action_type="message" の候補メッセージ（選択中の作品スコープ）
  useEffect(() => {
    if (v.action_type !== "message" || !v.work_id) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages?work_id=${encodeURIComponent(v.work_id!)}`, { headers: { ...getAuthHeaders() } });
        const json = await res.json();
        if (cancelled || !json?.success || !Array.isArray(json.data)) return;
        setMessages(json.data.map((m: { id: string; body?: string | null; message_type?: string }) => ({
          id: m.id,
          label: m.body && m.body.trim() ? m.body.trim().slice(0, 30) : (m.message_type ?? "メッセージ"),
        })));
      } catch { /* 取得失敗時は手入力にフォールバック */ }
    })();
    return () => { cancelled = true; };
  }, [v.action_type, v.work_id]);

  const cooldownMin = Math.floor(v.cooldown_seconds / 60);
  const cooldownSec = v.cooldown_seconds % 60;

  const messageNeedsWork = v.action_type === "message" && !v.work_id;
  const canSubmit = useMemo(
    () => !!v.name.trim() && !!v.hwid.trim() && !messageNeedsWork && !saving && !deleting,
    [v.name, v.hwid, messageNeedsWork, saving, deleting],
  );

  function changeActionType(t: BeaconActionType) {
    setV((prev) => ({ ...prev, action_type: t, action_payload: DEFAULT_PAYLOADS[t] }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        name: v.name.trim(),
        hwid: v.hwid.trim(),
        work_id: v.work_id || null,
        enabled: v.enabled,
        event_types: v.event_types || "enter",
        action_type: v.action_type,
        action_payload: v.action_payload,
        cooldown_seconds: Math.max(0, v.cooldown_seconds),
        once_per_user: v.once_per_user,
        max_triggers_per_user: v.max_triggers_per_user ?? null,
        valid_from: v.valid_from ? v.valid_from : null,
        valid_to: v.valid_to ? v.valid_to : null,
        note: v.note.trim() ? v.note.trim() : null,
      };
      const url = mode === "create"
        ? `/api/oas/${oaId}/beacons`
        : `/api/oas/${oaId}/beacons/${v.id}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `保存に失敗しました (${res.status})`);
        setSaving(false);
        return;
      }
      router.push(beaconsListHref);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!v.id || !confirm(`ビーコン「${v.name}」を削除しますか？この操作は取り消せません。`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/beacons/${v.id}`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? `削除に失敗しました (${res.status})`);
        setDeleting(false);
        return;
      }
      router.push(beaconsListHref);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-card border border-line bg-surface px-4 py-5 sm:px-6">
      {error && (
        <div role="alert" className="mb-4 rounded-field border border-danger/30 bg-danger-soft px-3 py-2.5 text-[12px] text-danger">
          {error}
        </div>
      )}

      <Field label="ビーコン名" required hint="管理画面の一覧・ログで識別するための名前です。">
        <input className={inputCls} value={v.name} maxLength={100} onChange={(e) => set("name", e.target.value)} placeholder="例: 受付ビーコン" />
      </Field>

      <Field label="HWID" required hint="LINE Official Account Manager で登録したビーコンのハードウェアIDを入力してください。">
        <input className={`${inputCls} font-mono`} value={v.hwid} maxLength={64} onChange={(e) => set("hwid", e.target.value)} placeholder="例: d41d8cd98f" />
      </Field>

      <Field label="紐づける作品" hint="未選択なら OA 共通トリガー（どの作品でも発火）。メッセージ送信を使う場合は作品の選択が必要です。">
        <select className={inputCls} value={v.work_id ?? ""} onChange={(e) => set("work_id", e.target.value || null)}>
          <option value="">OA 共通（作品に紐づけない）</option>
          {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </Field>

      <Field label="発火イベント" hint="日本では実質 enter（受信圏に入った）のみが届きます。stay / banner は受信した場合ログには残ります。">
        <select className={inputCls} value={v.event_types} onChange={(e) => set("event_types", e.target.value)}>
          <option value="enter">enter（推奨）</option>
          <option value="enter,stay">enter, stay</option>
          <option value="enter,banner">enter, banner</option>
          <option value="enter,stay,banner">enter, stay, banner</option>
        </select>
      </Field>

      <Field label="発火時アクション" required>
        <select className={inputCls} value={v.action_type} onChange={(e) => changeActionType(e.target.value as BeaconActionType)}>
          <option value="message">登録済みメッセージを送信</option>
          <option value="send_message">テキストを送信</option>
          <option value="destination">遷移先 URL を送信</option>
          <option value="noop">何も送らない（ログのみ）</option>
        </select>
      </Field>

      {v.action_type === "message" && (
        <Field label="送信するメッセージ" required hint={messageNeedsWork ? "メッセージ送信を使うには、先に作品を選択してください。" : "lag_ms / タイピング / 既読 / チェーンなど通常メッセージと同じ演出で送信されます。"}>
          {messageNeedsWork ? (
            <div className="rounded-field border border-dashed border-line bg-bg px-3 py-2 text-[12px] text-ink-3">作品を選択するとメッセージを選べます。</div>
          ) : messages.length > 0 ? (
            <select className={inputCls} value={String(v.action_payload?.message_id ?? "")} onChange={(e) => setPayload("message_id", e.target.value)}>
              <option value="">選択してください</option>
              {messages.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <input className={inputCls} value={String(v.action_payload?.message_id ?? "")} onChange={(e) => setPayload("message_id", e.target.value)} placeholder="メッセージ ID" />
          )}
        </Field>
      )}

      {v.action_type === "send_message" && (
        <Field label="送信テキスト" required>
          <textarea className={inputCls} rows={4} maxLength={1000} value={String(v.action_payload?.text ?? "")} onChange={(e) => setPayload("text", e.target.value)} placeholder="ビーコンに近づいたユーザーに送るテキスト" />
        </Field>
      )}

      {v.action_type === "destination" && (
        <>
          <Field label="遷移先 ID" required>
            <input className={inputCls} value={String(v.action_payload?.destination_id ?? "")} onChange={(e) => setPayload("destination_id", e.target.value)} placeholder="LineDestination ID" />
          </Field>
          <Field label="添えるテキスト">
            <input className={inputCls} value={String(v.action_payload?.text ?? "")} maxLength={500} onChange={(e) => setPayload("text", e.target.value)} placeholder="URL の前に表示するテキスト（任意）" />
          </Field>
        </>
      )}

      {/* ── 再発火制御 ── */}
      <div className="mt-5 mb-4 border-t border-line pt-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">再発火制御</p>
        <p className="mb-3 text-[11px] leading-[1.6] text-ink-3">同じユーザーに何度も同じメッセージが届かないよう、再発火までの間隔や回数を設定できます。</p>

        <Field label="再発火防止（クールダウン）">
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={1440} className={`${inputCls} w-24`} value={cooldownMin}
              onChange={(e) => set("cooldown_seconds", Math.max(0, (parseInt(e.target.value, 10) || 0) * 60 + cooldownSec))} />
            <span className="text-[12px] text-ink-3">分</span>
            <input type="number" min={0} max={59} className={`${inputCls} w-24`} value={cooldownSec}
              onChange={(e) => set("cooldown_seconds", Math.max(0, cooldownMin * 60 + (parseInt(e.target.value, 10) || 0)))} />
            <span className="text-[12px] text-ink-3">秒</span>
          </div>
        </Field>

        <label className="mb-3 flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={v.once_per_user} onChange={(e) => set("once_per_user", e.target.checked)} />
          同じユーザーには1回だけ発火する
        </label>

        <Field label="ユーザーごとの最大発火回数" hint="空欄なら無制限（クールダウンのみ適用）。">
          <input type="number" min={1} max={1000000} className={`${inputCls} w-40`}
            value={v.max_triggers_per_user ?? ""}
            onChange={(e) => set("max_triggers_per_user", e.target.value ? Math.max(1, parseInt(e.target.value, 10) || 1) : null)}
            placeholder="無制限" />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="有効期間（開始）">
            <input type="datetime-local" className={inputCls} value={v.valid_from} onChange={(e) => set("valid_from", e.target.value)} />
          </Field>
          <Field label="有効期間（終了）">
            <input type="datetime-local" className={inputCls} value={v.valid_to} onChange={(e) => set("valid_to", e.target.value)} />
          </Field>
        </div>
      </div>

      <Field label="メモ">
        <textarea className={inputCls} rows={2} maxLength={1000} value={v.note} onChange={(e) => set("note", e.target.value)} placeholder="設置場所・会場メモなど（任意）" />
      </Field>

      <label className="mb-4 flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        有効にする
      </label>

      <div className="mb-4 rounded-field border border-line bg-bg px-3 py-2.5 text-[11px] leading-[1.7] text-ink-3">
        ユーザー側で Bluetooth と LINE Beacon 設定が有効で、対象の LINE 公式アカウントを友だち追加している必要があります。
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {saving ? "保存中…" : mode === "create" ? "作成" : "保存"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(beaconsListHref)}>キャンセル</Button>
        {mode === "edit" && (
          <Button type="button" variant="danger" onClick={onDelete} disabled={deleting} className="ml-auto">
            {deleting ? "削除中…" : "削除"}
          </Button>
        )}
      </div>
    </form>
  );
}
