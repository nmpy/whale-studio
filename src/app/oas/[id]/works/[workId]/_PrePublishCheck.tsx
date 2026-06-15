"use client";

// src/app/oas/[id]/works/[workId]/_PrePublishCheck.tsx
// 作品詳細の「公開前チェック」カード。設定漏れ・導線切れ・権限不整合を表示する。
// 判定はサーバー(/api/works/[workId]/pre-publish-check)で集計し、ここは表示のみ（UI/ロジック分離）。

import { useCallback, useEffect, useState } from "react";
import { TLink as Link } from "@/components/TLink";
import { getDevToken, prePublishCheckApi } from "@/lib/api-client";
import type { PrePublishCheckResult, PrePublishCheckItem } from "@/lib/pre-publish-check";

function StatusIcon({ item }: { item: PrePublishCheckItem }) {
  if (item.status === "ok") return <span aria-label="OK" style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>;
  if (item.status === "skip") return <span aria-label="対象外" style={{ color: "#9ca3af" }}>—</span>;
  // fail
  const c = item.severity === "error" ? "#dc2626" : "#d97706";
  return <span aria-label={item.severity === "error" ? "要確認（致命的）" : "要確認"} style={{ color: c, fontWeight: 700 }}>⚠</span>;
}

export function PrePublishCheck({ oaId, workId }: { oaId: string; workId: string }) {
  void oaId; // fixHref はサーバー側で oaId 込みの相対パスを返すため未使用（明示）
  const [result, setResult] = useState<PrePublishCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await prePublishCheckApi.get(getDevToken(), workId));
    } catch {
      setError("チェック結果の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => { void load(); }, [load]);

  // 表示順: 要確認（error → warning）を上に、OK / 対象外を下に。
  const sorted = result
    ? [...result.items].sort((a, b) => rank(a) - rank(b))
    : [];

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>公開前チェック</h3>
        {result && (
          <span style={summaryBadge(result)}>
            {result.errorCount > 0
              ? `要確認 ${result.errorCount} 件`
              : result.warningCount > 0
                ? `注意 ${result.warningCount} 件`
                : "問題なし"}
          </span>
        )}
      </div>

      {loading && <p style={{ fontSize: 12, color: "#9ca3af" }}>確認中…</p>}
      {error && (
        <div style={{ fontSize: 12, color: "#b91c1c" }}>
          {error}
          <button type="button" onClick={() => void load()} style={{ marginLeft: 8, color: "#2563eb", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>再試行</button>
        </div>
      )}

      {result && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((item) => (
            <li key={item.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid #f3f4f6" }}>
              <span style={{ width: 16, flexShrink: 0, textAlign: "center", fontSize: 13, lineHeight: "20px" }}><StatusIcon item={item} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: item.status === "fail" ? "#111827" : "#374151" }}>
                  {item.label}
                  {item.status === "fail" && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 6px",
                      background: item.severity === "error" ? "#fef2f2" : "#fffbeb",
                      color:      item.severity === "error" ? "#dc2626" : "#92400e",
                      border:     `1px solid ${item.severity === "error" ? "#fecaca" : "#fde68a"}`,
                    }}>
                      {item.severity === "error" ? "致命的" : "注意"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, marginTop: 1 }}>{item.message}</div>
                {item.status === "fail" && item.fixHref && (
                  <Link href={item.fixHref} style={{ fontSize: 12, color: "#2563eb", textDecoration: "none" }}>設定を確認する →</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rank(i: PrePublishCheckItem): number {
  if (i.status === "fail" && i.severity === "error") return 0;
  if (i.status === "fail" && i.severity === "warning") return 1;
  if (i.status === "ok") return 2;
  return 3; // skip
}

function summaryBadge(r: PrePublishCheckResult): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 10px" };
  if (r.errorCount > 0)   return { ...base, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" };
  if (r.warningCount > 0) return { ...base, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" };
  return { ...base, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" };
}
