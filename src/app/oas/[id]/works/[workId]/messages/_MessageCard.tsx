"use client";

// src/app/oas/[id]/works/[workId]/messages/_MessageCard.tsx
//
// 再設計版メッセージ一覧の「1メッセージ = 1カード」。
//   - 旧 7 列テーブルの情報・操作を縦積みカードへ再配置（サイドバー込みの狭幅でも崩れない）。
//   - 既存 handler（編集リンク / 削除 / 有効無効 / ▲▼並び替え）を props で受け取りそのまま使う。
//     → 送信・保存・遷移・QR 挙動などの実行ロジックには一切触れない。
//   - 警告は常時表示（getMessageWarnings の5種）。連続/分岐/キーワード/遷移先は「詳細を見る」展開へ。
//
// データ取得は無し（親 page.tsx の bootstrap 済みデータ・helper を流用）。

import { TLink as Link } from "@/components/TLink";
import type { MessageWithRelations, PhaseWithCounts, TransitionWithPhases } from "@/types";
import type { MessageFlowInfo } from "@/lib/message-flow-status";
import { getChainContinuations, hasAnyTiming, summarizeTiming } from "./_list-helpers";
import {
  CharIcon, FlowStatusCell, BranchItemRow,
  MESSAGE_TYPE_LABEL, MESSAGE_TYPE_ICON, cardPreview, msgPreview,
} from "./_list-ui";
import { isHardWarning, type MessageWarningLabel } from "./_message-list-model";

/** カードの種別バッジ表示（謎 or テキスト/画像/…）。タイプ列+種別列を1バッジに集約。 */
function typeBadge(msg: MessageWithRelations): { icon: string; label: string } {
  if (msg.kind === "puzzle" || msg.message_type === "riddle") return { icon: "🧩", label: "謎・問題" };
  const label = MESSAGE_TYPE_LABEL[msg.message_type] ?? "メッセージ";
  return { icon: MESSAGE_TYPE_ICON[msg.message_type] ?? "", label };
}

export interface MessageCardProps {
  msg: MessageWithRelations;
  /** トリガー種別バッジ（表示専用。QR/応答/チェックインのみ。条件なし/その他は null）。 */
  triggerBadge?: { label: string; icon: string; bg: string; color: string } | null;
  warnings: MessageWarningLabel[];
  flowInfo: MessageFlowInfo | undefined;
  phaseName: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  canEdit: boolean;
  busy: boolean;
  editHref: string;
  onDelete: () => void;
  onToggleActive: () => void;
  onReorder: (dir: "up" | "down") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  // 詳細展開で使う（親の bootstrap 済みデータ）
  allMessages: MessageWithRelations[];
  transitions: TransitionWithPhases[];
  phases: PhaseWithCounts[];
  msgById: Map<string, MessageWithRelations>;
  phaseById: Map<string, PhaseWithCounts>;
}

