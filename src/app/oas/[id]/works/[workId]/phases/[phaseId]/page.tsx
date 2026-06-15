"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import {
  phaseApi, messageApi, locationApi,
  workApi, getDevToken, getAuthHeaders,
} from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import type {
  PhaseWithCounts, PhaseType,
  MessageWithRelations, LocationWithTransition,
} from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { ViewerBanner } from "@/components/PermissionGuard";

// ── 定数 ──────────────────────────────────────────
const PHASE_TYPE_OPTIONS: { value: PhaseType; label: string; color: string; bg: string }[] = [
  { value: "start",   label: "開始",         color: "#16a34a", bg: "#f0fdf4" },
  { value: "normal",  label: "通常",         color: "#2563eb", bg: "#eff6ff" },
  { value: "ending",  label: "エンディング", color: "#9333ea", bg: "#faf5ff" },
];

const MSG_TYPE_LABEL: Record<string, string> = {
  text: "テキスト", image: "画像", riddle: "謎",
  video: "動画", carousel: "カルーセル", voice: "ボイス",
};

const TRIGGER_METHOD_LABEL: Record<string, string> = {
  qr: "QRコード", gps: "現在地（GPS）", beacon: "Beacon検知",
};

// 地点到着トリガーの見える化スタイル（warn=注意 / muted=補足）。保存はブロックしない。
const arrivalNotice: Record<"warn" | "muted", React.CSSProperties> = {
  warn:  { fontSize: 11, lineHeight: 1.6, padding: "4px 8px", borderRadius: 5, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" },
  muted: { fontSize: 11, lineHeight: 1.6, padding: "4px 8px", borderRadius: 5, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" },
};

function phaseTypeMeta(pt: PhaseType) {
  return PHASE_TYPE_OPTIONS.find((o) => o.value === pt) ?? PHASE_TYPE_OPTIONS[1];
}

/** メッセージの表示テキスト（キャラ名：本文冒頭） */
function msgLabel(msg: MessageWithRelations, maxLen = 60): string {
  const prefix = msg.character?.name ? `${msg.character.name}：` : "";
  const body   =
    msg.body
      ? msg.body.slice(0, maxLen - prefix.length)
      : `[${MSG_TYPE_LABEL[msg.message_type] ?? msg.message_type}]`;
  return `${prefix}${body}`;
}

// ────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────
export default function PhaseDetailPage() {
  const params  = useParams<{ id: string; workId: string; phaseId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const phaseId = params.phaseId;
  const { showToast } = useToast();
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);

  // ── 作品情報 ──
  const [workTitle, setWorkTitle] = useState("");

  // ── フェーズ情報 ──
  const [phase, setPhase]         = useState<PhaseWithCounts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── フェーズ編集フォーム ──
  const [phaseForm, setPhaseForm]     = useState<{ phase_type: PhaseType; name: string; description: string; start_trigger: string; resume_summary: string; sort_order: number; is_active: boolean } | null>(null);
  const [phaseErrors, setPhaseErrors] = useState<Record<string, string[]>>({});
  const [savingPhase, setSavingPhase] = useState(false);

  // ── メッセージ（作品内の全メッセージを読み込み） ──
  const [allWorkMessages, setAllWorkMessages] = useState<MessageWithRelations[]>([]);
  const [msgLoading, setMsgLoading]           = useState(true);
  const [linking, setLinking]                 = useState(false);

  // ── 地点到着トリガー見える化用（A案・DB追加なし）──
  // location feature 許可プラン（Pro Max / 委託）でのみ表示（#334 と同条件）。
  const { effectivePlan } = useAccessPreview(oaId);
  const canUseLocationFeatures = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location }).allowed;
  const [locations, setLocations] = useState<LocationWithTransition[]>([]);
  const [allPhasesLite, setAllPhasesLite] = useState<{ id: string; name: string }[]>([]);
  const [beaconTriggers, setBeaconTriggers] = useState<{ id: string; name: string; hwid: string; enabled: boolean; location_id: string | null }[]>([]);


  // ── 派生データ ──
  // このフェーズに属するメッセージ（sort_order 昇順）
  const messages = allWorkMessages
    .filter((m) => m.phase_id === phaseId)
    .sort((a, b) => a.sort_order - b.sort_order);

  // まだどのフェーズにも割り当てられていないメッセージ＋他フェーズのメッセージ → 選択候補
  const availableMessages = allWorkMessages.filter((m) => m.phase_id !== phaseId);

  // ── 地点到着トリガーの導出（A案・DB追加なし。既存 Message.checkin_trigger_* から導出）──
  // このフェーズのメッセージで「地点到着待ち」を作るもの（= このフェーズの完了条件＝地点到着）。
  const phaseArrivalTriggers = messages.filter((m) => !!m.checkin_trigger_type);
  // 到着検知でこのフェーズへ遷移してくるトリガー（他フェーズ起点・next_phase_id === このフェーズ）。
  const incomingArrivalTriggers = allWorkMessages.filter(
    (m) => m.checkin_trigger_next_phase_id === phaseId && m.phase_id !== phaseId,
  );
  const locName    = (id?: string | null) => locations.find((l) => l.id === id)?.name ?? null;
  const phaseName  = (id?: string | null) => allPhasesLite.find((p) => p.id === id)?.name ?? null;
  const msgById    = (id?: string | null) => allWorkMessages.find((m) => m.id === id) ?? null;

  // ── 初期ロード ────────────────────────────────────
  const loadPhase = useCallback(async () => {
    try {
      const p = await phaseApi.get(getDevToken(), phaseId);
      setPhase(p);
      setPhaseForm({
        phase_type:     p.phase_type,
        name:           p.name,
        description:    p.description ?? "",
        start_trigger:  p.start_trigger ?? "",
        resume_summary: p.resume_summary ?? "",
        sort_order:     p.sort_order,
        is_active:      p.is_active,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "フェーズの読み込みに失敗しました");
    }
  }, [phaseId]);

  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    try {
      // 作品内の全メッセージを読み込む（フェーズ横断で選択できるように）
      const list = await messageApi.list(getDevToken(), workId, { with_relations: true });
      setAllWorkMessages((list as MessageWithRelations[]).sort((a, b) => a.sort_order - b.sort_order));
    } catch {
      // silent
    } finally {
      setMsgLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    loadPhase();
    loadMessages();
    workApi.get(getDevToken(), workId).then((w) => setWorkTitle(w.title)).catch(() => {});
  }, [loadPhase, loadMessages, workId]);

  // 地点到着トリガー見える化用の付帯データ（地点名 / 全フェーズ名 / ビーコン紐づけ）。失敗時は空で degrade。
  useEffect(() => {
    if (!canUseLocationFeatures) return;
    const token = getDevToken();
    phaseApi.list(token, workId).then((ps) => setAllPhasesLite(ps.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    locationApi.list(token, workId).then(setLocations).catch(() => {});
    (async () => {
      try {
        const res = await fetch(`/api/works/${encodeURIComponent(workId)}/beacons`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          setBeaconTriggers(json.data.map((b: { id: string; name: string; hwid: string; enabled: boolean; location_id: string | null }) => ({
            id: b.id, name: b.name, hwid: b.hwid, enabled: b.enabled, location_id: b.location_id ?? null,
          })));
        }
      } catch { /* degrade */ }
    })();
  }, [workId, canUseLocationFeatures]);

  // ── フェーズ保存 ─────────────────────────────────
  async function handleSavePhase(e: React.FormEvent) {
    e.preventDefault();
    if (!phaseForm) return;
    const errs: Record<string, string[]> = {};
    if (!phaseForm.name.trim()) errs.name = ["フェーズ名を入力してください"];
    if (Object.keys(errs).length) { setPhaseErrors(errs); return; }
    setSavingPhase(true);
    try {
      const updated = await phaseApi.update(getDevToken(), phaseId, {
        phase_type:     phaseForm.phase_type,
        name:           phaseForm.name.trim(),
        description:    phaseForm.description.trim() || undefined,
        start_trigger:  phaseForm.start_trigger.trim() || null,
        resume_summary: phaseForm.resume_summary.trim() || null,
        sort_order:     phaseForm.sort_order,
        is_active:      phaseForm.is_active,
      });
      setPhase(updated);
      showToast("フェーズを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingPhase(false);
    }
  }

  // ── メッセージをフェーズに追加（phase_id を更新） ──
  async function handleLinkMessage(msgId: string) {
    setLinking(true);
    try {
      await messageApi.update(getDevToken(), msgId, { phase_id: phaseId });
      showToast("メッセージをこのフェーズに追加しました", "success");
      await loadMessages();
      await loadPhase();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "追加に失敗しました", "error");
    } finally {
      setLinking(false);
    }
  }

  // ── メッセージをフェーズから外す（削除ではなく phase_id = null） ──
  async function handleUnlinkMessage(id: string) {
    if (!confirm("このメッセージをフェーズから外しますか？\nメッセージ自体は削除されません。")) return;
    try {
      await messageApi.update(getDevToken(), id, { phase_id: null });
      showToast("フェーズから外しました", "success");
      await loadMessages();
      await loadPhase();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "変更に失敗しました", "error");
    }
  }

  // ── ローディング / エラー ─────────────────────────
  if (!phase && !loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "フェーズ管理" },
          ]} />
          <h2>フェーズ編集</h2>
        </div>
        <div className="card" style={{ maxWidth: 640 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
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
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "フェーズ管理" },
          ]} />
          <h2>フェーズ編集</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const meta = phaseTypeMeta(phase!.phase_type);

  return (
    <>
      <ViewerBanner role={role} />
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "フェーズ管理", href: `/oas/${oaId}/works/${workId}/scenario` },
            { label: phase!.name || "フェーズ設定" },
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: meta.color,
              background: meta.bg, padding: "2px 10px", borderRadius: 12,
            }}>
              {meta.label}
            </span>
            <h2 style={{ margin: 0 }}>{phase!.name}</h2>
          </div>
        </div>
      </div>

      {/* ══ フェーズ設定フォーム ══ */}
      <div className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
        <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151" }}>フェーズ設定</p>
        {phaseForm && (
          <form onSubmit={handleSavePhase}>
            <div className="form-group">
              <label>フェーズ種別</label>
              <div className="radio-group">
                {PHASE_TYPE_OPTIONS.map(({ value, label, color, bg }) => (
                  <label key={value} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="radio" name="phase-type" value={value}
                      checked={phaseForm.phase_type === value}
                      onChange={() => setPhaseForm({ ...phaseForm, phase_type: value })}
                      disabled={!canEdit} />
                    <span style={{ fontSize: 12, fontWeight: 600, color, background: bg, padding: "2px 8px", borderRadius: 10 }}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phase-name">フェーズ名 <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="phase-name" type="text" value={phaseForm.name}
                onChange={(e) => { setPhaseForm({ ...phaseForm, name: e.target.value }); setPhaseErrors({}); }}
                maxLength={100} readOnly={!canEdit} />
              {phaseErrors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
            </div>

            <div className="form-group">
              <label htmlFor="phase-desc">説明（任意）</label>
              <textarea id="phase-desc" value={phaseForm.description}
                onChange={(e) => setPhaseForm({ ...phaseForm, description: e.target.value })}
                maxLength={500} style={{ minHeight: 60 }} readOnly={!canEdit} />
            </div>

            {/* 開始トリガー（start フェーズのみ表示） */}
            {phaseForm.phase_type === "start" && (
              <div className="form-group">
                <label htmlFor="phase-start-trigger">
                  開始トリガーキーワード（任意）
                </label>
                <input
                  id="phase-start-trigger"
                  type="text"
                  value={phaseForm.start_trigger}
                  onChange={(e) => setPhaseForm({ ...phaseForm, start_trigger: e.target.value })}
                  placeholder="例: はじめる"
                  maxLength={200}
                  readOnly={!canEdit}
                />
                <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                  未開始ユーザーがこのキーワードを送信するとシナリオが開始されます。
                  未設定の場合は任意のメッセージで自動開始します。
                </p>
              </div>
            )}

            {/* 再開時あらすじ */}
            <div className="form-group">
              <label htmlFor="phase-resume-summary">
                再開時あらすじ（任意）
              </label>
              <textarea
                id="phase-resume-summary"
                value={phaseForm.resume_summary}
                onChange={(e) => setPhaseForm({ ...phaseForm, resume_summary: e.target.value })}
                placeholder={"ここまでのあらすじ：\nあなたは不思議な手がかりをたどり、3つの謎を解きました。\nここから続きを始めます。"}
                maxLength={500}
                style={{ minHeight: 80 }}
                readOnly={!canEdit}
              />
              {phaseForm.resume_summary.length > 0 && (
                <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "right", marginTop: 2 }}>
                  {phaseForm.resume_summary.length} / 500
                </p>
              )}
              <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                プレイヤーが途中離脱後「途中から再開する」を選んだとき、このフェーズ再開前に送られる補助メッセージです。
                未入力の場合は送信されません。
              </p>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div className="form-group" style={{ flexShrink: 0 }}>
                <label htmlFor="phase-sort">表示順</label>
                <input id="phase-sort" type="number" value={phaseForm.sort_order}
                  onChange={(e) => setPhaseForm({ ...phaseForm, sort_order: Number(e.target.value) })}
                  min={0} style={{ width: 90 }} disabled={!canEdit} />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                  <input type="checkbox" checked={phaseForm.is_active}
                    onChange={(e) => setPhaseForm({ ...phaseForm, is_active: e.target.checked })}
                    style={{ width: "auto" }} disabled={!canEdit} />
                  有効にする
                </label>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={!canEdit || savingPhase}>
                {savingPhase && <span className="spinner" />}
                {savingPhase ? "保存中..." : "フェーズ設定を保存"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ══ 地点到着トリガー（見える化・A案／DB追加なし） ══ */}
      {canUseLocationFeatures && (
        <div style={{ maxWidth: 640, marginBottom: 24 }}>
          <div style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>地点到着トリガー</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 1.6 }}>
              このフェーズ中に、QR / GPS / Beacon の到着検知で次のメッセージやフェーズへ進む設定です。設定はメッセージ編集画面の「送信後に地点到着を待つ」で行います。
            </p>
          </div>

          {phaseArrivalTriggers.length === 0 ? (
            <div className="card" style={{ marginTop: 8 }}>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: canEdit ? 10 : 0 }}>
                このフェーズには地点到着トリガーが設定されていません。
              </p>
              {canEdit && (
                messages.length > 0 ? (
                  <Link href={`/oas/${oaId}/works/${workId}/messages/${messages[0].id}`}
                    style={{ display: "inline-block", padding: "7px 16px", fontSize: 13, fontWeight: 600, color: "#fff", background: "#2563eb", borderRadius: 8, textDecoration: "none" }}>
                    地点到着トリガーを設定する
                  </Link>
                ) : (
                  <Link href={`/oas/${oaId}/works/${workId}/messages/new`}
                    style={{ display: "inline-block", padding: "7px 16px", fontSize: 13, fontWeight: 600, color: "#fff", background: "#2563eb", borderRadius: 8, textDecoration: "none" }}>
                    メッセージを作成して設定する
                  </Link>
                )
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {phaseArrivalTriggers.map((m) => {
                const type      = m.checkin_trigger_type ?? "";
                const loc       = locName(m.checkin_trigger_location_id);
                const nextMsg   = msgById(m.checkin_trigger_next_message_id);
                const nextPhaseLabel = phaseName(m.checkin_trigger_next_phase_id);
                const chain     = !!nextMsg?.checkin_trigger_type;
                const beaconsForLoc = m.checkin_trigger_location_id
                  ? beaconTriggers.filter((b) => b.location_id === m.checkin_trigger_location_id) : [];
                const rows: [string, React.ReactNode][] = [
                  ["検知方法",      TRIGGER_METHOD_LABEL[type] ?? type],
                  ["対象地点",      loc ?? <span style={{ color: "#b45309" }}>未設定</span>],
                  ["到着時メッセージ", nextMsg ? msgLabel(nextMsg, 40) : <span style={{ color: "#b45309" }}>未設定</span>],
                  ["到着後フェーズ", nextPhaseLabel ?? <span style={{ color: "#9ca3af" }}>なし</span>],
                  ["チェーン",      nextMsg ? (chain ? "続きあり（次の地点待ちへ）" : "ここで終了") : "—"],
                ];
                return (
                  <div key={m.id} className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, minWidth: 0 }}>
                        起点メッセージ：{msgLabel(m, 40)}
                      </div>
                      <Link href={`/oas/${oaId}/works/${workId}/messages/${m.id}`}
                        style={{ flexShrink: 0, fontSize: 12, color: "#2563eb", textDecoration: "none" }}>
                        編集 →
                      </Link>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12, color: "#374151" }}>
                      {rows.map(([k, v]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <div style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{k}</div>
                          <div style={{ minWidth: 0 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {/* 設定ミス防止の注意・補足（保存はブロックしない・PR #336 と同思想） */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                      {!m.checkin_trigger_location_id && (
                        <div style={arrivalNotice.warn}>⚠ 対象地点が未設定です。到着判定に使う地点を選択してください。</div>
                      )}
                      {!m.checkin_trigger_next_message_id && (
                        <div style={arrivalNotice.warn}>⚠ 到着時メッセージが未設定です。</div>
                      )}
                      {type === "beacon" && m.checkin_trigger_location_id && beaconsForLoc.length === 0 && (
                        <div style={arrivalNotice.warn}>⚠ この地点に紐づくBeaconがありません。ビーコン編集画面で同じ地点を紐づけてください。</div>
                      )}
                      {!m.checkin_trigger_next_phase_id && (
                        <div style={arrivalNotice.muted}>到着後フェーズは未設定です（メッセージ送信のみ）。</div>
                      )}
                      {nextMsg && (
                        <div style={arrivalNotice.muted}>
                          {chain
                            ? "到着時メッセージから次の地点待ちへ続きます。"
                            : "この到着時メッセージで地点到着チェーンは終了します。"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {incomingArrivalTriggers.length > 0 && (
            <div style={{ ...arrivalNotice.muted, marginTop: 10 }}>
              他フェーズの {incomingArrivalTriggers.length} 件の地点到着トリガーが、到着後にこのフェーズへ遷移します。
            </div>
          )}
        </div>
      )}

      {/* ══ メッセージ管理（選択式） ══ */}
      <div style={{ maxWidth: 640, marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>メッセージ</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              このフェーズで Bot が送信するメッセージを管理します。
            </p>
          </div>
          {canEdit && (
            <Link
              href={`/oas/${oaId}/works/${workId}/messages/new`}
              className="btn btn-ghost"
              style={{ fontSize: 12, flexShrink: 0 }}
            >
              ＋ 新規作成
            </Link>
          )}
        </div>

        {/* ヒントバナー */}
        <div style={{
          background: "#E6F7ED", border: "1px solid #bbf7d0", borderRadius: 8,
          padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#166534", lineHeight: 1.7,
        }}>
          <strong>💡 メッセージとフェーズの分離</strong><br />
          メッセージはメッセージタブで作成・編集します。ここでは作成済みのメッセージを
          このフェーズに追加・外すことができます。
          {phase!.phase_type === "start" && " 開始フェーズのメッセージは作品への誘導に使いましょう。"}
          {phase!.phase_type === "ending" && " エンディングのメッセージは物語の締めくくりです。"}
        </div>

        {/* メッセージ検索セレクター */}
        <MessageSelector
          messages={availableMessages}
          onSelect={handleLinkMessage}
          disabled={linking || !canEdit}
        />

        {/* このフェーズのメッセージ一覧 */}
        {msgLoading ? (
          <div className="card" style={{ marginTop: 8 }}>
            {[1, 2].map((i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #e5e5e5" }}>
                <div className="skeleton" style={{ width: 240, height: 14, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 160, height: 11 }} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="card" style={{ marginTop: 8 }}>
            <p style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
              このフェーズにはまだメッセージがありません。<br />
              上の検索欄から追加、または「＋ 新規作成」でメッセージを作成してください。
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {messages.map((msg, idx) => {
              const char = msg.character;
              return (
                <div key={msg.id} className="card" style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    {/* 順番バッジ */}
                    <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
                      #{String(idx + 1).padStart(2, "0")}
                    </span>

                    {/* メッセージ情報 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {char && (
                        <span style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 2, fontWeight: 600 }}>
                          {char.name}
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 6px", borderRadius: 6, color: "#374151" }}>
                          {MSG_TYPE_LABEL[msg.message_type] ?? msg.message_type}
                        </span>
                        <span className={`badge ${msg.is_active ? "badge-active" : "badge-paused"}`} style={{ fontSize: 10 }}>
                          {msg.is_active ? "有効" : "無効"}
                        </span>
                      </div>
                      {msg.body && (
                        <p style={{ fontSize: 13, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {msg.body.length > 100 ? msg.body.slice(0, 100) + "…" : msg.body}
                        </p>
                      )}
                      {msg.asset_url && <MsgImagePreview url={msg.asset_url} />}
                    </div>

                    {/* アクション */}
                    <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "flex-start" }}>
                      <Link
                        href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                        className="btn btn-ghost"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                      >
                        詳細・編集
                      </Link>
                      {(isOwner || isAdmin) && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "3px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                          onClick={() => handleUnlinkMessage(msg.id)}
                        >
                          外す
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </>
  );
}

// ────────────────────────────────────────────────
// MessageSelector — 検索可能なメッセージ選択コンボボックス
// ────────────────────────────────────────────────
interface MessageSelectorProps {
  messages: MessageWithRelations[];
  onSelect: (msgId: string) => void;
  disabled?: boolean;
}

function MessageSelector({ messages, onSelect, disabled }: MessageSelectorProps) {
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);
  const containerRef        = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = messages.filter((m) => {
    const label = msgLabel(m).toLowerCase();
    return !query.trim() || label.includes(query.toLowerCase());
  });

  return (
    <div ref={containerRef} style={{ position: "relative", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            type="text"
            placeholder={
              messages.length === 0
                ? "追加できるメッセージがありません（メッセージタブで作成してください）"
                : "メッセージを検索して追加… 例: ミオ、あれ…"
            }
            value={query}
            disabled={disabled || messages.length === 0}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1.5px solid #d1d5db",
              borderRadius: 8,
              fontSize: 13,
              outline: "none",
              background: messages.length === 0 ? "#f9fafb" : "#fff",
              color: messages.length === 0 ? "#9ca3af" : undefined,
            }}
          />
        </div>
      </div>

      {/* ドロップダウンリスト */}
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          zIndex: 50,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          maxHeight: 260,
          overflowY: "auto",
          marginTop: 4,
        }}>
          {filtered.map((msg) => {
            const label = msgLabel(msg);
            const char  = msg.character?.name;
            const body  = msg.body
              ? msg.body.slice(0, 80)
              : `[${MSG_TYPE_LABEL[msg.message_type] ?? msg.message_type}]`;

            return (
              <button
                key={msg.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(msg.id);
                  setQuery("");
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "9px 14px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid #f3f4f6",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                {char && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block" }}>
                    {char}
                  </span>
                )}
                <span style={{ fontSize: 13, color: "#111827" }}>
                  {body.length < label.length - (char ? char.length + 1 : 0)
                    ? body + "…"
                    : body}
                </span>
                {/* フェーズ情報があれば表示 */}
                {msg.phase_id && (
                  <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 8 }}>
                    （別フェーズ所属）
                  </span>
                )}
              </button>
            );
          })}
          {query.trim() && filtered.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
              「{query}」に一致するメッセージが見つかりません
            </div>
          )}
        </div>
      )}

      {/* 全件数ヒント */}
      {messages.length > 0 && !open && (
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          追加可能: {messages.length} 件（うちフェーズ未割当: {messages.filter(m => !m.phase_id).length} 件）
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
// MsgImagePreview — 画像サムネイル
// ────────────────────────────────────────────────
function MsgImagePreview({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
        🖼 <span style={{ wordBreak: "break-all" }}>{url}</span>
        <span style={{ marginLeft: 4, color: "#ef4444" }}>(読み込み失敗)</span>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="画像プレビュー"
        onError={() => setErrored(true)}
        style={{
          maxWidth: 200, maxHeight: 120, borderRadius: 6,
          display: "block", objectFit: "cover",
          border: "1px solid #e5e7eb",
        }}
      />
      <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, wordBreak: "break-all", maxWidth: 200 }}>
        {url.length > 60 ? url.slice(0, 60) + "…" : url}
      </p>
    </div>
  );
}
