"use client";

// src/app/oas/[id]/works/[workId]/settings/_WorkGreetingSettings.tsx
//
// 作品設定「あいさつメッセージ」タブの本体（旧 messages/page.tsx の「共通設定」タブから移設）。
//   - あいさつメッセージ（welcome_message）/ follow_action / 途中再開（resume_enabled）を作品単位で編集。
//   - 保存は **既存の `workApi.update(token, workId, {...})`（PATCH /api/works/[workId]）をそのまま再利用**。
//     送信・あいさつ送信・follow_action 実行・途中再開実行ロジック・DB/API/schema は一切変更しない。
//   - state / handler / UI は messages タブの実装をそのまま移植（挙動不変）。messages bootstrap には依存しない
//     （初期値は親 = settings/page.tsx が GET /api/works/[workId] から渡す）。

import { useState } from "react";
import { workApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Switch } from "@/components/Switch";
import { HelpAccordion } from "@/components/HelpAccordion";

type FollowAction = "auto_start" | "welcome_wait" | "none";

export default function WorkGreetingSettings({
  workId,
  canEdit,
  initialWelcome,
  initialFollowAction,
  initialResumeEnabled,
}: {
  workId: string;
  canEdit: boolean;
  initialWelcome: string | null;
  initialFollowAction: FollowAction;
  initialResumeEnabled: boolean;
}) {
  const { showToast } = useToast();
  const [welcomeMsg, setWelcomeMsg]         = useState<string | null>(initialWelcome);
  const [editingWelcome, setEditingWelcome] = useState(false);
  const [welcomeDraft,   setWelcomeDraft]   = useState("");
  const [savingWelcome,  setSavingWelcome]  = useState(false);
  const [followAction,   setFollowAction]   = useState<FollowAction>(initialFollowAction);
  const [savingFollow,   setSavingFollow]   = useState(false);
  const [resumeEnabled,  setResumeEnabled]  = useState(initialResumeEnabled);
  const [savingResume,   setSavingResume]   = useState(false);

  /** 途中再開（作品単位デフォルト設定）をトグル。楽観的更新 + PATCH /api/works/[workId]。挙動不変。 */
  async function handleToggleResume(next: boolean) {
    if (savingResume) return;
    const prev = resumeEnabled;
    setResumeEnabled(next);
    setSavingResume(true);
    try {
      await workApi.update(getDevToken(), workId, { resume_enabled: next });
      showToast(next ? "途中再開を有効にしました" : "途中再開を無効にしました", "success");
    } catch (err) {
      console.error("[settings] toggle resume_enabled error:", err);
      setResumeEnabled(prev);
      showToast(err instanceof Error ? err.message : "設定の保存に失敗しました", "error");
    } finally {
      setSavingResume(false);
    }
  }

  // ── あいさつメッセージ（Work.welcomeMessage）のインライン編集（挙動不変） ──
  function startEditWelcome() {
    setWelcomeDraft(welcomeMsg ?? "");
    setEditingWelcome(true);
  }
  function cancelEditWelcome() {
    setEditingWelcome(false);
    setWelcomeDraft("");
  }
  async function saveWelcome() {
    const text = welcomeDraft.trim();
    if (!text || savingWelcome) return; // 空のときは保存しない（解除は専用ボタン）
    setSavingWelcome(true);
    try {
      const updated = await workApi.update(getDevToken(), workId, { welcome_message: text });
      setWelcomeMsg(updated.welcome_message ?? text);
      setEditingWelcome(false);
      showToast("あいさつメッセージを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }
  async function clearWelcome() {
    if (savingWelcome) return;
    if (!confirm("あいさつメッセージを未設定に戻しますか？\n（本文の紐付けを解除します。未設定にすると、友だち追加時には何も送信されません）")) return;
    setSavingWelcome(true);
    try {
      await workApi.update(getDevToken(), workId, { welcome_message: null });
      setWelcomeMsg(null);
      setEditingWelcome(false);
      showToast("あいさつメッセージを未設定に戻しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "解除に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }

  // 友だち追加時の動作を変更（PATCH /api/works/[workId] follow_action）。楽観的更新。挙動不変。
  async function changeFollowAction(next: FollowAction) {
    if (savingFollow || next === followAction) return;
    const prev = followAction;
    setFollowAction(next);
    setSavingFollow(true);
    try {
      await workApi.update(getDevToken(), workId, { follow_action: next });
      showToast("あいさつメッセージの設定を変更しました", "success");
    } catch (err) {
      setFollowAction(prev);
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingFollow(false);
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      {/* この画面の使い方（あいさつメッセージ＋デフォルト設定の概要）。 */}
      <div style={{ marginBottom: 24 }}>
        <HelpAccordion items={[
          { title: "あいさつメッセージ", points: [
            "友だち追加時に送信するメッセージと、その後の動作を設定できます",
            "「はじめる」と送る前に自動で届く、シナリオ開始前の一度きりのメッセージです",
            "未設定（空欄）のときは、友だち追加時に何も送信されません（デフォルト文は送信されません）",
            "OA Manager 側のあいさつメッセージが ON だと二重送信になる可能性があるため、Whale Studio 側で管理する場合は OA Manager 側を OFF にしてください",
          ]},
          { title: "デフォルト設定", points: [
            "作品全体にあらかじめ適用する初期値・挙動（途中再開など）を設定できます",
          ]},
        ]} />
      </div>

      {/* あいさつメッセージ（作品単位）。welcome_wait のときだけ下のあいさつ設定が有効。 */}
      <div className="card" style={{ padding: "20px 24px", marginBottom: 24 }}>
        <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", margin: "0 0 4px" }}>
          あいさつメッセージ
        </p>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px", lineHeight: 1.7 }}>
          友だち追加（フォロー）された直後の挙動を作品単位で選べます。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {([
            { value: "welcome_wait", label: "あいさつメッセージを送って「はじめる」を待つ" },
            { value: "auto_start",   label: "すぐにシナリオを開始する" },
            { value: "none",         label: "何もしない" },
          ] as const).map(({ value, label }) => (
            <label key={value} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              fontSize: 13, color: "#374151", cursor: canEdit ? "pointer" : "default",
            }}>
              <input
                type="radio"
                name="follow_action"
                value={value}
                checked={followAction === value}
                disabled={!canEdit || savingFollow}
                onChange={() => changeFollowAction(value)}
                style={{ marginTop: 2 }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {followAction === "auto_start" && (
          <p style={{ fontSize: 12, color: "#6b7280", margin: "12px 0 0", lineHeight: 1.7 }}>
            この設定では友だち追加直後に本編が始まるため、あいさつメッセージは送信されません。
          </p>
        )}
        {followAction === "none" && (
          <p style={{ fontSize: 12, color: "#6b7280", margin: "12px 0 0", lineHeight: 1.7 }}>
            友だち追加時には何も送信されません。
          </p>
        )}
        {followAction === "welcome_wait" && !welcomeMsg?.trim() && (
          <p style={{ fontSize: 12, color: "#b45309", margin: "12px 0 0", lineHeight: 1.7 }}>
            あいさつメッセージが未設定（空欄）のため、友だち追加時には何も送信されません。送信したい場合は下であいさつメッセージを設定してください。
          </p>
        )}
      </div>

      {/* 現在の設定（あいさつメッセージ）。「はじめる」を待つモードのときのみ表示・編集可能。 */}
      {followAction === "welcome_wait" ? (
      <div className="card" style={{ padding: "20px 24px" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
              現在のあいさつメッセージ
            </span>
            {welcomeMsg?.trim() ? (
              <span style={{
                fontSize: 11, fontWeight: 700, color: "#166534",
                background: "#dcfce7", padding: "1px 8px", borderRadius: 10,
                border: "1px solid #bbf7d0",
              }}>設定済み</span>
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 700, color: "#dc2626",
                background: "#fef2f2", padding: "1px 8px", borderRadius: 10,
                border: "1px solid #fecaca",
              }}>未設定</span>
            )}
          </div>
        </div>

        {/* OA Manager 側との二重送信に関する注意書き（ニュートラル表示） */}
        <div style={{
          background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
          padding: "10px 14px", marginBottom: 16,
          fontSize: 12, color: "#6b7280", lineHeight: 1.7,
        }}>
          LINE Official Account Manager 側のあいさつメッセージが ON の場合、メッセージが二重で
          送信される可能性があります。Whale Studio 側で管理する場合は、OA Manager 側の
          あいさつメッセージを OFF にしてください。
        </div>

        {editingWelcome ? (
          /* ── 編集モード（画面遷移なし） ── */
          <>
            <textarea
              value={welcomeDraft}
              onChange={(e) => setWelcomeDraft(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="例：はじめまして！この物語体験へようこそ。「はじめる」と送ると物語がスタートします。"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "12px 14px", fontSize: 14, lineHeight: 1.7,
                border: "1.5px solid #e5e7eb", borderRadius: 10,
                resize: "vertical", color: "#111827",
              }}
            />
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 0" }}>
              {welcomeDraft.length} / 2000
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-ghost" onClick={cancelEditWelcome} disabled={savingWelcome}>
                キャンセル
              </button>
              <button type="button" className="btn btn-primary" onClick={saveWelcome} disabled={savingWelcome || !welcomeDraft.trim()}>
                {savingWelcome ? "保存中..." : "保存する"}
              </button>
            </div>
          </>
        ) : welcomeMsg?.trim() ? (
          /* ── 設定済み（プレビュー + 編集 / 未設定に戻す） ── */
          <>
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12,
              padding: "16px 18px", marginBottom: 16, position: "relative",
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#16a34a",
                letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase",
              }}>
                PREVIEW
              </div>
              <p style={{
                fontSize: 14, color: "#111827", margin: 0,
                whiteSpace: "pre-wrap", lineHeight: 1.8, wordBreak: "break-all",
              }}>
                {welcomeMsg}
              </p>
            </div>
            {canEdit && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={clearWelcome} disabled={savingWelcome}>
                  未設定に戻す
                </button>
                <button type="button" className="btn btn-primary" onClick={startEditWelcome} disabled={savingWelcome}>
                  編集する
                </button>
              </div>
            )}
          </>
        ) : (
          /* ── 未設定（このタブで設定開始・画面遷移なし） ── */
          <div style={{
            background: "#ffffff", border: "1px solid #e5e7eb",
            borderRadius: 10, padding: "24px 20px", textAlign: "center",
          }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", margin: "0 0 6px" }}>
              あいさつメッセージが未設定です
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 16px", lineHeight: 1.7 }}>
              あいさつメッセージが未設定のため、友だち追加時には案内文（既定文）のみが送信されます。<br />
              ユーザーへの最初の接触なので、独自のあいさつ文を設定することをおすすめします。
            </p>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={startEditWelcome}>
                今すぐ設定する
              </button>
            )}
          </div>
        )}
      </div>
      ) : null}

      {/* デフォルト設定（作品単位）。あいさつメッセージの下に表示。 */}
      <div className="card" style={{ padding: "16px 24px", marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
          デフォルト設定
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, opacity: canEdit ? 1 : 0.6 }}>
          <Switch
            checked={resumeEnabled}
            onChange={(v) => handleToggleResume(v)}
            disabled={!canEdit || savingResume}
            ariaLabel="途中再開を有効にする"
          />
          <span
            style={{ cursor: canEdit && !savingResume ? "pointer" : "default" }}
            onClick={() => { if (canEdit && !savingResume) handleToggleResume(!resumeEnabled); }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              途中再開を有効にする
            </span>
            {savingResume && (
              <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 8 }}>保存中…</span>
            )}
            <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 1.6 }}>
              ユーザーがフェーズの途中で開始トリガーを再送したときに、「途中から再開する / 最初からやり直す」を表示します。
              無効にすると、途中状態があっても選択肢を出さず、最初から開始します。
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
