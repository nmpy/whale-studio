"use client";

// src/app/oas/[id]/works/[workId]/messages/_import-picker.tsx
//
// 既存メッセージ取り込み（#6-4d・PR3b-2）の picker + 取り込み確認ダイアログ。
// 取り込みは form state への反映のみ（DB 保存は通常の「保存」ボタン）。判定/変換は _chain-import の純関数。

import { useState } from "react";
import {
  selectImportableHeads, validateImport, importBlockToSlots, importBeforeAfterSummary,
  buildImportedSendOrder, type ImportMessage,
} from "./_chain-import";
import type { AdditionalMessageSlot } from "./_form-helpers";

export type ImportPickerProps = {
  open:            boolean;
  onClose:         () => void;
  targetHeadId:    string;
  workId:          string;
  targetPhaseId:   string | null;
  targetChainIds:  string[];
  targetSendCount: number;
  /** additionalMessages の挿入 index。 */
  insertIndex:     number;
  appendAtEnd:     boolean;
  importMessages:  ImportMessage[];
  phaseNames:      Record<string, string>;
  onImport:        (slots: AdditionalMessageSlot[], insertIndex: number) => void;
};

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const panel: React.CSSProperties = { background: "#fff", borderRadius: 10, maxWidth: 640, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 18, fontSize: 13, lineHeight: 1.7 };

