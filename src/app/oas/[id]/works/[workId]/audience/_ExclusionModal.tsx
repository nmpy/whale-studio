"use client";

// src/app/oas/[id]/works/[workId]/audience/_ExclusionModal.tsx
//
// 分析除外ユーザー管理モーダル（オーディエンスタブ内）。
//   - メイン導線: 管理画面アクセス権を持つ登録ユーザー一覧をチェックボックスで除外 ON/OFF。
//   - UID 未設定ユーザーは「LINE UID未設定」＋入力導線（誤除外防止のためチェックは disabled）。
//   - 補助: 登録ユーザーに紐づかない lineUserId の手入力追加。
//   - 除外の実体は OA 単位 lineUserId（AnalyticsExcludedUser）。元データは削除しない。
//   - owner/admin のみ操作可能（canManage）。API 側でも認可。

import { useCallback, useEffect, useState } from "react";
import { analyticsExclusionApi, getDevToken, type ExclusionCandidates } from "@/lib/api-client";

const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー", admin: "管理者", editor: "編集者", tester: "テスター", viewer: "閲覧者",
};

export function ExclusionModal({
  oaId, canManage, onClose, onChanged,
}: {
  oaId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData]       = useState<ExclusionCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [uidDraft, setUidDraft] = useState<Record<string, string>>({});
  const [manualUid, setManualUid]   = useState("");
  const [manualNote, setManualNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await analyticsExclusionApi.candidates(getDevToken(), oaId);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally { setLoading(false); }
  }, [oaId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { await load(); onChanged(); };

  async function toggleMember(userId: string, lineUserId: string | null, excluded: boolean, exclusionId: string | null, name: string) {
    if (!canManage || !lineUserId) return;
    setBusyId(userId);
    try {
      if (excluded && exclusionId) {
        await analyticsExclusionApi.remove(getDevToken(), oaId, exclusionId);
      } else {
        await analyticsExclusionApi.add(getDevToken(), oaId, { line_user_id: lineUserId, member_user_id: userId, display_name: name });
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "更新に失敗しました"); }
    finally { setBusyId(null); }
  }

  async function saveUid(userId: string) {
    if (!canManage) return;
    const v = (uidDraft[userId] ?? "").trim();
    if (!v) return;
    setBusyId(userId);
    try {
      await analyticsExclusionApi.setMemberUid(getDevToken(), oaId, userId, v);
      setUidDraft((p) => ({ ...p, [userId]: "" }));
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "UID の保存に失敗しました"); }
    finally { setBusyId(null); }
  }

  async function addManual() {
    if (!canManage || !manualUid.trim()) return;
    setBusyId("__manual__");
    try {
      await analyticsExclusionApi.add(getDevToken(), oaId, { line_user_id: manualUid.trim(), note: manualNote.trim() || undefined });
      setManualUid(""); setManualNote("");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "追加に失敗しました"); }
    finally { setBusyId(null); }
  }

  async function removeManual(id: string) {
    if (!canManage) return;
    setBusyId(id);
    try { await analyticsExclusionApi.remove(getDevToken(), oaId, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "解除に失敗しました"); }
    finally { setBusyId(null); }
  }

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 12, padding: "7px 8px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" };

  return (
    <div role="dialog" aria-modal="true" aria-label="分析除外ユーザーの管理" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 16, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 720, margin: "40px 0", boxShadow: "0 12px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>分析除外ユーザー</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.6 }}>
          制作者・運営・テスターなど、分析から除外したい登録ユーザーにチェックを入れてください。除外は OA 単位で、元データは削除されません（解除で再び集計に含まれます）。
          {!canManage && <span style={{ color: "#b45309" }}>（変更は owner/admin のみ。閲覧のみ可能です）</span>}
        </p>

        {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <div style={{ fontSize: 13, color: "#9ca3af", padding: 20, textAlign: "center" }}>読み込み中…</div>
        ) : (
          <>
            {/* 登録ユーザー一覧（メイン導線） */}
            <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 18 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr>
                  <th style={th}>除外</th><th style={th}>ユーザー</th><th style={th}>権限</th><th style={th}>LINE UID</th>
                </tr></thead>
                <tbody>
                  {(data?.members ?? []).map((m) => (
                    <tr key={m.user_id}>
                      <td style={td}>
                        <input type="checkbox" checked={m.excluded} disabled={!canManage || !m.has_uid || busyId === m.user_id}
                          onChange={() => toggleMember(m.user_id, m.line_user_id, m.excluded, m.exclusion_id, m.name)}
                          title={!m.has_uid ? "LINE UID 未設定のため除外できません" : undefined} />
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: "#111827" }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>{m.email ?? "—"}</div>
                      </td>
                      <td style={td}>{ROLE_LABEL[m.role] ?? m.role}</td>
                      <td style={td}>
                        {m.has_uid ? (
                          <span style={{ fontFamily: "monospace", color: "#374151" }}>{m.line_user_id_masked}</span>
                        ) : canManage ? (
                          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ color: "#b45309", fontSize: 11 }}>未設定</span>
                            <input value={uidDraft[m.user_id] ?? ""} onChange={(e) => setUidDraft((p) => ({ ...p, [m.user_id]: e.target.value }))}
                              placeholder="U から始まる UID" style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #d1d5db", borderRadius: 6, width: 150 }} />
                            <button onClick={() => saveUid(m.user_id)} disabled={busyId === m.user_id || !(uidDraft[m.user_id] ?? "").trim()}
                              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid #06C755", background: "#e9f8ef", color: "#06A047", borderRadius: 6, cursor: "pointer" }}>保存</button>
                          </span>
                        ) : <span style={{ color: "#b45309", fontSize: 11 }}>未設定</span>}
                      </td>
                    </tr>
                  ))}
                  {(data?.members ?? []).length === 0 && (
                    <tr><td style={{ ...td, textAlign: "center", color: "#9ca3af" }} colSpan={4}>登録ユーザーがいません。</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 手入力の除外（補助） */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>手入力で除外（登録ユーザーに紐づかない lineUserId）</div>
            {canManage && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <input value={manualUid} onChange={(e) => setManualUid(e.target.value)} placeholder="LINE userId（UID）"
                  style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 8, flex: "1 1 200px" }} />
                <input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="メモ（任意）"
                  style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 8, flex: "1 1 160px" }} />
                <button onClick={addManual} disabled={busyId === "__manual__" || !manualUid.trim()}
                  style={{ padding: "6px 14px", fontSize: 12, border: "none", background: "#06C755", color: "#fff", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>追加</button>
              </div>
            )}
            {(data?.manual_exclusions ?? []).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(data?.manual_exclusions ?? []).map((e) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 8px", background: "#f8fafc", borderRadius: 6 }}>
                    <span style={{ fontFamily: "monospace", color: "#374151" }}>{e.line_user_id_masked}</span>
                    {e.note && <span style={{ color: "#9ca3af" }}>{e.note}</span>}
                    {canManage && <button onClick={() => removeManual(e.id)} disabled={busyId === e.id}
                      style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 11, border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer" }}>解除</button>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16, textAlign: "right", fontSize: 12, color: "#6b7280" }}>
              現在の除外: <strong>{data?.excluded_count ?? 0}</strong> 名
            </div>
          </>
        )}
      </div>
    </div>
  );
}