export default function MessageCard(props: MessageCardProps) {
  const {
    msg, triggerBadge, warnings, flowInfo, phaseName, isExpanded, onToggleExpand,
    canEdit, busy, editHref, onDelete, onToggleActive, onReorder, canMoveUp, canMoveDown,
    allMessages, transitions, phases, msgById, phaseById,
  } = props;

  const hasWarning = warnings.length > 0;
  const isActive = msg.is_active;
  const tb = typeBadge(msg);
  const continuations = getChainContinuations(allMessages, msg.id);
  const enabledQrs = (msg.quick_replies ?? []).filter((q) => q.enabled !== false);
  const keywords = (msg.trigger_keyword ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${hasWarning ? "#FBDBA0" : "#ECEEF1"}`,
        borderRadius: 11,
        padding: "12px 14px",
        boxShadow: "0 1px 3px rgba(0,0,0,.04)",
        marginBottom: 7,
        opacity: isActive ? 1 : 0.72,
      }}
    >
      {/* Row 1: メタ + 操作 */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <CharIcon character={msg.character} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "#1A1A1A" }}>
          {msg.character?.name ?? "—"}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 5,
          color: "#6B7280", background: "#F3F4F6",
        }}>
          {tb.icon ? `${tb.icon} ` : ""}{tb.label}
        </span>

        {/* トリガー種別バッジ（グループ見出しを廃止し、ここに種別を出す。表示専用） */}
        {triggerBadge && (
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 5,
            color: triggerBadge.color, background: triggerBadge.bg,
          }}>
            {triggerBadge.icon} {triggerBadge.label}
          </span>
        )}

        <span style={{ flex: 1, minWidth: 12 }} />

        {phaseName && (
          <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: "#F0F2F5", color: "#555" }}>
            {phaseName}
          </span>
        )}

        {/* 有効/無効トグル（既存 handleToggleActive） */}
        {canEdit ? (
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            title={isActive ? "クリックで無効化" : "クリックで有効化"}
            style={{
              fontSize: 11, fontWeight: 500, fontFamily: "inherit",
              color: isActive ? "#06A047" : "#949494",
              background: isActive ? "#E8F9EE" : "#F5F5F5",
              border: "none", padding: "3px 9px", borderRadius: 20,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {isActive ? "● 有効" : "○ 無効"}
          </button>
        ) : (
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: isActive ? "#06A047" : "#949494",
            background: isActive ? "#E8F9EE" : "#F5F5F5",
            padding: "3px 9px", borderRadius: 20,
          }}>
            {isActive ? "● 有効" : "○ 無効"}
          </span>
        )}

        {/* ▲▼ 並び替え（既存 handleReorderMessage・DnD は別PR） */}
        {canEdit && (
          <span style={{ display: "inline-flex", gap: 2 }}>
            <button
              type="button"
              onClick={() => onReorder("up")}
              disabled={!canMoveUp || busy}
              aria-label="上へ移動"
              style={reorderBtnStyle(!canMoveUp || busy)}
            >▲</button>
            <button
              type="button"
              onClick={() => onReorder("down")}
              disabled={!canMoveDown || busy}
              aria-label="下へ移動"
              style={reorderBtnStyle(!canMoveDown || busy)}
            >▼</button>
          </span>
        )}

        {/* 編集（既存リンク） */}
        {canEdit && (
          <Link href={editHref} style={{
            border: "1px solid #DFE1E5", background: "#fff",
            fontSize: 11.5, color: "#555", borderRadius: 6, padding: "4px 10px",
            textDecoration: "none", whiteSpace: "nowrap",
          }}>編集</Link>
        )}

        {/* 削除（既存 handleDeleteMessage = 既存の確認ダイアログを使う） */}
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            style={{
              border: "1px solid #C0705A", background: "#FDF4F4",
              fontFamily: "inherit", fontSize: 11.5, color: "#8B4A4A",
              borderRadius: 6, padding: "4px 8px", cursor: busy ? "default" : "pointer",
            }}
          >削除</button>
        )}
      </div>

      {/* Row 2: 本文プレビュー（60字目安 + 2行クランプ） */}
      <div style={{
        fontSize: 12.5, color: "#555", lineHeight: 1.7, marginTop: 7, paddingLeft: 37,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {msg.message_type === "image"
          ? "🖼 画像メッセージ"
          : (cardPreview(msg) || "(本文なし)")}
      </div>

      {/* Row 3: 警告バッジ（常時表示・5種を1つも落とさない） */}
      {hasWarning && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, paddingLeft: 37 }}>
          {warnings.map((w) => {
            const hard = isHardWarning(w);
            return (
              <span key={w} style={{
                fontSize: 11, fontWeight: 500,
                color: hard ? "#C0392B" : "#B07A20",
                background: hard ? "#FEF0EE" : "#FEF8EC",
                padding: "2px 9px", borderRadius: 20,
              }}>⚠ {w}</span>
            );
          })}
        </div>
      )}

      {/* Row 4: 詳細トグル */}
      <div style={{ marginTop: 6, paddingLeft: 37 }}>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          style={{ border: "none", background: "none", fontFamily: "inherit", fontSize: 12, color: "#06A047", cursor: "pointer", padding: 0 }}
        >
          {isExpanded ? "▲ 詳細を閉じる" : "▼ 詳細を見る"}
        </button>
      </div>

      {/* 詳細展開 */}
      {isExpanded && (
        <div style={{ margin: "10px 0 2px", marginLeft: 37, borderTop: "1px dashed #E0E4EA", paddingTop: 12 }}>

          {/* ① 応答キーワード / 有効フェーズ（無ければ非表示） */}
          {keywords.length > 0 && (
            <DetailBlock title="応答キーワード">
              <div style={{ fontSize: 12.5, color: "#555" }}>
                🔑 {keywords.map((k) => `「${k}」`).join("・")}
                <span style={{ color: msg.phase?.id ? "#555" : "#b45309", marginLeft: 6 }}>
                  ・有効フェーズ：{msg.phase?.id ? (phaseName ?? "—") : "共通（全フェーズ）"}
                </span>
              </div>
            </DetailBlock>
          )}

          {/* ② 遷移先 / 導線状態（警告は上で常時表示済みのため mode="info"） */}
          {flowInfo && (
            <DetailBlock title="遷移先 / 導線状態">
              <FlowStatusCell info={flowInfo} msgById={msgById} phaseById={phaseById} mode="info" />
            </DetailBlock>
          )}

          {/* ③ クイックリプライ分岐 */}
          {enabledQrs.length > 0 && (
            <DetailBlock title={`クイックリプライ分岐（${enabledQrs.length}件）— 入力 → 応答 → 結果`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {enabledQrs.map((qr, i) => (
                  <BranchItemRow
                    key={i}
                    qr={qr}
                    phaseId={msg.phase?.id ?? null}
                    allMessages={allMessages}
                    transitions={transitions}
                    phases={phases}
                  />
                ))}
              </div>
            </DetailBlock>
          )}

          {/* ④ 連続メッセージ（⑤ 演出/Flex 補足は各行の「演出: 設定あり」で内包） */}
          {continuations.length > 0 && (
            <DetailBlock title={`連続メッセージ（合計${continuations.length + 1}通）`}>
              {continuations.map((c, i) => {
                const ctb = typeBadge(c);
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", background: "#F8F9FA", borderRadius: 7, marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 11.5, color: "#949494", whiteSpace: "nowrap" }}>└ {i + 2}通目</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 7px", borderRadius: 4, color: "#6B7280", background: "#F3F4F6", whiteSpace: "nowrap" }}>
                      {ctb.icon ? `${ctb.icon} ` : ""}{ctb.label}
                    </span>
                    <span style={{ fontSize: 12.5, color: "#555", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {msgPreview(c)}
                    </span>
                    {hasAnyTiming(c) && (
                      <span style={{ fontSize: 11, color: "#7c6f9e", whiteSpace: "nowrap" }} title={summarizeTiming(c)}>演出: 設定あり</span>
                    )}
                    {c.character?.name && (
                      <span style={{ fontSize: 11.5, color: "#949494", whiteSpace: "nowrap" }}>{c.character.name}</span>
                    )}
                  </div>
                );
              })}
            </DetailBlock>
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "#949494", fontWeight: 500, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function reorderBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid #DFE1E5", background: "#fff", fontFamily: "inherit",
    fontSize: 9, lineHeight: 1, color: disabled ? "#CBD5E1" : "#6b7280",
    borderRadius: 5, padding: "4px 6px", cursor: disabled ? "default" : "pointer",
  };
}
