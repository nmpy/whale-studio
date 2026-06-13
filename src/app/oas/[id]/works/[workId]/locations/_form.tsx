"use client";

// src/app/oas/[id]/works/[workId]/locations/_form.tsx
// ロケーション作成・編集共通フォーム（GPS + スタンプ対応）
// PC: 左フォーム / 右地図 sticky の 2カラムレイアウト
// SP: 縦積み（フォーム → 地図）

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { transitionApi, messageApi, getDevToken } from "@/lib/api-client";
import { Button } from "@/components/shared";
import { PlaceSearchInput } from "@/components/maps/PlaceSearchInput";
import { formatMessageOptionLabel } from "@/lib/message-option-label";
import type { TransitionWithPhases, Message, MessageWithRelations } from "@/types";

// SSR セーフだが client 専用のため dynamic import（Google Maps は useEffect 内で初期化）
const LocationMapPicker = dynamic(() => import("@/components/LocationMapPicker"), { ssr: false });

interface LocationFormProps {
  onSubmit: (data: Record<string, unknown>) => void;
  saving: boolean;
  workId: string;
  defaultValues?: {
    name: string;
    description: string;
    beacon_uuid: string;
    beacon_major: number | null;
    beacon_minor: number | null;
    latitude: number | null;
    longitude: number | null;
    radius_meters: number | null;
    checkin_mode: string;
    cooldown_seconds: number;
    transition_id: string;
    qr_success_message_id: string;
    set_flags: string;
    is_active: boolean;
    stamp_enabled: boolean;
    stamp_label: string;
    stamp_order: number | null;
  };
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" };
const groupStyle: React.CSSProperties = { marginBottom: 16 };
const helpStyle: React.CSSProperties = { fontSize: 12, color: "#9ca3af", marginTop: 2 };
const subLabel: React.CSSProperties = { fontWeight: 400, color: "#9ca3af" };

function validateJson(str: string): { valid: boolean; message?: string } {
  if (!str.trim() || str.trim() === "{}") return { valid: true };
  try {
    const v = JSON.parse(str);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return { valid: false, message: "JSON オブジェクト ({...}) である必要があります" };
    return { valid: true };
  } catch {
    return { valid: false, message: "JSON の構文が正しくありません" };
  }
}

function CollapsibleSection({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
      <button
        type="button" onClick={onToggle}
        style={{
          width: "100%", padding: "10px 14px", background: "#f9fafb", border: "none",
          textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span>{title} {subtitle && <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>（{subtitle}）</span>}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
    </div>
  );
}

export function LocationForm({ onSubmit, saving, workId, defaultValues }: LocationFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  // Beacon
  const [beaconUuid, setBeaconUuid] = useState(defaultValues?.beacon_uuid ?? "");
  const [beaconMajor, setBeaconMajor] = useState(defaultValues?.beacon_major?.toString() ?? "");
  const [beaconMinor, setBeaconMinor] = useState(defaultValues?.beacon_minor?.toString() ?? "");
  const [showBeacon, setShowBeacon] = useState(!!defaultValues?.beacon_uuid);
  // Checkin mode + GPS
  const [checkinMode, setCheckinMode] = useState(defaultValues?.checkin_mode ?? "qr_only");
  const needsGps = checkinMode === "gps_only" || checkinMode === "qr_and_gps";
  const [latitude, setLatitude] = useState(defaultValues?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(defaultValues?.longitude?.toString() ?? "");
  const [radiusMeters, setRadiusMeters] = useState(defaultValues?.radius_meters?.toString() ?? "50");
  // Core
  const [cooldownSeconds, setCooldownSeconds] = useState(defaultValues?.cooldown_seconds?.toString() ?? "300");
  const [transitionId, setTransitionId] = useState(defaultValues?.transition_id ?? "");
  const [qrSuccessMessageId, setQrSuccessMessageId] = useState(defaultValues?.qr_success_message_id ?? "");
  const [setFlags, setSetFlags] = useState(defaultValues?.set_flags ?? "{}");
  const [isActive, setIsActive] = useState(defaultValues?.is_active ?? true);
  // Stamp
  const [stampEnabled, setStampEnabled] = useState(defaultValues?.stamp_enabled ?? true);
  const [stampLabel, setStampLabel] = useState(defaultValues?.stamp_label ?? "");
  const [stampOrder, setStampOrder] = useState(defaultValues?.stamp_order?.toString() ?? "");

  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);
  const [messages, setMessages] = useState<(Message | MessageWithRelations)[]>([]);
  const jsonCheck = validateJson(setFlags);

  const radiusNum = Number(radiusMeters);
  const radiusWarning = radiusNum > 0 && radiusNum < 10 ? "半径が非常に小さいです。GPS誤差を考慮して20m以上を推奨します。"
    : radiusNum > 1000 ? "半径が非常に大きいです。意図どおりか確認してください。"
    : null;

  // GPS系モード時に座標・半径が揃っているか
  const gpsIncomplete = needsGps && (!latitude || !longitude || !radiusMeters);
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const latInvalid = latitude !== "" && (isNaN(latNum) || latNum < -90 || latNum > 90);
  const lngInvalid = longitude !== "" && (isNaN(lngNum) || lngNum < -180 || lngNum > 180);

  // 地図クリック/ドラッグ時のコールバック
  const handleMapLocationChange = useCallback((lat: number, lng: number) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
  }, []);

  // 半径変更コールバック（スライダー / クイック選択 → フォーム state）
  const handleRadiusChange = useCallback((r: number) => {
    setRadiusMeters(String(r));
  }, []);

  useEffect(() => {
    (async () => {
      try { setTransitions(await transitionApi.listByWork(getDevToken(), workId)); } catch { /* ignore */ }
    })();
  }, [workId]);

  useEffect(() => {
    (async () => {
      // QR 成功時メッセージ選択用。フェーズ名を出すため with_relations を付ける。
      try { setMessages(await messageApi.list(getDevToken(), workId, { is_active: true, with_relations: true })); } catch { /* ignore */ }
    })();
  }, [workId]);

  const canSubmit = name.trim() && jsonCheck.valid && !gpsIncomplete && !latInvalid && !lngInvalid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const data: Record<string, unknown> = {
      name,
      description: description || undefined,
      cooldown_seconds: Number(cooldownSeconds) || 300,
      transition_id: transitionId || (defaultValues ? null : undefined),
      qr_success_message_id: qrSuccessMessageId || (defaultValues ? null : undefined),
      set_flags: setFlags.trim() || "{}",
      is_active: isActive,
      stamp_enabled: stampEnabled,
      stamp_label: stampLabel.trim() || (defaultValues ? null : undefined),
      stamp_order: stampOrder ? Number(stampOrder) : (defaultValues ? null : undefined),
      checkin_mode: checkinMode,
    };

    // Beacon
    if (showBeacon) {
      data.beacon_uuid = beaconUuid || (defaultValues ? null : undefined);
      data.beacon_major = beaconMajor ? Number(beaconMajor) : (defaultValues ? null : undefined);
      data.beacon_minor = beaconMinor ? Number(beaconMinor) : (defaultValues ? null : undefined);
    } else if (defaultValues) {
      data.beacon_uuid = null; data.beacon_major = null; data.beacon_minor = null;
    }

    // GPS
    if (needsGps) {
      data.latitude = latitude ? Number(latitude) : (defaultValues ? null : undefined);
      data.longitude = longitude ? Number(longitude) : (defaultValues ? null : undefined);
      data.radius_meters = radiusMeters ? Number(radiusMeters) : (defaultValues ? null : undefined);
    } else if (defaultValues) {
      data.latitude = null; data.longitude = null; data.radius_meters = null;
    }

    onSubmit(data);
  };

  // GPS 方式が未選択のときに座標セクションに出す案内
  const needGpsNote = (
    <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7 }}>
      「チェックイン方式」で <strong>GPS のみ</strong> または <strong>QR + GPS</strong> を選ぶと、地図・座標で設定できます。
    </p>
  );

  // 右側固定パネル: マップ検索 + Google Map（GPS 方式時のみ）。検索/クリック/ドラッグはすべて
  // handleMapLocationChange → フォーム state に集約され、左の座標欄・地図ピン・範囲円が同期する。
  const mapPanel = needsGps ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff" }}>
      <PlaceSearchInput onSelect={(ll) => handleMapLocationChange(ll.lat, ll.lng)} />
      <LocationMapPicker
        latitude={latitude ? Number(latitude) : null}
        longitude={longitude ? Number(longitude) : null}
        radiusMeters={Number(radiusMeters) || 50}
        onLocationChange={handleMapLocationChange}
        onRadiusChange={handleRadiusChange}
        height={460}
      />
    </div>
  ) : null;

  return (
    <form onSubmit={handleSubmit}>
      <style>{`
        @media (max-width: 900px) {
          .loc-2col { flex-direction: column !important; }
          .loc-map-aside { position: static !important; flex: 1 1 auto !important; width: 100% !important; top: auto !important; }
        }
      `}</style>

      <div className="loc-2col" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* 左: フォーム本体（セクション。順序: 名前→説明→チェックイン方式→…→座標→履歴） */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Section id="location-name" label="ロケーション名">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 受付ロビー" required aria-label="ロケーション名" />
            <p style={helpStyle}>必須項目です。</p>
          </Section>

          <Section id="description" label="説明">
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ロケーションの説明（任意）" />
          </Section>

          <Section id="checkin-mode" label="チェックイン方式">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([
                { value: "qr_only",    label: "QR のみ",  desc: "現地の QR コード読み取りでチェックイン" },
                { value: "gps_only",   label: "GPS のみ",  desc: "現在地が指定範囲内のときチェックイン" },
                { value: "qr_and_gps", label: "QR + GPS", desc: "QR 読み取り＋現在地が範囲内のときのみチェックイン" },
              ] as const).map(({ value, label, desc }) => (
                <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: `2px solid ${checkinMode === value ? "#2563eb" : "#e5e7eb"}`, borderRadius: 8, cursor: "pointer", background: checkinMode === value ? "#eff6ff" : "#fff" }}>
                  <input type="radio" name="checkin_mode" value={value} checked={checkinMode === value} onChange={() => setCheckinMode(value)} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Section>

          <Section id="beacon-settings" label="ビーコン設定">
            <CollapsibleSection title="Bluetooth ビーコン設定" subtitle="任意" open={showBeacon} onToggle={() => setShowBeacon(!showBeacon)}>
              <div>
                <label style={labelStyle}>UUID <span style={subLabel}>— ビーコン機器の識別子</span></label>
                <input style={inputStyle} value={beaconUuid} onChange={(e) => setBeaconUuid(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Major <span style={subLabel}>— グループ番号</span></label>
                  <input style={inputStyle} type="number" min="0" max="65535" value={beaconMajor} onChange={(e) => setBeaconMajor(e.target.value)} placeholder="0-65535" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Minor <span style={subLabel}>— 個体番号</span></label>
                  <input style={inputStyle} type="number" min="0" max="65535" value={beaconMinor} onChange={(e) => setBeaconMinor(e.target.value)} placeholder="0-65535" />
                </div>
              </div>
              <p style={helpStyle}>Beacon 自動検知機能で使用します。未入力でも QR / GPS チェックインは利用できます。</p>
            </CollapsibleSection>
          </Section>

          <Section id="stamp-rally-settings" label="スタンプラリー設定">
            <div style={{ padding: "12px 14px", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input type="checkbox" id="stamp_enabled" checked={stampEnabled} onChange={(e) => setStampEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
                <label htmlFor="stamp_enabled" style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>スタンプラリー対象にする</label>
              </div>
              {stampEnabled && (
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 2 }}>
                    <label style={labelStyle}>スタンプ表示名 <span style={subLabel}>— 未入力ならロケーション名</span></label>
                    <input style={inputStyle} value={stampLabel} onChange={(e) => setStampLabel(e.target.value)} placeholder={name || "ロケーション名を使用"} maxLength={100} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>並び順</label>
                    <input style={inputStyle} type="number" min="0" value={stampOrder} onChange={(e) => setStampOrder(e.target.value)} placeholder="自動" />
                  </div>
                </div>
              )}
              <p style={helpStyle}>スタンプ対象にすると、LIFF 画面のスタンプラリー進捗に含まれます。</p>
            </div>
          </Section>

          <Section id="success-action" label="成功時アクション">
            <div style={groupStyle}>
              <label style={labelStyle}>チェックイン時に設定するフラグ（JSON）</label>
              <textarea
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 13, minHeight: 60, borderColor: !jsonCheck.valid ? "#fca5a5" : "#d1d5db" }}
                value={setFlags} onChange={(e) => setSetFlags(e.target.value)} placeholder='{"visited_lobby": true}'
              />
              {!jsonCheck.valid && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 2 }}>{jsonCheck.message}</p>}
              <p style={helpStyle}>UserProgress.flags にマージされます。</p>
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>クールダウン（秒）</label>
              <input style={inputStyle} type="number" min="0" max="86400" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
              <p style={helpStyle}>同一ユーザーが連続チェックインできるまでの待機時間（デフォルト: 300秒 = 5分）</p>
            </div>
            <div style={{ ...groupStyle, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="is_active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: 16, height: 16 }} />
              <label htmlFor="is_active" style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>有効</label>
            </div>
            <p style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.6 }}>将来拡張: 報酬付与・ヒント解放などのアクションは今後追加予定です。</p>
          </Section>

          <Section id="phase-target" label="フェーズ指定">
            <label style={labelStyle}>チェックイン時に発火する遷移</label>
            <select style={inputStyle} value={transitionId} onChange={(e) => setTransitionId(e.target.value)}>
              <option value="">なし</option>
              {transitions.map((t) => (
                <option key={t.id} value={t.id}>{t.label} → {t.to_phase?.name ?? "?"}</option>
              ))}
            </select>
            <p style={helpStyle}>遷移元フェーズが現在フェーズと一致する場合のみ発火します。</p>
          </Section>

          <Section id="message-target" label="メッセージ指定">
            <label style={labelStyle}>QR成功時に送るメッセージ</label>
            <select style={inputStyle} value={qrSuccessMessageId} onChange={(e) => setQrSuccessMessageId(e.target.value)}>
              <option value="">送信しない</option>
              {qrSuccessMessageId && !messages.some((m) => m.id === qrSuccessMessageId) && (
                <option value={qrSuccessMessageId}>（選択中のメッセージ: 表示できません）</option>
              )}
              {messages.map((m) => (
                <option key={m.id} value={m.id}>{formatMessageOptionLabel(m)}</option>
              ))}
            </select>
            <p style={helpStyle}>
              LIFFでこのロケーションのQRを読み取ったとき、LINEトークに送信するメッセージを選択します。
              「送信しない」で解除できます。OAのScan QRがOFFの場合、このメッセージは送信されません。
            </p>
          </Section>

          <Section id="coordinates" label="座標">
            {needsGps ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>緯度 <span style={subLabel}>— 中心座標</span></label>
                    <input style={{ ...inputStyle, borderColor: latInvalid ? "#fca5a5" : "#d1d5db" }} type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="35.6812" />
                    {latInvalid && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>-90〜90 の範囲で入力してください</p>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>経度 <span style={subLabel}>— 中心座標</span></label>
                    <input style={{ ...inputStyle, borderColor: lngInvalid ? "#fca5a5" : "#d1d5db" }} type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="139.7671" />
                    {lngInvalid && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>-180〜180 の範囲で入力してください</p>}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>許容半径（m） <span style={subLabel}>— この範囲内ならチェックイン成功</span></label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      id="radius_meters_input"
                      style={{ ...inputStyle, width: 100, flex: "none" }}
                      type="number" min="1" max="10000" value={radiusMeters}
                      onChange={(e) => setRadiusMeters(e.target.value)}
                      onInput={(e) => setRadiusMeters((e.target as HTMLInputElement).value)}
                    />
                    <input type="range" min={10} max={500} step={5} value={radiusNum || 50} onChange={(e) => setRadiusMeters(e.target.value)} style={{ flex: 1, accentColor: "#2563eb" }} />
                  </div>
                  {radiusWarning && <p style={{ fontSize: 12, color: "#d97706", marginTop: 2 }}>{radiusWarning}</p>}
                  <p style={helpStyle}>右の地図の検索・クリック・ピンドラッグ、またはこの欄の手入力のいずれでも更新されます。範囲は地図上の円で確認できます。</p>
                </div>
                {gpsIncomplete && <p style={{ fontSize: 12, color: "#dc2626" }}>この方式では緯度・経度・半径がすべて必要です</p>}
              </div>
            ) : needGpsNote}
          </Section>

          <Section id="history" label="履歴">
            <div style={{ padding: "16px", border: "1px dashed #e5e7eb", borderRadius: 8, background: "#f9fafb", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, margin: 0 }}>
                チェックイン履歴・分析は各ロケーションの詳細画面でご確認いただけます。<br />
                （このフォームでの履歴表示は今後対応予定です）
              </p>
            </div>
          </Section>

          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            disabled={saving || !canSubmit}
            aria-busy={saving || undefined}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            {saving ? "保存中..." : defaultValues ? "更新" : "作成"}
          </Button>
        </div>

        {/* 右: マップ検索 + Google Map（PC sticky / SP は下に通常表示）。GPS 方式時のみ */}
        {needsGps && (
          <aside className="loc-map-aside" style={{ flex: "0 0 420px", position: "sticky", top: 24, alignSelf: "flex-start" }}>
            {mapPanel}
          </aside>
        )}
      </div>
    </form>
  );
}

/** フォームのセクション枠（見出し + scroll-margin で sticky header に隠れない）。 */
function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 84, marginBottom: 22 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: "0 0 10px", paddingBottom: 6, borderBottom: "1px solid #f0f0f0" }}>{label}</h3>
      {children}
    </section>
  );
}
