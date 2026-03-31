"use client";

// src/app/oas/[id]/works/[workId]/scenario/page.tsx
// シナリオフロー — フェーズカード＋ツリー分岐表示

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { workApi, phaseApi, transitionApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { HelpAccordion } from "@/components/HelpAccordion";
import type { PhaseWithCounts, TransitionWithPhases, PhaseType } from "@/types";

// ── フェーズ種別メタ ──────────────────────────────
const PHASE_TYPE_META: Record<PhaseType, { label: string; color: string; bg: string; border: string }> = {
  start:  { label: "開始",         color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  normal: { label: "通常",         color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  ending: { label: "エンディング", color: "#9333ea", bg: "#faf5ff", border: "#e9d5ff" },
};

// ── 分岐の意味から色を推定 ────────────────────────
function branchColor(label: string): { color: string; bg: string; border: string } {
  const l = label.toLowerCase();
  if (l.includes("不正解") || l.includes("wrong") || l.includes("incorrect") || l.includes("✗") || l.includes("×")) {
    return { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
  }
  if (l.includes("正解") || l.includes("correct") || l.includes("✓") || l.includes("○") || l.includes("ok")) {
    return { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" };
  }
  return { color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" };
}

// ── メインページ ──────────────────────────────────
export default function ScenarioPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;

  const [workTitle, setWorkTitle]     = useState("");
  const [phases, setPhases]           = useState<PhaseWithCounts[]>([]);
  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);
  const [loading, setLoading]         = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [work, phaseList, transitionList] = await Promise.all([
        workApi.get(getDevToken(), workId),
        phaseApi.list(getDevToken(), workId),
        transitionApi.listByWork(getDevToken(), workId),
      ]);
      setWorkTitle(work.title);
      setPhases(phaseList.sort((a, b) => a.sort_order - b.sort_order));
      setTransitions(transitionList.sort((a, b) => a.sort_order - b.sort_order));
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "作品一覧", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "シナリオフロー" },
          ]} />
          <h2>シナリオフロー</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            フェーズ間の分岐構造を確認できます。「編集」から遷移・メッセージを設定できます。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/oas/${oaId}/works/${workId}/phases`} className="btn btn-ghost">
            🗂 フェーズ管理
          </Link>
        </div>
      </div>

      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "フェーズ間の分岐構造をカード形式で一覧確認できます",
          "各カードから遷移（正解・不正解など）とメッセージを直接編集できます",
        ]},
        { icon: "🗺", title: "フローの読み方", points: [
          "「開始」フェーズから始まり「エンディング」フェーズで終わります",
          "矢印は遷移条件（正解・不正解・タイムアウトなど）を表します",
          "遷移のないフェーズにはプレイヤーが行き詰まるため必ず接続してください",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「遷移を追加」でフェーズ間のつながりを設定します",
          "遷移ラベルで正解・不正解・タイムアウトなどを区別します",
          "フェーズ自体の追加は「フェーズ管理」から行います",
        ]},
      ]} />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ padding: 20 }}>
              <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: 300, height: 13 }} />
            </div>
          ))}
        </div>
      ) : phases.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: "40px 16px" }}>
            <div className="empty-state-icon">🗺️</div>
            <p className="empty-state-title">フェーズがまだありません</p>
            <p className="empty-state-desc">
              「フェーズ管理」からフェーズを追加すると、ここにフローが表示されます。
            </p>
            <Link href={`/oas/${oaId}/works/${workId}/phases`} className="btn btn-primary" style={{ marginTop: 12 }}>
              🗂 フェーズ管理へ
            </Link>
          </div>
        </div>
      ) : (
        <FlowTree phases={phases} transitions={transitions} oaId={oaId} workId={workId} />
      )}
    </>
  );
}

// ── FlowTree ──────────────────────────────────────
interface FlowTreeProps {
  phases:      PhaseWithCounts[];
  transitions: TransitionWithPhases[];
  oaId:        string;
  workId:      string;
}

function FlowTree({ phases, transitions, oaId, workId }: FlowTreeProps) {
  const phaseMap = Object.fromEntries(phases.map((p) => [p.id, p]));
  const fromMap: Record<string, TransitionWithPhases[]> = {};
  for (const t of transitions) {
    if (!fromMap[t.from_phase_id]) fromMap[t.from_phase_id] = [];
    fromMap[t.from_phase_id].push(t);
  }
  const toMap: Record<string, TransitionWithPhases[]> = {};
  for (const t of transitions) {
    if (!toMap[t.to_phase_id]) toMap[t.to_phase_id] = [];
    toMap[t.to_phase_id].push(t);
  }

  // start → normal → ending 順、同種はsort_order順
  const sorted = [...phases].sort((a, b) => {
    const typeOrder = { start: 0, normal: 1, ending: 2 };
    const ta = typeOrder[a.phase_type as PhaseType] ?? 1;
    const tb = typeOrder[b.phase_type as PhaseType] ?? 1;
    if (ta !== tb) return ta - tb;
    return a.sort_order - b.sort_order;
  });

  // 整合性チェック
  const startCount    = phases.filter((p) => p.phase_type === "start").length;
  const deadEndPhases = phases.filter(
    (p) => p.phase_type !== "ending" && (fromMap[p.id] ?? []).length === 0
  );
  const orphanPhases  = phases.filter(
    (p) => p.phase_type !== "start" && (toMap[p.id] ?? []).length === 0
  );
  const hasWarnings = startCount === 0 || deadEndPhases.length > 0 || orphanPhases.length > 0;

  return (
    <div>
      {/* 整合性ウォーニング */}
      {hasWarnings && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10,
          padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#92400e",
        }}>
          <strong style={{ display: "block", marginBottom: 6 }}>⚠ シナリオの構成に注意が必要な箇所があります</strong>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            {startCount === 0 && (
              <li>開始フェーズがありません。Bot がどこからシナリオを始めるか不明です。</li>
            )}
            {deadEndPhases.map((p) => (
              <li key={p.id}>
                <span style={{ fontWeight: 600 }}>「{p.name}」</span>
                （{PHASE_TYPE_META[p.phase_type].label}）に遷移が設定されていません。
                <Link href={`/oas/${oaId}/works/${workId}/phases/${p.id}`}
                  style={{ color: "#b45309", textDecoration: "underline", marginLeft: 6 }}>
                  遷移を追加 →
                </Link>
              </li>
            ))}
            {orphanPhases.map((p) => (
              <li key={p.id}>
                <span style={{ fontWeight: 600 }}>「{p.name}」</span>
                （{PHASE_TYPE_META[p.phase_type].label}）へ向かう遷移がありません（孤立）。
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* フェーズカードリスト */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {sorted.map((phase, phaseIdx) => {
          const meta     = PHASE_TYPE_META[phase.phase_type];
          const outgoing = fromMap[phase.id] ?? [];
          const isLast   = phaseIdx === sorted.length - 1;
          const hasNoOut = phase.phase_type !== "ending" && outgoing.length === 0 && phases.length > 1;

          return (
            <div key={phase.id}>
              {/* ── フェーズカード ── */}
              <div style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderLeft: `4px solid ${meta.color}`,
                borderRadius: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                opacity: phase.is_active ? 1 : 0.6,
                overflow: "hidden",
              }}>
                {/* ── カードヘッダー ── */}
                <div style={{ padding: "16px 20px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {/* 種別バッジ */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                      color: meta.color, background: meta.bg,
                      padding: "3px 10px", borderRadius: 20, flexShrink: 0,
                      border: `1px solid ${meta.border}`,
                    }}>
                      {meta.label}
                    </span>

                    {/* フェーズ名 */}
                    <span style={{
                      fontWeight: 700, fontSize: 16, color: "#111827",
                      flex: 1, lineHeight: 1.3,
                    }}>
                      {phase.name}
                      {hasNoOut && (
                        <span
                          title="遷移が未設定"
                          style={{ color: "#f59e0b", marginLeft: 8, fontSize: 13, fontWeight: 400 }}
                        >
                          ⚠ 遷移なし
                        </span>
                      )}
                    </span>

                    {/* 編集ボタン */}
                    <Link
                      href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
                      className="btn btn-ghost"
                      style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                    >
                      編集
                    </Link>
                  </div>

                  {/* メタ情報行 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 16,
                    marginTop: 10, paddingTop: 10,
                    borderTop: "1px solid #f3f4f6",
                  }}>
                    <MetaChip icon="💬" value={phase._count.messages} label="メッセージ" />
                    <MetaChip icon="⤵" value={outgoing.length} label="分岐" />
                    {!phase.is_active && (
                      <span style={{
                        fontSize: 11, color: "#9ca3af",
                        background: "#f3f4f6", padding: "2px 8px", borderRadius: 6,
                      }}>
                        無効
                      </span>
                    )}
                    {phase.phase_type === "ending" && (
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: meta.color,
                        background: meta.bg,
                        padding: "2px 8px", borderRadius: 6,
                        border: `1px solid ${meta.border}`,
                      }}>
                        🏁 シナリオ終端
                      </span>
                    )}
                  </div>
                </div>

                {/* ── 分岐ツリー ── */}
                {outgoing.length > 0 && (
                  <div style={{
                    borderTop: "1px solid #f3f4f6",
                    background: "#fafafa",
                    padding: "12px 20px 12px 28px",
                  }}>
                    {outgoing.map((tr, trIdx) => {
                      const isLastBranch = trIdx === outgoing.length - 1;
                      const toPhase      = phaseMap[tr.to_phase_id];
                      const toMeta       = toPhase ? PHASE_TYPE_META[toPhase.phase_type] : null;
                      const bc           = branchColor(tr.label);

                      return (
                        <div key={tr.id} style={{
                          display: "flex", alignItems: "stretch",
                          minHeight: 44,
                        }}>
                          {/* ツリー線 */}
                          <div style={{
                            width: 22, flexShrink: 0,
                            display: "flex", flexDirection: "column", alignItems: "center",
                          }}>
                            <div style={{ width: 2, flex: "0 0 18px", background: "#d1d5db" }} />
                            <div style={{ width: 2, flex: "0 0 2px", background: "#d1d5db", position: "relative" }}>
                              <div style={{
                                position: "absolute", top: "50%", left: 0,
                                width: 16, height: 2, background: "#d1d5db",
                                transform: "translateY(-50%)",
                              }} />
                            </div>
                            <div style={{
                              width: 2, flex: 1,
                              background: isLastBranch ? "transparent" : "#d1d5db",
                            }} />
                          </div>

                          {/* 分岐内容 */}
                          <div style={{
                            flex: 1, paddingLeft: 10,
                            display: "flex", alignItems: "center",
                            flexWrap: "wrap", gap: 8,
                            paddingTop: 6, paddingBottom: 6,
                          }}>
                            {/* ラベルチップ */}
                            <span style={{
                              fontSize: 12, fontWeight: 700,
                              color: bc.color, background: bc.bg,
                              border: `1px solid ${bc.border}`,
                              padding: "4px 12px", borderRadius: 20,
                              whiteSpace: "nowrap", flexShrink: 0,
                            }}>
                              {tr.label}
                            </span>

                            {/* 矢印 */}
                            <span style={{
                              color: "#9ca3af", fontSize: 16, flexShrink: 0,
                              lineHeight: 1,
                            }}>
                              →
                            </span>

                            {/* 遷移先チップ */}
                            {toPhase && toMeta ? (
                              <Link
                                href={`/oas/${oaId}/works/${workId}/phases/${toPhase.id}`}
                                style={{ textDecoration: "none", flexShrink: 0 }}
                              >
                                <span style={{
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                  fontSize: 13, fontWeight: 600,
                                  background: "#fff",
                                  border: `1.5px solid ${toMeta.border}`,
                                  color: "#111827",
                                  padding: "4px 12px", borderRadius: 20,
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                                }}>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700,
                                    color: toMeta.color, background: toMeta.bg,
                                    padding: "1px 6px", borderRadius: 10,
                                  }}>
                                    {toMeta.label}
                                  </span>
                                  {toPhase.name}
                                </span>
                              </Link>
                            ) : (
                              <span style={{
                                fontSize: 12, color: "#ef4444",
                                background: "#fef2f2", border: "1px solid #fecaca",
                                padding: "3px 10px", borderRadius: 20,
                              }}>
                                遷移先なし
                              </span>
                            )}

                            {/* 補足タグ群 */}
                            {tr.condition && (
                              <span style={{
                                fontSize: 11, color: "#6b7280",
                                background: "#f3f4f6", border: "1px solid #e5e7eb",
                                padding: "2px 8px", borderRadius: 6,
                                whiteSpace: "nowrap",
                              }}>
                                🔑 {tr.condition}
                              </span>
                            )}
                            {tr.flag_condition && (
                              <span style={{
                                fontSize: 11, color: "#7c3aed",
                                background: "#f5f3ff", border: "1px solid #e9d5ff",
                                padding: "2px 8px", borderRadius: 6,
                                whiteSpace: "nowrap",
                              }}>
                                🏷 {tr.flag_condition}
                              </span>
                            )}
                            {!tr.is_active && (
                              <span style={{
                                fontSize: 11, color: "#9ca3af",
                                background: "#f3f4f6", border: "1px solid #e5e7eb",
                                padding: "2px 8px", borderRadius: 6,
                              }}>
                                無効
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* フェーズ間コネクター */}
              {!isLast && (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "2px 0",
                }}>
                  <div style={{ width: 2, height: 16, background: "#d1d5db" }} />
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: "6px solid #d1d5db",
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 凡例 */}
      <div style={{
        display: "flex", gap: 12, marginTop: 20,
        flexWrap: "wrap", alignItems: "center",
        padding: "12px 16px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        fontSize: 11, color: "#6b7280",
      }}>
        <span style={{ fontWeight: 600 }}>凡例：</span>
        {[
          { label: "正解", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
          { label: "不正解", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
          { label: "その他", color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
        ].map(({ label, color, bg, border }) => (
          <span key={label} style={{
            fontSize: 11, fontWeight: 700, color,
            background: bg, border: `1px solid ${border}`,
            padding: "2px 10px", borderRadius: 20,
          }}>
            {label}
          </span>
        ))}
        <span style={{ marginLeft: 4 }}>💬 メッセージ数　⤵ 分岐数</span>
      </div>
    </div>
  );
}

// ── MetaChip — メタ情報アイコン＋数値 ──────────────
function MetaChip({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 12, color: "#6b7280",
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <strong style={{ color: "#374151", fontWeight: 700 }}>{value}</strong>
      <span>{label}</span>
    </span>
  );
}
