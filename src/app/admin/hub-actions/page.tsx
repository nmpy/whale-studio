"use client";

// src/app/admin/hub-actions/page.tsx
// 作品ハブ 主要アクション行クリック分析（プラットフォームオーナー専用）
//
// 集計ソース: event_logs (event_name = "hub_action_click")
// API: GET /api/analytics/hub-actions
//
// 見られること:
//   - action_key ごとのクリック数（何のアクションが押されやすいか）
//   - emphasis ごとのクリック数（warning/preview 強調の効果検証）
//   - position_index ごとの傾向（先頭ほど押されるか）
//   - status 別のアクションパターン（draft/active で違うか）
//   - players=0 の作品での preview クリック率（Rule4 の効果検証）

import { useEffect, useState } from "react";
import { getAuthHeaders }      from "@/lib/api-client";
import type { HubActionAnalytics } from "@/app/api/analytics/hub-actions/route";

// ── 定数 ──────────────────────────────────────────────────────────────────

const EMPHASIS_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  preview: { color: "#0369a1", bg: "#f0f9ff", border: "#bae6fd" },
  warning: { color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  normal:  { color: "#374151", bg: "#f3f4f6", border: "#d1d5db" },
};

const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  draft:  { color: "#6b7280", bg: "#f3f4f6" },
  active: { color: "#166534", bg: "#dcfce7" },
  paused: { color: "#92400e", bg: "#fef3c7" },
};

// ── ヘルパー ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
}

function barWidth(count: number, max: number): string {
  if (max === 0) return "0%";
  return `${Math.max(Math.round((count / max) * 100), count > 0 ? 2 : 0)}%`;
}

// ── 共通コンポーネント ────────────────────────────────────────────────────

function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        {label}
      </h3>
      {sub && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function BarRow({
  label, sublabel, count, pct, barColor, isLast,
}: {
  label:    string;
  sublabel?: string;
  count:    number;
  pct:      number;
  barColor: string;
  isLast:   boolean;
}) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          12,
      padding:      "11px 0",
      borderBottom: isLast ? "none" : "1px solid #f3f4f6",
    }}>
      {/* ラベル */}
      <div style={{ width: 130, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </div>
        {sublabel && (
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1, fontFamily: "monospace" }}>
            {sublabel}
          </div>
        )}
      </div>

      {/* バー */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
          <div style={{
            height:     "100%",
            width:      `${pct}%`,
            borderRadius: 99,
            background: barColor,
            transition: "width 0.5s ease",
            minWidth:   count > 0 ? 4 : 0,
          }} />
        </div>
      </div>

      {/* 件数 / % */}
      <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: barColor }}>
          {count.toLocaleString()}件
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 0", borderBottom: i < n - 1 ? "1px solid #f3f4f6" : "none",
        }}>
          <div className="skeleton" style={{ width: 130, height: 14 }} />
          <div className="skeleton" style={{ flex: 1, height: 8, borderRadius: 99 }} />
          <div className="skeleton" style={{ width: 80, height: 14 }} />
        </div>
      ))}
    </>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────

