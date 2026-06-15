"use client";

// src/app/oas/[id]/works/[workId]/beacons/_form.tsx
// ビーコン作成 / 編集フォーム（共通）

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/api-client";

export type BeaconFormValue = {
  id?: string;
  name: string;
  hwid: string;
  enabled: boolean;
  event_types: string;
  cooldown_seconds: number;
  action_type: "message" | "send_message" | "destination" | "noop";
  action_payload: Record<string, unknown> | null;
  /** 紐づけ地点(Location.id)。「地点到着で自動進行」の待機トリガー(beacon)消化に使う。"" = なし。 */
  location_id?: string | null;
};

type MessageOption = { id: string; label: string };
type LocationOption = { id: string; name: string };

interface Props {
  oaId: string;
  workId: string;
  initial: BeaconFormValue;
  mode: "create" | "edit";
}

const DEFAULT_PAYLOADS: Record<BeaconFormValue["action_type"], Record<string, unknown>> = {
  message:      { message_id: "" },
  send_message: { text: "" },
  destination:  { destination_id: "", text: "" },
  noop:         {},
};

export default function BeaconForm({ oaId, workId, initial, mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [hwid, setHwid] = useState(initial.hwid);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [eventTypes, setEventTypes] = useState(initial.event_types);
  const [cooldownMin, setCooldownMin] = useState(Math.floor(initial.cooldown_seconds / 60));
  const [cooldownSec, setCooldownSec] = useState(initial.cooldown_seconds % 60);
  const [actionType, setActionType] = useState(initial.action_type);
  const [actionPayload, setActionPayload] = useState<Record<string, unknown>>(
    (initial.action_payload as Record<string, unknown> | null) ?? DEFAULT_PAYLOADS[initial.action_type] ?? {},
  );
  const [locationId, setLocationId] = useState(initial.location_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  // action_type="message" 用のメッセージ候補（同一 work）を取得する。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages?work_id=${encodeURIComponent(workId)}`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (cancelled || !json?.success || !Array.isArray(json.data)) return;
        const opts: MessageOption[] = json.data.map((m: { id: string; body?: string | null; message_type?: string }) => ({
          id: m.id,
          label: (m.body && m.body.trim() ? m.body.trim().slice(0, 30) : (m.message_type ?? "メッセージ")),
        }));
        setMessages(opts);
      } catch { /* 取得失敗時は手入力にフォールバック */ }
    })();
    return () => { cancelled = true; };
  }, [workId]);

  // 「地点到着で自動進行」紐づけ用の地点候補（同一 work）を取得する。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/locations?work_id=${encodeURIComponent(workId)}`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (cancelled || !json?.success || !Array.isArray(json.data)) return;
        setLocations(json.data.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
      } catch { /* 取得失敗時はセレクタを空にする */ }
    })();
    return () => { cancelled = true; };
  }, [workId]);

  function updatePayload(key: string, value: string) {
    setActionPayload((prev) => ({ ...prev, [key]: value }));
  }

  function changeActionType(t: BeaconFormValue["action_type"]) {
    setActionType(t);
    setActionPayload(DEFAULT_PAYLOADS[t] ?? {});
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const cooldown = Math.max(0, cooldownMin * 60 + cooldownSec);
      const body = {
        name,
        hwid,
        enabled,
        event_types: eventTypes,
        cooldown_seconds: cooldown,
        action_type: actionType,
        action_payload: actionType === "noop" ? null : actionPayload,
        location_id: locationId || null,
      };
      const url = mode === "create"
        ? `/api/works/${workId}/beacons`
        : `/api/works/${workId}/beacons/${initial.id}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);
        return;
      }
      router.push(`/oas/${oaId}/works/${workId}/beacons`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!initial.id) return;
    if (!window.confirm("このビーコントリガーを削除しますか？")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/works/${workId}/beacons/${initial.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.status === 204 || res.ok) {
        router.push(`/oas/${oaId}/works/${workId}/beacons`);
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error?.message ?? `削除に失敗しました (HTTP ${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
      {error && (
        <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ padding: "12px 14px", background: "#f1f7fb", border: "1px solid #dbe8f2", borderRadius: 10, fontSize: 12, color: "#435068", lineHeight: 1.8 }}>
        <div>・LINE Official Account Manager 側でビーコンを対象 OA に登録し、発行された HWID をここに入力してください。</div>
        <div>・ユーザー側は Bluetooth と LINE Beacon 設定が ON、かつ OA を友だち追加済みである必要があります。</div>
        <div>・連続通知を防ぐため、同じユーザー・同じビーコンの再検知にはクールダウンが適用されます。</div>
        <div>・日本では <strong>enter</strong> 検知を前提にしています。Beacon 連動は Pro Max 機能です。</div>
      </div>

      <Field label="ビーコン名" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          style={inputStyle}
        />
      </Field>

      <Field label="HWID" required hint="LINE 公式アカウント側で発行・確認した HWID（半角英数字）。大文字小文字は区別しません。">
        <input
          type="text"
          value={hwid}
          onChange={(e) => setHwid(e.target.value)}
          required
          maxLength={64}
          style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          placeholder="例: d41d8cd98f"
        />
      </Field>

      <Field label="有効/無効">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          有効化（OFF にするとイベントは記録のみで送信しません）
        </label>
      </Field>

      <Field label="発火イベント" hint="MVP では enter のみ送信されます。stay / banner はログのみ。複数指定する場合はカンマ区切り。">
        <select value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} style={inputStyle}>
          <option value="enter">enter（受信圏に入ったとき）</option>
          <option value="enter,stay">enter,stay</option>
          <option value="enter,banner">enter,banner</option>
          <option value="enter,stay,banner">enter,stay,banner</option>
        </select>
      </Field>

      <Field label="再発火防止時間" hint="同一ユーザーが連続で受信したときの再発火を抑制します。0 の場合は毎回発火。">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min={0}
            max={1440}
            value={cooldownMin}
            onChange={(e) => setCooldownMin(Math.max(0, Number(e.target.value)))}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 13 }}>分</span>
          <input
            type="number"
            min={0}
            max={59}
            value={cooldownSec}
            onChange={(e) => setCooldownSec(Math.max(0, Math.min(59, Number(e.target.value))))}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 13 }}>秒</span>
        </div>
      </Field>

      <Field
        label="紐づけ地点（地点到着で自動進行）"
        hint="この地点を選ぶと、メッセージ編集の「送信後に地点到着を待つ（Beacon検知を待つ）」で同じ地点を指定した待機トリガーを、このビーコン検知で消化できます（到着待ちのユーザーにのみ次メッセージ送信）。上の発火時アクションとは独立して動作します。未選択なら連携しません。"
      >
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={inputStyle}>
          <option value="">連携しない</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        {!locationId && (
          <div style={{
            marginTop: 6, fontSize: 12, lineHeight: 1.6, padding: "8px 10px", borderRadius: 6,
            background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569",
          }}>
            紐づけ地点が未設定です。このBeaconは通常のBeaconTriggerとしては使えますが、地点到着トリガーには使用されません。
            <br />
            メッセージ編集画面で「Beacon検知を待つ」を使う場合は、対象地点と同じ地点をここで選択してください。
          </div>
        )}
      </Field>

      <Field label="発火時アクション" required>
        <select value={actionType} onChange={(e) => changeActionType(e.target.value as BeaconFormValue["action_type"])} style={inputStyle}>
          <option value="message">登録済みメッセージを送信</option>
          <option value="send_message">テキストメッセージを送信</option>
          <option value="destination">遷移先 URL を送信（destination 参照）</option>
          <option value="noop">ログのみ（送信しない）</option>
        </select>
      </Field>

      {actionType === "message" && (
        <Field label="送信メッセージ" required hint="この作品に登録済みのメッセージを送信します。lag_ms / 「入力中…」/ 既読 / クイックリプライ等の演出は通常メッセージと同様に適用されます。">
          {messages.length > 0 ? (
            <select
              value={String(actionPayload.message_id ?? "")}
              onChange={(e) => updatePayload("message_id", e.target.value)}
              style={inputStyle}
            >
              <option value="">— メッセージを選択 —</option>
              {messages.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={String(actionPayload.message_id ?? "")}
              onChange={(e) => updatePayload("message_id", e.target.value)}
              style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
              placeholder="メッセージ ID（同一作品のメッセージのみ）"
            />
          )}
        </Field>
      )}

      {actionType === "send_message" && (
        <Field label="送信テキスト" required>
          <textarea
            value={String(actionPayload.text ?? "")}
            onChange={(e) => updatePayload("text", e.target.value)}
            rows={4}
            maxLength={1000}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="例: ビーコンの圏内に入りました。"
          />
        </Field>
      )}

      {actionType === "destination" && (
        <>
          <Field label="Destination ID" required hint="作品に登録済みの遷移先 destination の ID を指定してください。">
            <input
              type="text"
              value={String(actionPayload.destination_id ?? "")}
              onChange={(e) => updatePayload("destination_id", e.target.value)}
              style={inputStyle}
              placeholder="例: 0c3a..."
            />
          </Field>
          <Field label="送信テキスト（任意）" hint="URL の前に挿入する説明文。省略時は URL のみ送信。">
            <input
              type="text"
              value={String(actionPayload.text ?? "")}
              onChange={(e) => updatePayload("text", e.target.value)}
              maxLength={500}
              style={inputStyle}
            />
          </Field>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="submit"
          disabled={saving}
          style={{ padding: "9px 22px", background: "#2563eb", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "保存中…" : (mode === "create" ? "作成" : "保存")}
        </button>
        <Link
          href={`/oas/${oaId}/works/${workId}/beacons`}
          style={{ padding: "9px 22px", background: "#f3f4f6", color: "#374151", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
        >
          キャンセル
        </Link>
        {mode === "edit" && (
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            style={{ marginLeft: "auto", padding: "9px 22px", background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
          >
            削除
          </button>
        )}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  width: "100%",
  background: "#fff",
};

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
        {label}
        {required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "#6b7280" }}>{hint}</span>}
    </label>
  );
}