export function ImportPicker(props: ImportPickerProps) {
  const [selectedHeadId, setSelectedHeadId] = useState<string | null>(null);
  if (!props.open) return null;

  const sendOrderInsertIndex = props.appendAtEnd ? props.targetChainIds.length : props.insertIndex + 1;
  const close = () => { setSelectedHeadId(null); props.onClose(); };

  // ── 確認ダイアログ ──
  if (selectedHeadId) {
    const v = validateImport({
      headId: selectedHeadId, targetHeadId: props.targetHeadId, targetChainIds: props.targetChainIds,
      appendAtEnd: props.appendAtEnd, allMessages: props.importMessages, workId: props.workId,
      targetPhaseId: props.targetPhaseId, targetSendCount: props.targetSendCount,
    });
    const back = () => setSelectedHeadId(null);
    return (
      <div style={overlay} onClick={close}>
        <div style={panel} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>取り込みの確認</div>
          {!v.ok ? (
            <>
              <div style={{ color: "#b91c1c" }}>取り込めません: {v.message}</div>
              <div style={{ marginTop: 12, textAlign: "right" }}><button type="button" onClick={back} style={btn}>戻る</button></div>
            </>
          ) : (() => {
            const block = v.block;
            const order = buildImportedSendOrder(props.targetChainIds, sendOrderInsertIndex, block.blockIds);
            const ba = importBeforeAfterSummary(props.importMessages, props.targetPhaseId ?? "", order);
            const labelOf = (id: string) => { const mm = props.importMessages.find((x) => x.id === id); return (mm?.body ?? "").replace(/\n/g, " ").slice(0, 28) || `(${mm?.message_type ?? "msg"})`; };
            return (
              <>
                <div style={{ padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#1e40af", marginBottom: 10 }}>
                  まだ保存はされません。この内容を編集中のchainに取り込みます。最後に画面下部の「保存」を押すと反映されます。
                </div>
                <div style={{ marginBottom: 6 }}><strong>取り込むブロック</strong>（{block.length}通{block.containsFreeInput ? "・自由入力含む" : ""}）:</div>
                <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>
                  {block.blockIds.map((id) => <li key={id}>{labelOf(id)}</li>)}
                </ol>
                <div style={{ marginBottom: 8, color: "#475569" }}>挿入先: {props.appendAtEnd ? "連続メッセージの末尾" : `${props.insertIndex + 2}通目の位置`}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  {([["before", ba.before], ["after", ba.after]] as const).map(([k, s]) => (
                    <div key={k} style={{ padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                      <div style={{ fontWeight: 700, color: "#334155", marginBottom: 4 }}>{k === "before" ? "取り込み前" : "取り込み後"}</div>
                      <div>entry head: {s.entryHeadCount}件</div>
                      <div>入場送信: {s.total}通{s.overLimit ? "（5通超）" : ""}</div>
                      <div>QR参照 entry head: {s.qrHeadCount}件</div>
                      <div>freeInput 停止: {s.stoppedAtFreeInputId ? "あり" : "なし"}</div>
                    </div>
                  ))}
                </div>

                {v.warnings.length > 0 && (
                  <div style={{ padding: "8px 10px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, color: "#9a3412", marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ 警告</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{v.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={back} style={btn}>戻る</button>
                  <button type="button" style={{ ...btn, background: "#06C755", color: "#fff", border: "1px solid #06C755" }}
                    onClick={() => { const { slots } = importBlockToSlots(block, props.importMessages); props.onImport(slots, props.insertIndex); close(); }}>
                    取り込む（保存はまだ）
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // ── picker（候補一覧・phase グループ化）──
  const candidates = selectImportableHeads(props.importMessages, { targetHeadId: props.targetHeadId, targetChainIds: props.targetChainIds, workId: props.workId });
  const phaseOf = (id: string) => props.importMessages.find((m) => m.id === id)?.phaseId ?? null;
  const groups = new Map<string | null, typeof candidates>();
  for (const c of candidates) { const p = phaseOf(c.id); if (!groups.has(p)) groups.set(p, []); groups.get(p)!.push(c); }
  // 現在 phase を先頭に
  const orderedPhases = [...groups.keys()].sort((a, b) => (a === props.targetPhaseId ? -1 : b === props.targetPhaseId ? 1 : 0));

  return (
    <div style={overlay} onClick={close}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>既存メッセージを取り込む</div>
          <button type="button" onClick={close} style={btn}>閉じる</button>
        </div>
        <div style={{ color: "#64748b", marginBottom: 10 }}>
          同じ作品の「単体の入場メッセージ（entry head）」を、編集中の連続メッセージに取り込みます。取り込むと、そのメッセージは入場 head から外れます。
        </div>
        {candidates.length === 0 && <div style={{ color: "#9ca3af" }}>取り込める候補がありません。</div>}
        {orderedPhases.map((pid) => (
          <div key={pid ?? "none"} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#334155", borderBottom: "1px solid #e5e7eb", paddingBottom: 2, marginBottom: 4 }}>
              {props.phaseNames[pid ?? ""] ?? "(フェーズ不明)"}{pid === props.targetPhaseId ? "（現在のフェーズ）" : ""}
            </div>
            {groups.get(pid)!.map((c) => {
              const v = validateImport({ headId: c.id, targetHeadId: props.targetHeadId, targetChainIds: props.targetChainIds, appendAtEnd: props.appendAtEnd, allMessages: props.importMessages, workId: props.workId, targetPhaseId: props.targetPhaseId, targetSendCount: props.targetSendCount });
              const disabled = !v.ok;
              return (
                <button key={c.id} type="button" disabled={disabled}
                  onClick={() => setSelectedHeadId(c.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 4, borderRadius: 6,
                    border: "1px solid #e5e7eb", background: disabled ? "#f3f4f6" : "#fff", color: disabled ? "#9ca3af" : "#334155", cursor: disabled ? "not-allowed" : "pointer" }}>
                  <div style={{ fontSize: 13 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {c.id.slice(0, 8)} ・ {c.chainLength}通
                    {c.containsFreeInput && <span style={{ marginLeft: 6, color: "#b45309" }}>⏸自由入力含む</span>}
                    {c.qrReferenced && <span style={{ marginLeft: 6, color: "#9a3412" }}>⚠QR参照あり</span>}
                  </div>
                  {disabled && <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>取り込み不可: {!v.ok ? v.message : ""}</div>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { fontSize: 12, padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", color: "#374151", cursor: "pointer" };
