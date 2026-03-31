"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { workApi, messageApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { MessageWithRelations, MessageType } from "@/types";

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

function PhaseTag({ phase }: { phase: MessageWithRelations["phase"] }) {
  if (!phase) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 10,
      fontSize: 11, background: "#eff6ff", color: "#2563eb", fontWeight: 500,
    }}>
      {phase.name}
    </span>
  );
}

function CharTag({ character }: { character: MessageWithRelations["character"] }) {
  if (!character) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, color: "#374151",
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, borderRadius: "50%",
        background: character.icon_color ?? "#6366f1", fontSize: 10, color: "#fff", fontWeight: 700,
      }}>
        {character.icon_text ?? character.name.charAt(0)}
      </span>
      {character.name}
    </span>
  );
}

export default function MessagesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]     = useState("");
  const [welcomeMsg, setWelcomeMsg]   = useState<string>("");
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [messages, setMessages]       = useState<MessageWithRelations[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      workApi.get(token, workId),
      messageApi.list(token, workId, { with_relations: true }) as Promise<MessageWithRelations[]>,
    ])
      .then(([w, list]) => {
        setWorkTitle(w.title);
        setWelcomeMsg(w.welcome_message ?? "");
        setMessages(list);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  async function handleSaveWelcome() {
    setSavingWelcome(true);
    try {
      await workApi.update(getDevToken(), workId, {
        welcome_message: welcomeMsg.trim() || null,
      });
      showToast("あいさつメッセージを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "OA一覧", href: "/oas" },
      { label: "作品一覧", href: `/oas/${oaId}/works` },
      ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "メッセージ管理" },
    ]} />
  );

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ管理</h2></div>
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
          <div>{breadcrumb}<h2>メッセージ管理</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>メッセージ管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
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
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「＋ メッセージを追加」→ フェーズとキャラクターを選んで内容を入力",
          "同一フェーズに複数ある場合は「順序」の小さい順に送信されます",
          "種別が「謎」の場合は謎管理で作成した謎を選択します",
        ]},
        { icon: "💾", title: "保存について", points: [
          "各メッセージの追加・変更は保存ボタン押下で即時反映",
          "あいさつメッセージ（下のアコーディオン）は専用の保存ボタンで保存します",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "フェーズ未設定のメッセージはどのフェーズでも送信されません",
          "有効／無効の切り替えは各メッセージの編集画面から行います",
        ]},
      ]} />

      {/* ══ あいさつメッセージ（アコーディオン） ══ */}
      <div className="card" style={{ maxWidth: 640, marginBottom: 24, padding: 0, overflow: "hidden" }}>
        {/* ── ヘッダー（常時表示） ── */}
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
          {welcomeMsg.trim() ? (
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
          {!welcomeOpen && welcomeMsg.trim() && (
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

        {/* ── アコーディオン本体 ── */}
        <div style={{
          overflow: "hidden",
          maxHeight: welcomeOpen ? "800px" : "0",
          transition: "max-height 0.25s ease",
        }}>
          <div style={{ padding: "16px 20px 20px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              友達追加時や未開始状態で話しかけたときに送信される最初のメッセージです。
              未設定の場合はシステムのデフォルト文が送られます。
            </p>

            <div style={{
              background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
              padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#92400e", lineHeight: 1.8,
            }}>
              <strong>💡 書き方のヒント</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                <li>世界観の説明＋「はじめる」と送ると開始できる旨の案内が効果的です。</li>
                <li>2〜3 文の短いテキストが読みやすいです。</li>
              </ul>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label htmlFor="welcome-msg">あいさつ文（最大 1000 文字）</label>
              <textarea
                id="welcome-msg"
                value={welcomeMsg}
                onChange={(e) => setWelcomeMsg(e.target.value)}
                maxLength={1000}
                style={{ minHeight: 100 }}
                placeholder={"例:\nようこそ、謎の館へ。\nあなたを待っていました……\n\n準備ができたら「はじめる」と送ってください。"}
              />
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                空白で保存すると「未設定」に戻り、デフォルト文が使われます。
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveWelcome}
                disabled={savingWelcome}
              >
                {savingWelcome && <span className="spinner" />}
                {savingWelcome ? "保存中..." : "あいさつメッセージを保存"}
              </button>
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
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e5e5", background: "#f9fafb" }}>
                {["種別", "本文", "フェーズ", "キャラクター", "状態", "順序", ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 14px", textAlign: "left",
                      fontWeight: 600, color: "#374151", fontSize: 12, whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((msg) => (
                  <tr
                    key={msg.id}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* 種別 */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 11, color: "#6b7280",
                      }}>
                        {MESSAGE_TYPE_ICON[msg.message_type]}
                        {MESSAGE_TYPE_LABEL[msg.message_type]}
                      </span>
                    </td>

                    {/* 本文 */}
                    <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                      {msg.message_type === "image" ? (
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

                    {/* フェーズ */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <PhaseTag phase={msg.phase} />
                    </td>

                    {/* キャラクター */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <CharTag character={msg.character} />
                    </td>

                    {/* 状態 */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 12,
                        fontSize: 11, fontWeight: 600,
                        background: msg.is_active ? "#dcfce7" : "#f3f4f6",
                        color:      msg.is_active ? "#16a34a" : "#6b7280",
                      }}>
                        {msg.is_active ? "有効" : "無効"}
                      </span>
                    </td>

                    {/* 順序 */}
                    <td style={{ padding: "12px 14px", color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
                      {msg.sort_order}
                    </td>

                    {/* 編集 */}
                    <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link
                        href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                        className="btn btn-ghost"
                        style={{ padding: "4px 12px", fontSize: 12 }}
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 14px", fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
            {messages.length} 件
          </div>
        </div>
      )}
    </>
  );
}
