"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { workApi, messageApi, phaseApi, getDevToken } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { MessageWithRelations, MessageType, PhaseWithCounts } from "@/types";

const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  text:     "テキスト",
  image:    "画像",
  riddle:   "謎",
  video:    "動画",
  carousel: "カルーセル",
  voice:    "ボイス",
};

const MESSAGE_TYPE_ICON: Record<MessageType, string> = {
  text:     "💬",
  image:    "🖼",
  riddle:   "🔍",
  video:    "🎬",
  carousel: "🎠",
  voice:    "🎙",
};

const PHASE_TYPE_LABEL: Record<string, string> = {
  start:   "開始",
  normal:  "通常",
  ending:  "エンディング",
};

function CharTag({ character }: { character: MessageWithRelations["character"] }) {
  if (!character) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, color: "var(--text-secondary)",
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 22, height: 22, borderRadius: "50%",
        background: character.icon_color ?? "#6366f1", fontSize: 10, color: "#fff", fontWeight: 700,
        flexShrink: 0,
      }}>
        {character.icon_text ?? character.name.charAt(0)}
      </span>
      {character.name}
    </span>
  );
}

interface PhaseGroup {
  phase: PhaseWithCounts | null;
  messages: MessageWithRelations[];
}

const PHASE_TYPE_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  start:   { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  normal:  { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  ending:  { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff" },
};

const KIND_META: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  normal:   { label: "通常",     icon: "📨", bg: "#f0f9ff", color: "#0369a1" },
  start:    { label: "開始演出", icon: "🎬", bg: "#fef3c7", color: "#92400e" },
  response: { label: "応答",     icon: "💬", bg: "#f0fdf4", color: "#166534" },
  hint:     { label: "ヒント",   icon: "💡", bg: "#faf5ff", color: "#7e22ce" },
  puzzle:   { label: "謎",       icon: "🧩", bg: "#fff7ed", color: "#c2410c" },
};

export default function MessagesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const [workTitle, setWorkTitle]     = useState("");
  const [welcomeMsg, setWelcomeMsg]   = useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [messages, setMessages]       = useState<MessageWithRelations[]>([]);
  const [phases, setPhases]           = useState<PhaseWithCounts[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      workApi.get(token, workId),
      messageApi.list(token, workId, { with_relations: true }) as Promise<MessageWithRelations[]>,
      phaseApi.list(token, workId),
    ])
      .then(([w, list, phaseList]) => {
        setWorkTitle(w.title);
        setWelcomeMsg(w.welcome_message ?? "");
        setMessages(list);
        setPhases(phaseList.sort((a, b) => a.sort_order - b.sort_order));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  // フェーズごとにメッセージをグルーピング
  function buildPhaseGroups(): PhaseGroup[] {
    const phaseIds = new Set(phases.map((p) => p.id));
    const groups: PhaseGroup[] = phases
      .map((ph) => ({
        phase: ph,
        messages: messages
          .filter((m) => m.phase?.id === ph.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .filter((g) => g.messages.length > 0);

    const unassigned = messages
      .filter((m) => !m.phase || !phaseIds.has(m.phase.id))
      .sort((a, b) => a.sort_order - b.sort_order);

    if (unassigned.length > 0) {
      groups.push({ phase: null, messages: unassigned });
    }
    return groups;
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "メッセージ・謎" },
    ]} />
  );

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ・謎</h2></div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
              <div className="skeleton" style={{ width: 80,  height: 14 }} />
              <div className="skeleton" style={{ flex: 1,   height: 14 }} />
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ・謎</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const phaseGroups = buildPhaseGroups();

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>メッセージ・謎</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            フェーズごとに送信するメッセージを管理します
          </p>
        </div>
        <Link href={`/oas/${oaId}/works/${workId}/messages/new`} className="btn btn-primary">
          ＋ メッセージを追加
        </Link>
      </div>

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "フェーズごとに送信するメッセージを管理します",
          "テキスト・画像・謎など複数の種別を設定できます",
          "フェーズに関係なく反応する「共通メッセージ」も設定できます",
        ]},
        { icon: "💬", title: "共通メッセージとは", points: [
          "フェーズに関係なく、どの状態でも反応するメッセージです",
          "例：「ヒント」キーワードでヒントを返す、「ヘルプ」で案内を返す、「やり直し」でリセット案内を返す",
          "メッセージ追加画面で「メッセージ役割」→「共通メッセージ」を選んで設定します",
          "通常メッセージとの違い：フェーズ設定が不要で、常に最優先で評価されます",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「＋ メッセージを追加」→ フェーズとキャラクターを選んで内容を入力",
          "同一フェーズに複数ある場合は「順序」の小さい順に送信されます",
          "種別が「謎」の場合は謎管理で作成した謎を選択します",
        ]},
        { icon: "💾", title: "保存について", points: [
          "各メッセージの追加・変更は保存ボタン押下で即時反映",
          "あいさつメッセージは OA 設定 → アカウント情報 で編集・保存できます",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "フェーズ未設定かつ共通メッセージでないものは、どのフェーズでも送信されません",
          "有効／無効の切り替えは各メッセージの編集画面から行います",
        ]},
      ]} />

      {/* ══ あいさつメッセージ（読み取り専用） ══ */}
      <div className="card" style={{ maxWidth: 640, marginBottom: 24, padding: 0, overflow: "hidden" }}>
        {/* ヘッダー行 */}
        <button
          type="button"
          onClick={() => setWelcomeOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "14px 20px", background: "none", border: "none",
            cursor: "pointer", textAlign: "left",
            borderBottom: welcomeOpen ? "1px solid #e5e7eb" : "none",
            transition: "border-color 0.2s",
          }}
        >
          <span style={{ fontWeight: 600, color: "#374151", fontSize: 14, flexShrink: 0 }}>
            あいさつメッセージ
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#dc2626",
            background: "#fef2f2", padding: "1px 6px", borderRadius: 10,
            border: "1px solid #fecaca", flexShrink: 0,
          }}>
            必須
          </span>
          {welcomeMsg === null ? null : welcomeMsg.trim() ? (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#16a34a",
              background: "#dcfce7", padding: "1px 7px", borderRadius: 10, flexShrink: 0,
            }}>
              設定済み
            </span>
          ) : (
            <span style={{
              fontSize: 11, color: "#6b7280",
              background: "#f3f4f6", padding: "1px 7px", borderRadius: 10, flexShrink: 0,
            }}>
              未設定
            </span>
          )}
          {!welcomeOpen && welcomeMsg?.trim() && (
            <span style={{
              fontSize: 12, color: "#9ca3af", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
            }}>
              {welcomeMsg.split("\n")[0].slice(0, 50)}
              {welcomeMsg.split("\n")[0].length > 50 ? "…" : ""}
            </span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: 11, color: "#9ca3af",
            flexShrink: 0, transition: "transform 0.2s",
            display: "inline-block",
            transform: welcomeOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}>
            ▼
          </span>
        </button>

        {/* 展開エリア */}
        <div style={{
          overflow: "hidden",
          maxHeight: welcomeOpen ? "800px" : "0",
          transition: "max-height 0.25s ease",
        }}>
          <div style={{ padding: "16px 20px 20px" }}>
            {/* 説明帯 */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              background: "#f0f9ff", border: "1px solid #bae6fd",
              borderRadius: 8, padding: "10px 14px", marginBottom: 16,
              fontSize: 12, color: "#0369a1", lineHeight: 1.7,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
              <div>
                あいさつメッセージは <strong>OA 設定</strong> で一元管理しています。
                ここでは現在の設定を確認できます。変更する場合は「設定で編集する」から移動してください。
              </div>
            </div>

            {/* 本文表示 or 未設定案内 */}
            {welcomeMsg?.trim() ? (
              <div style={{
                background: "#f9fafb", border: "1px solid #e5e7eb",
                borderRadius: 8, padding: "14px 16px", marginBottom: 16,
              }}>
                <p style={{
                  fontSize: 12, color: "#6b7280", margin: "0 0 6px",
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  現在のあいさつメッセージ
                </p>
                <p style={{
                  fontSize: 14, color: "#111827", margin: 0,
                  whiteSpace: "pre-wrap", lineHeight: 1.8, wordBreak: "break-all",
                }}>
                  {welcomeMsg}
                </p>
              </div>
            ) : (
              <div style={{
                background: "#fffbeb", border: "1px solid #fde68a",
                borderRadius: 8, padding: "14px 16px", marginBottom: 16,
                fontSize: 13, color: "#92400e",
              }}>
                あいさつメッセージはまだ設定されていません。
                OA 設定から追加してください。
              </div>
            )}

            {/* 設定へ移動ボタン */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <a
                href={`/oas/${oaId}/account#welcome-message`}
                className="btn btn-primary"
                style={{ textDecoration: "none" }}
              >
                設定で編集する →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── メッセージ一覧 ── */}
      {messages.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p className="empty-state-title">メッセージがまだありません</p>
            <p className="empty-state-desc">
              「＋ メッセージを追加」からメッセージを作成してください。
            </p>
            <Link
              href={`/oas/${oaId}/works/${workId}/messages/new`}
              className="btn btn-primary"
              style={{ marginTop: 8, display: "inline-block" }}
            >
              ＋ 最初のメッセージを追加
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {phaseGroups.map((group, gi) => {
            const ph = group.phase;
            const typeKey = ph?.phase_type ?? "";
            const typeColor = PHASE_TYPE_COLOR[typeKey] ?? { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" };

            return (
              <div key={ph?.id ?? "__unassigned"} className="card" style={{ padding: 0, overflow: "hidden" }}>
                {/* フェーズヘッダー */}
                <div style={{
                  padding: "10px 18px",
                  background: ph ? typeColor.bg : "#fafafa",
                  borderBottom: `1px solid ${ph ? typeColor.border : "#e5e7eb"}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: ph ? typeColor.color : "#9ca3af",
                  }}>
                    {ph ? ph.name : "フェーズ未設定"}
                  </span>
                  {ph?.phase_type && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "1px 7px", borderRadius: 10,
                      background: "rgba(255,255,255,0.7)",
                      color: typeColor.color,
                      border: `1px solid ${typeColor.border}`,
                    }}>
                      {PHASE_TYPE_LABEL[ph.phase_type] ?? ph.phase_type}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
                    {group.messages.length} 件
                  </span>
                </div>

                {/* テーブル */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--gray-50)" }}>
                      {["種別", "役割", "本文", "キャラクター", "状態", "順序", ""].map((h, i) => (
                        <th
                          key={i}
                          style={{
                            padding: "8px 14px", textAlign: "left",
                            fontWeight: 600, color: "var(--text-muted)", fontSize: 11,
                            whiteSpace: "nowrap", letterSpacing: ".04em",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.messages.map((msg) => (
                      <tr
                        key={msg.id}
                        style={{ borderBottom: "1px solid var(--border-light)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--gray-50)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                      >
                        {/* 種別 */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: 11, color: "var(--text-secondary)",
                          }}>
                            {MESSAGE_TYPE_ICON[msg.message_type]}
                            {MESSAGE_TYPE_LABEL[msg.message_type]}
                          </span>
                        </td>

                        {/* 役割（kind） */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          {(() => {
                            const k = msg.kind ?? "normal";
                            const meta = KIND_META[k] ?? KIND_META.normal;
                            return (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, fontWeight: 600,
                                background: meta.bg, color: meta.color,
                                borderRadius: 8, padding: "2px 7px",
                              }}>
                                {meta.icon} {meta.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* 本文 */}
                        <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                          {msg.kind === "puzzle" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {"answer" in msg && (msg as { answer?: string | null }).answer ? (
                                <span style={{ fontSize: 12, color: "#374151" }}>
                                  答え: <span style={{ fontWeight: 600 }}>{(msg as { answer?: string | null }).answer}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: "#f97316" }}>答え未設定</span>
                              )}
                              {"puzzle_type" in msg && (msg as { puzzle_type?: string | null }).puzzle_type && (
                                <span style={{ fontSize: 10, color: "#9ca3af" }}>
                                  {(msg as { puzzle_type?: string | null }).puzzle_type}
                                </span>
                              )}
                            </div>
                          ) : msg.message_type === "image" ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {msg.asset_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={msg.asset_url}
                                  alt="画像"
                                  style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e5e5" }}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : null}
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>画像メッセージ</span>
                            </div>
                          ) : (
                            <span style={{
                              display: "-webkit-box", WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical", overflow: "hidden",
                              fontSize: 13, color: "#374151", wordBreak: "break-all",
                            }}>
                              {msg.body || <span style={{ color: "#9ca3af" }}>—</span>}
                            </span>
                          )}
                        </td>

                        {/* キャラクター */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <CharTag character={msg.character} />
                        </td>

                        {/* 状態 */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 9px", borderRadius: "var(--radius-full)",
                            fontSize: 11, fontWeight: 700,
                            background: msg.is_active ? "#dcfce7" : "var(--gray-100)",
                            color:      msg.is_active ? "#166534" : "var(--text-muted)",
                          }}>
                            {msg.is_active
                              ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
                              : "無効"
                            }
                          </span>
                        </td>

                        {/* 順序 */}
                        <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
                          {msg.sort_order}
                        </td>

                        {/* 編集 */}
                        <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link
                            href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                            className="btn btn-ghost"
                            style={{ padding: "5px 14px", fontSize: 12 }}
                          >
                            編集
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", padding: "0 4px 4px" }}>
            合計 {messages.length} 件
          </div>
        </div>
      )}
    </>
  );
}
