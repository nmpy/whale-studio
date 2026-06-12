"use client";

// src/app/admin/personal-plan-permissions/_client.tsx
// 個人プラン権限の管理 UI（platform admin 専用ページ本体）。
// - usageType=personal の OA 一覧（プラン / トライアル状態 / 上限 / オーナー / 日時）
// - 簡易検索（OA名 / オーナーメール）+ プラン / トライアル状態の絞り込み
// - プラン手動変更（Basic/Standard/Pro/Pro Max）。Stripe 連動（external_billing）は変更不可。
//   委託プランは法人向けのため選択肢に含めない。

import { useEffect, useState, useCallback, useMemo } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { PLAN_LABELS } from "@/lib/constants/plans";

type PlanTierKey = "basic" | "standard" | "plus" | "pro";

// 個人プラン権限で扱うプラン（delegated=委託は法人向けのため除外）
const PLAN_CHANGE_OPTIONS: { value: PlanTierKey; label: string }[] = [
  { value: "basic",    label: PLAN_LABELS.basic },
  { value: "standard", label: PLAN_LABELS.standard },
  { value: "plus",     label: PLAN_LABELS.plus },  // "Pro"
  { value: "pro",      label: PLAN_LABELS.pro },   // "Pro Max"
];

interface Row {
  id:               string;
  title:            string;
  usage_type:       string;
  plan_name:        string | null;
  plan_tier:        string | null;
  plan_label:       string | null;
  status:           string | null;
  trial_label:      string;
  max_works:        number | null;
  max_players:      number | null;
  external_billing: boolean;
  owner_user_id:    string | null;
  owner_username:   string | null;
  owner_email:      string | null;
  created_at:       string;
  updated_at:       string;
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 14 };
const inputStyle: React.CSSProperties = {
  padding: "7px 10px", fontSize: 13, border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff", color: "#111827",
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); } catch { return dt; }
}
function limitLabel(n: number | null): string {
  if (n === null) return "—";
  return n < 0 ? "無制限" : String(n);
}
const TRIAL_META: Record<string, { color: string; bg: string }> = {
  "トライアル中": { color: "#1d4ed8", bg: "#eff6ff" },
  "通常":         { color: "#166534", bg: "#f0fdf4" },
  "期限切れ":     { color: "#92400e", bg: "#fffbeb" },
  "不明":         { color: "#374151", bg: "#f3f4f6" },
};

export function PersonalPlanPermissionsClient() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState<string | null>(null);

  // フィルタ
  const [qName, setQName] = useState("");
  const [qEmail, setQEmail] = useState("");
  const [fPlan, setFPlan] = useState<string>("all");
  const [fTrial, setFTrial] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/personal-plan-permissions", { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) { showToast("一覧の取得に失敗しました", "error"); setRows([]); return; }
      const json = await res.json();
      setRows((json?.data ?? []) as Row[]);
    } catch {
      showToast("一覧の取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (qName.trim()  && !r.title.toLowerCase().includes(qName.trim().toLowerCase())) return false;
    if (qEmail.trim() && !(r.owner_email ?? "").toLowerCase().includes(qEmail.trim().toLowerCase())) return false;
    if (fPlan  !== "all" && r.plan_tier !== fPlan) return false;
    if (fTrial !== "all" && r.trial_label !== fTrial) return false;
    return true;
  }), [rows, qName, qEmail, fPlan, fTrial]);

  async function handleChangePlan(oaId: string, planTier: string) {
    if (!planTier) return;
    if (!confirm(`このアカウントのプランを「${PLAN_LABELS[planTier as PlanTierKey]}」に変更しますか？\n（運営による手動付与です。Stripe の課金状態は変更されません）`)) return;
    setChangingId(oaId);
    try {
      const res = await fetch(`/api/admin/personal-plan-permissions/${oaId}/plan`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ planTier }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { showToast(json?.error?.message ?? "プラン変更に失敗しました", "error"); return; }
      showToast("プランを変更しました（手動付与・Stripe 非連動）", "success");
      void load();
    } catch {
      showToast("プラン変更に失敗しました", "error");
    } finally {
      setChangingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1040 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>個人プラン権限</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8, lineHeight: 1.7 }}>
        個人利用アカウントのプラン・権限を管理します。
      </p>
      <p style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", marginBottom: 16, lineHeight: 1.7 }}>
        プラン変更は運営による手動付与です。Stripe の課金状態は自動変更されません。外部決済（Stripe）連動中のアカウントは変更できません。
      </p>

      {/* フィルタ */}
      <div style={{ ...card, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, minWidth: 160 }} placeholder="OA名で検索" value={qName} onChange={(e) => setQName(e.target.value)} />
        <input style={{ ...inputStyle, minWidth: 200 }} placeholder="オーナーメールで検索" value={qEmail} onChange={(e) => setQEmail(e.target.value)} />
        <select style={inputStyle} value={fPlan} onChange={(e) => setFPlan(e.target.value)}>
          <option value="all">プラン: すべて</option>
          {PLAN_CHANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select style={inputStyle} value={fTrial} onChange={(e) => setFTrial(e.target.value)}>
          <option value="all">トライアル状態: すべて</option>
          <option value="トライアル中">トライアル中</option>
          <option value="通常">通常</option>
          <option value="期限切れ">期限切れ</option>
          <option value="不明">不明</option>
        </select>
        <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} 件</span>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>個人利用アカウントがまだありません。</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>条件に一致するアカウントがありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((r) => {
            const tm = TRIAL_META[r.trial_label] ?? TRIAL_META["不明"];
            return (
              <div key={r.id} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{r.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#f3f4f6", color: "#6b7280" }}>個人</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{r.plan_label ?? "未契約"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: tm.color, background: tm.bg }}>{r.trial_label}</span>
                  {r.external_billing && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#3730a3" }}>Stripe連動</span>
                  )}
                </div>

                <dl style={{ display: "grid", gridTemplateColumns: "92px 1fr 92px 1fr", gap: "3px 10px", fontSize: 12, color: "#374151", margin: "8px 0 0" }}>
                  <dt style={{ color: "#9ca3af" }}>作品数上限</dt><dd style={{ margin: 0 }}>{limitLabel(r.max_works)}</dd>
                  <dt style={{ color: "#9ca3af" }}>プレイヤー上限</dt><dd style={{ margin: 0 }}>{limitLabel(r.max_players)}</dd>
                  <dt style={{ color: "#9ca3af" }}>オーナー</dt><dd style={{ margin: 0 }}>{r.owner_username ?? "—"}</dd>
                  <dt style={{ color: "#9ca3af" }}>メール</dt><dd style={{ margin: 0 }}>{r.owner_email ?? "—"}</dd>
                  <dt style={{ color: "#9ca3af" }}>作成</dt><dd style={{ margin: 0 }}>{fmt(r.created_at)}</dd>
                  <dt style={{ color: "#9ca3af" }}>更新</dt><dd style={{ margin: 0 }}>{fmt(r.updated_at)}</dd>
                </dl>

                {/* プラン手動変更 */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e5e7eb", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>プラン変更:</span>
                  <select
                    style={{ ...inputStyle, opacity: r.external_billing || changingId === r.id ? 0.5 : 1 }}
                    disabled={r.external_billing || changingId === r.id}
                    defaultValue=""
                    onChange={(e) => { const v = e.target.value; e.target.value = ""; void handleChangePlan(r.id, v); }}
                  >
                    <option value="" disabled>変更先を選択…</option>
                    {PLAN_CHANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {r.external_billing && (
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>Stripe 連動中のため変更できません</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