export default function AdminHubActionsPage() {
  const [data,    setData]    = useState<HubActionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/hub-actions", { headers: authHeaders() });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.data ?? json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── ヘッダー（常時表示） ────────────────────────────────────────────────
  const header = (
    <div className="page-header" style={{ marginBottom: 20 }}>
      <div>
        <h2 style={{ margin: 0 }}>ハブ操作分析</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          作品ハブの主要アクション行クリックを集計します（hub_action_click イベント）
        </p>
      </div>
      <button
        className="btn btn-ghost"
        onClick={load}
        disabled={loading}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {loading
          ? <span className="spinner" style={{ width: 14, height: 14 }} />
          : <span style={{ fontSize: 14 }}>↻</span>
        }
        更新
      </button>
    </div>
  );

  if (error) {
    return (
      <>
        {header}
        <div className="alert alert-error">
          {error}
          <button
            onClick={load}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      </>
    );
  }

  // ── ローディング ────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <>
        {header}
        <div className="skeleton" style={{ height: 36, borderRadius: 8, marginBottom: 20 }} />
        <div className="card" style={{ padding: "4px 20px 12px", marginBottom: 16 }}>
          <SkeletonRows n={5} />
        </div>
        <div className="card" style={{ padding: "4px 20px 12px" }}>
          <SkeletonRows n={3} />
        </div>
      </>
    );
  }

  if (!data) return null;

  const { total, by_action_key, by_emphasis, by_position, by_status, no_players } = data;
  const maxActionCount   = Math.max(...by_action_key.map((r) => r.count),   1);
  const maxPositionCount = Math.max(...by_position.map((r) => r.count),     1);

  return (
    <>
      {header}

      {/* ── 合計バッジ ── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        marginBottom: 20,
        padding:      "10px 16px",
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md, 10px)",
        fontSize:     13,
      }}>
        <span style={{ color: "var(--color-primary, #2F6F5E)" }}>
          <strong>{total.toLocaleString()} 件</strong>のクリックを集計しています
        </span>
        {total === 0 && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>
            （まだデータがありません）
          </span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          1. action_key ごとのクリック数
          分析: どのアクションが最も押されるか
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 8px", marginBottom: 16 }}>
        <SectionHeader
          label="アクション別クリック数"
          sub="どの操作ボタンが最も押されているか"
        />
        {by_action_key.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>データなし</p>
        ) : (
          by_action_key.map((row, i) => (
            <BarRow
              key={row.key}
              label={row.label}
              sublabel={row.key}
              count={row.count}
              pct={row.pct}
              barColor="var(--color-primary, #2F6F5E)"
              isLast={i === by_action_key.length - 1}
            />
          ))
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          2. emphasis ごとのクリック数
          分析: warning（amber）/ preview（sky-blue）強調の効果検証
               強調ありの項目が通常より押されているなら効果あり
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 8px", marginBottom: 16 }}>
        <SectionHeader
          label="強調表示別クリック数"
          sub="warning（要確認）/ preview（sky-blue）強調がクリックに影響しているか"
        />
        {by_emphasis.map((row, i) => {
          const ec = EMPHASIS_COLOR[row.emphasis] ?? EMPHASIS_COLOR.normal;
          return (
            <div key={row.emphasis} style={{
              display:      "flex",
              alignItems:   "center",
              gap:          12,
              padding:      "10px 0",
              borderBottom: i < by_emphasis.length - 1 ? "1px solid #f3f4f6" : "none",
            }}>
              {/* 強調バッジ */}
              <div style={{ width: 130, flexShrink: 0 }}>
                <span style={{
                  display:      "inline-block",
                  padding:      "2px 10px",
                  borderRadius: "var(--radius-full)",
                  fontSize:     12,
                  fontWeight:   600,
                  color:        ec.color,
                  background:   ec.bg,
                  border:       `1px solid ${ec.border}`,
                }}>
                  {row.label.split("（")[0]}
                </span>
                {row.label.includes("（") && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                    {row.label.match(/（(.+)）/)?.[1]}
                  </div>
                )}
              </div>
              {/* バー */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{
                    height:     "100%",
                    width:      barWidth(row.count, total),
                    borderRadius: 99,
                    background: ec.color,
                    transition: "width 0.5s ease",
                    minWidth:   row.count > 0 ? 4 : 0,
                  }} />
                </div>
              </div>
              {/* 件数 */}
              <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: ec.color }}>
                  {row.count.toLocaleString()}件
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                  {row.pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          3. position_index ごとの傾向
          分析: 先頭（0番）ほど押されるなら、resolveActions の並び替えは有効
               また各ポジションで実際に何のキーが表示されていたかも分かる
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 8px", marginBottom: 16 }}>
        <SectionHeader
          label="表示位置別クリック数"
          sub="左端（位置0）ほど押されるなら、resolveActions の並び替え効果が出ている"
        />
        {by_position.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>データなし</p>
        ) : (
          by_position.map((row, i) => (
            <div key={row.position} style={{
              display:      "flex",
              alignItems:   "center",
              gap:          12,
              padding:      "10px 0",
              borderBottom: i < by_position.length - 1 ? "1px solid #f3f4f6" : "none",
            }}>
              {/* 位置番号 */}
              <div style={{ width: 130, flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                  位置 {row.position + 1}番目
                </div>
                {/* その位置のアクションキー内訳 */}
                <div style={{ marginTop: 3, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {row.top_keys.map((k) => (
                    <span key={k.key} style={{
                      fontSize:     10,
                      color:        "var(--text-muted)",
                      background:   "var(--gray-50, #f9fafb)",
                      border:       "1px solid var(--border-light)",
                      borderRadius: 4,
                      padding:      "1px 5px",
                    }}>
                      {k.label} {k.count}
                    </span>
                  ))}
                </div>
              </div>
              {/* バー */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{
                    height:     "100%",
                    width:      barWidth(row.count, maxPositionCount),
                    borderRadius: 99,
                    background: "#6366f1",
                    transition: "width 0.5s ease",
                    minWidth:   row.count > 0 ? 4 : 0,
                  }} />
                </div>
              </div>
              {/* 件数 */}
              <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#6366f1" }}>
                  {row.count.toLocaleString()}件
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                  {row.pct}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          4. status 別クリック傾向
          分析: draft / active でアクションパターンが変わるか
               active で分析（audience）が上位なら運用フェーズの導線が機能している
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          label="公開ステータス別クリック傾向"
          sub="draft / active でどのアクションが押されるか"
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {by_status.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>データなし</p>
          ) : (
            by_status.map((row) => {
              const sc = STATUS_COLOR[row.status] ?? { color: "#6b7280", bg: "#f3f4f6" };
              return (
                <div key={row.status} style={{
                  flex:         "1 1 180px",
                  background:   "var(--surface)",
                  border:       "1px solid var(--border-light)",
                  borderRadius: "var(--radius-md)",
                  padding:      "14px 16px",
                }}>
                  {/* ステータスバッジ */}
                  <div style={{
                    display:      "inline-flex",
                    alignItems:   "center",
                    gap:          6,
                    padding:      "2px 10px",
                    borderRadius: "var(--radius-full)",
                    background:   sc.bg,
                    marginBottom: 10,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc.color, display: "inline-block" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>{row.label}</span>
                  </div>

                  {/* 合計 */}
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10, lineHeight: 1 }}>
                    {row.count.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>件</span>
                  </div>

                  {/* アクション内訳 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {row.top_keys.map((k, rank) => (
                      <div key={k.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          fontSize:   10,
                          fontWeight: 700,
                          color:      "var(--text-muted)",
                          width:      14,
                          flexShrink: 0,
                        }}>
                          {rank + 1}.
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>
                          {k.label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                          {k.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          5. players=0 の作品での preview クリック率
          分析: Rule4（players=0 → preview を上位に出す）の効果検証
               この値が高いほど、preview の位置引き上げが機能している
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{
        background:   "#f0f9ff",
        border:       "1px solid #bae6fd",
        borderRadius: "var(--radius-md)",
        padding:      "16px 20px",
        marginBottom: 16,
      }}>
        <SectionHeader
          label="プレイヤー未発生の作品でのプレビュー率"
          sub="players=0 の文脈でプレビューが押された割合（Rule4 の効果検証）"
        />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* 大きな数値 */}
          <div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#0369a1", lineHeight: 1 }}>
              {no_players.preview_pct}
              <span style={{ fontSize: 16, fontWeight: 400, marginLeft: 2 }}>%</span>
            </div>
            <div style={{ fontSize: 11, color: "#0369a1", marginTop: 4 }}>
              プレビュークリック率（players=0 の文脈）
            </div>
          </div>

          {/* 内訳 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 12, color: "#374151" }}>
              <span style={{ fontWeight: 700, color: "#0369a1" }}>
                {no_players.preview_clicks.toLocaleString()}件
              </span>
              <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>プレビュークリック</span>
            </div>
            <div style={{ fontSize: 12, color: "#374151" }}>
              <span style={{ fontWeight: 700 }}>
                {no_players.total_clicks.toLocaleString()}件
              </span>
              <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>players=0 の全クリック</span>
            </div>
          </div>

          {/* バー */}
          {no_players.total_clicks > 0 && (
            <div style={{ flex: "1 1 160px", minWidth: 0 }}>
              <div style={{ height: 10, borderRadius: 99, background: "#e0f2fe", overflow: "hidden" }}>
                <div style={{
                  height:     "100%",
                  width:      `${no_players.preview_pct}%`,
                  borderRadius: 99,
                  background: "#0ea5e9",
                  transition: "width 0.6s ease",
                  minWidth:   no_players.preview_clicks > 0 ? 4 : 0,
                }} />
              </div>
            </div>
          )}
        </div>

        {no_players.total_clicks === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            players=0 の作品でのクリックデータがまだありません
          </p>
        )}
      </div>

      {/* フッター注記 */}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "right" }}>
        ※ 同一ユーザーの複数クリックも件数としてカウントします。
        割合は小数点以下を四捨五入した概算です。
      </p>
    </>
  );
}
