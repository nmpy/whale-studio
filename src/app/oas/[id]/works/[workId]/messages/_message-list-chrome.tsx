"use client";

// src/app/oas/[id]/works/[workId]/messages/_message-list-chrome.tsx
//
// 再設計版メッセージ一覧の「外枠」小物（handoff 準拠の見た目）。
//   - StickyPhaseTabsBar: フェーズタブ（横スクロール）＋「メッセージを追加」を sticky でまとめたバー
//   - WarningSummaryBar: 警告件数のサマリー
//   - PhaseFilterBar:   特定フェーズ表示中バー
//   - EmptyState:       0 件状態
// 描画のみ・state を持たない。送信/保存/遷移などのロジックは無関係。

import { TLink as Link } from "@/components/TLink";

export type PhaseTabItem = { id: string; name: string };

/**
 * フェーズタブ ＋「メッセージを追加」ボタンを 1 つの sticky 領域にまとめたバー。
 * 一覧をスクロール中も現在のフェーズと追加導線が常に見えるようにする（導線改善）。
 * - 左: フェーズタブ（横スクロール）/ 右: 追加ボタン（canEdit のときのみ・幅は縮めない）。
 * - addHref は呼び出し側で withReturnTab(...) を構築して渡す（tab/returnTab/returnTo は既存挙動を維持）。
 * - 背景はページ背景色でカードが透けないようにし、下端に境界（border + 薄い影）を付ける。
 * 送信/保存/遷移などのロジックは持たない（描画のみ）。
 */
export function StickyPhaseTabsBar({
  tabs, activeId, onChange, addHref, canEdit,
}: {
  tabs: PhaseTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  addHref: string;
  canEdit: boolean;
}) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 5,
      background: "var(--bg, #f5f8f6)",
      borderBottom: "1px solid #E8EBE8",
      boxShadow: "0 3px 6px -4px rgba(0,0,0,0.12)",
      marginBottom: 16, paddingTop: 8,
      display: "flex", alignItems: "flex-end", gap: 12,
    }}>
      <div style={{
        display: "flex", overflowX: "auto", scrollbarWidth: "none",
        flex: 1, minWidth: 0, borderBottom: "2px solid #E8EBE8", marginBottom: -1,
      }}>
        {tabs.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              aria-current={active ? "true" : undefined}
              style={{
                padding: "9px 18px", fontSize: 13.5, fontFamily: "inherit",
                color: active ? "#06A047" : "#949494",
                fontWeight: active ? 600 : 400,
                background: "none", border: "none",
                borderBottom: active ? "2.5px solid #06C755" : "2.5px solid transparent",
                marginBottom: -2, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>
      {canEdit && (
        <Link
          href={addHref}
          className="btn btn-primary"
          style={{ flexShrink: 0, whiteSpace: "nowrap", marginBottom: 6 }}
        >
          ＋ メッセージを追加
        </Link>
      )}
    </div>
  );
}

export function WarningSummaryBar({ count }: { count: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", background: "#FEF8EC",
      borderRadius: 9, border: "1px solid #F0DFA0", marginBottom: 14,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
      <div>
        <div style={{ fontSize: 12.5, color: "#8A6520", fontWeight: 500 }}>{count}件の警告があります</div>
        <div style={{ fontSize: 11.5, color: "#A07830" }}>設定が不完全なメッセージがあります。配信前に確認してください。</div>
      </div>
    </div>
  );
}

export function PhaseFilterBar({
  phaseName, count, onClear,
}: {
  phaseName: string;
  count: number;
  onClear: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 14px", background: "#F0FBF4",
      borderRadius: 9, border: "1px solid #C8E8D4", marginBottom: 14,
    }}>
      <span style={{ fontSize: 12, color: "#06A047" }}>{phaseName} のメッセージを表示中</span>
      <span style={{
        fontSize: 11.5, fontWeight: 600, background: "#06C755", color: "#fff",
        padding: "2px 9px", borderRadius: 20,
      }}>{count}件</span>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear} style={{
        border: "none", background: "none", fontFamily: "inherit",
        fontSize: 12, color: "#949494", cursor: "pointer",
      }}>すべて表示 ›</button>
    </div>
  );
}

export function EmptyState({
  phaseName, canEdit, addHref,
}: {
  phaseName: string;
  canEdit: boolean;
  addHref: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "56px 24px", textAlign: "center",
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: "50%", background: "#F0F2F5",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 18, fontSize: 32,
      }}>💬</div>
      <div style={{ fontSize: 17, fontWeight: 500, color: "#333", marginBottom: 8 }}>メッセージがありません</div>
      <p style={{ fontSize: 13.5, color: "#949494", lineHeight: 1.7, margin: "0 0 22px" }}>
        {phaseName ? `${phaseName} には` : "ここには"}まだメッセージが登録されていません。<br />
        最初のメッセージを追加してシナリオを始めましょう。
      </p>
      {canEdit && (
        <Link href={addHref} style={{
          background: "#06C755", color: "#fff", fontSize: 14, fontWeight: 500,
          borderRadius: 99, padding: "12px 28px", textDecoration: "none",
        }}>＋ 最初のメッセージを追加</Link>
      )}
    </div>
  );
}
