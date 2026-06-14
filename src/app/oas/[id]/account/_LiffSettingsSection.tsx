"use client";

// src/app/oas/[id]/account/_LiffSettingsSection.tsx
// 旧「OA設定 > LIFF設定」(/oas/[id]/settings/liff) の入力項目を「アカウント情報」に統合したセクション。
//  - LIFF ID（OA 専用）/ Scan QR フラグの編集（owner のみ・API も owner gate）
//  - LIFF URL / 実機確認用 URL + QR / LINE Developers Endpoint 推奨値（読み取り）
// 保存は既存 API /api/oas/:id/liff-settings をそのまま流用（API/DB schema は不変）。
// プラン: LIFF 表示設定は Pro（plus）相当が必要（FEATURE.liffDisplay）。

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { getAuthHeaders } from "@/lib/api-client";
import { buildLiffUrl } from "@/lib/liff/config";

interface LiffSettings {
  liff_id: string | null;
  liff_endpoint_url: string | null;
  liff_scan_qr_enabled: boolean;
  resolved_liff_id: string | null;
  liff_id_source: "oa" | "env" | "none";
  is_configured: boolean;
  recommended_endpoint_url: string;
}

export function LiffSettingsSection({ oaId }: { oaId: string }) {
  const { showToast } = useToast();
  const { isOwner, loading: roleLoading } = useWorkspaceRole(oaId);

  // プラン制限: LIFF 表示設定は plus（Pro）以上。owner の表示確認モードを反映するため effectivePlan を使う。
  const { effectivePlan, loading: planLoading } = useAccessPreview(oaId);
  const planAccess = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.liffDisplay });

  const [settings, setSettings]   = useState<LiffSettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 編集フォーム状態
  const [liffIdInput, setLiffIdInput] = useState("");
  const [scanQr, setScanQr]           = useState(false);
  const [saving, setSaving]           = useState(false);
  const [copied, setCopied]           = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/oas/${oaId}/liff-settings`, { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json) => {
        if (cancelled) return;
        const data = json.data as LiffSettings;
        setSettings(data);
        setLiffIdInput(data.liff_id ?? "");
        setScanQr(data.liff_scan_qr_enabled);
      })
      .catch(() => { if (!cancelled) setLoadError("LIFF 設定の読み込みに失敗しました"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [oaId]);

  const canEdit = isOwner && planAccess.allowed;
  const resolvedLiffId = settings?.resolved_liff_id ?? null;
  const liffUrl = buildLiffUrl({ liffId: resolvedLiffId, path: "" });

  async function handleSave() {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/liff-settings`, {
        method:  "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body:    JSON.stringify({ liff_id: liffIdInput.trim() || null, liff_scan_qr_enabled: scanQr }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error?.message ?? "保存に失敗しました";
        showToast(msg, "error");
        return;
      }
      setSettings(json.data as LiffSettings);
      setLiffIdInput((json.data as LiffSettings).liff_id ?? "");
      showToast("LIFF 設定を保存しました", "success");
    } catch {
      showToast("保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  const heading = (
    <div className="mb-3">
      <h3 className="text-[15px] font-extrabold text-ink">LIFF設定</h3>
      <p className="mt-1 text-[12px] text-ink-3">
        LINE アプリ内で動く LIFF の ID・実機確認用 URL・QR 読み取り設定を管理します（OA 単位）。
      </p>
    </div>
  );

  return (
    <section className="mt-8 w-full max-w-[680px]">
      {heading}

      {!planLoading && !planAccess.allowed ? (
        <PlanRequiredCard
          oaId={oaId}
          featureKey={FEATURE.liffDisplay}
          currentPlan={effectivePlan}
          featureLabel="LIFF設定"
        />
      ) : loading || roleLoading ? (
        <div className="card" style={{ padding: 20 }}>
          <div className="skeleton" style={{ width: 220, height: 16, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: "100%", height: 38 }} />
        </div>
      ) : loadError ? (
        <div className="alert alert-error">{loadError}</div>
      ) : settings ? (
        <div className="flex flex-col gap-4">
          {/* ── ステータス + 入力 ── */}
          <div className="card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-bold text-ink">LIFF ID</span>
              {settings.is_configured ? (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-ink border border-brand/30">設定済み</span>
              ) : (
                <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger border border-danger/30">未設定</span>
              )}
              {settings.liff_id_source === "env" && (
                <span className="text-[11px] text-ink-3">（環境変数 NEXT_PUBLIC_LIFF_ID のフォールバックを使用中）</span>
              )}
            </div>

            {/* LIFF ID 入力（owner のみ編集可） */}
            <div className="mt-3">
              <label className="block text-[12px] font-semibold text-ink-2 mb-1">この OA の LIFF ID</label>
              <input
                type="text"
                value={liffIdInput}
                onChange={(e) => setLiffIdInput(e.target.value)}
                disabled={!canEdit || saving}
                placeholder="例: 1234567890-abcdEFGH（未設定なら環境変数を使用）"
                className="form-input w-full font-mono text-[13px]"
                style={{ opacity: canEdit ? 1 : 0.7 }}
              />
              <p className="mt-1 text-[11px] text-ink-3">
                LINE Developers Console の LIFF アプリ ID。空にすると環境変数 NEXT_PUBLIC_LIFF_ID にフォールバックします。
              </p>
            </div>

            {/* Scan QR トグル */}
            <label className="mt-3 flex items-start gap-2" style={{ cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={scanQr}
                disabled={!canEdit || saving}
                onChange={(e) => setScanQr(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span className="text-[13px] font-semibold text-ink">QR コード読み取りを使う想定</span>
                <span className="block text-[11px] text-ink-3 mt-0.5 leading-relaxed">
                  QR コード読み取りを使う場合は、<strong>LINE Developers Console の LIFF 設定で Scan QR を有効にしてください</strong>。このフラグは管理画面/Runtime の表示制御用です。
                </span>
              </span>
            </label>

            {canEdit && (
              <div className="mt-4">
                <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary">
                  {saving ? "保存中…" : "LIFF設定を保存する"}
                </button>
              </div>
            )}
            {!isOwner && (
              <p className="mt-3 text-[11px] text-ink-3">※ LIFF 設定の編集はオーナーのみ可能です（閲覧のみ）。</p>
            )}
          </div>

          {/* ── 実機確認 URL / QR ── */}
          <div className="card" style={{ padding: "16px 20px" }}>
            <h4 className="text-[13px] font-bold text-ink mb-2">実機で確認する</h4>
            {resolvedLiffId && liffUrl ? (
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <div className="text-[11px] font-semibold text-ink-2 mb-0.5">LIFF URL（実機確認用）</div>
                    <input readOnly value={liffUrl} onFocus={(e) => e.currentTarget.select()}
                      className="form-input w-full font-mono text-[12px]" />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => handleCopy(liffUrl)} className="btn btn-ghost btn-sm">
                      {copied ? "コピーしました!" : "URL をコピー"}
                    </button>
                    <a href={liffUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">別タブで開く</a>
                  </div>
                  <p className="text-[11px] text-ink-3 leading-relaxed">
                    LINE アプリでこの URL（または QR）を開くと、Endpoint URL 配下の LIFF Runtime が起動します。
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <div className="p-2 border border-line rounded bg-white">
                    <QRCodeSVG value={liffUrl} size={112} level="M" />
                  </div>
                  <div className="text-[10px] text-ink-3">QR でスマホ/LINE から</div>
                </div>
              </div>
            ) : (
              <div className="rounded-field border border-warn/30 bg-warn-soft px-4 py-3 text-[12px] text-warn leading-relaxed">
                LIFF ID が未設定のため、実機確認用 URL を発行できません。上で LIFF ID を設定するか、環境変数 <code>NEXT_PUBLIC_LIFF_ID</code> を設定してください。
              </div>
            )}
          </div>

          {/* ── LINE Developers 推奨設定 ── */}
          <div className="card" style={{ padding: "16px 20px" }}>
            <h4 className="text-[13px] font-bold text-ink mb-2">LINE Developers Console の設定</h4>
            <div className="text-[12px] text-ink-2 mb-1">Endpoint URL（推奨値）</div>
            <input readOnly value={settings.recommended_endpoint_url} onFocus={(e) => e.currentTarget.select()}
              className="form-input w-full font-mono text-[12px]" />
            <ul className="mt-2 text-[11px] text-ink-3 leading-relaxed list-disc pl-4 space-y-1">
              <li>該当 LIFF アプリの Endpoint URL を上記（…/liff）に設定してください。ルート( / ) や /oas に向いていると管理画面本体が開いてしまいます。</li>
              <li>QR 読み取りを使う場合は、LIFF アプリ設定で <strong>Scan QR を ON</strong> にしてください。</li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
