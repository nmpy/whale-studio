"use client";

// src/app/oas/[id]/settings/members/page.tsx
//
// メンバー管理ページ（admin / owner のみアクセス可）
//
// セクション構成:
//   1. メンバー一覧   — role プルダウン / status セレクト / 削除（権限制御付き）
//   2. 招待一覧       — 有効な招待の表示・リンクコピー・取り消し
//   3. 招待フォーム   — email + role → 招待リンク生成

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDevToken,
  memberApi,
  invitationApi,
  type WorkspaceMember,
  type Invitation,
} from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { RoleBadge } from "@/components/PermissionGuard";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Role } from "@/lib/types/permissions";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/types/permissions";
import {
  STATUS_LABELS,
  STATUS_OPTIONS,
  STATUS_COLORS,
  INVITATION_STATE_LABELS,
  CONFIRM,
  TOAST,
  TOOLTIP,
} from "@/lib/constants/member-text";

// ── 型 ───────────────────────────────────────────────────────────────

type Section = "members" | "invitations";

// ── ページ本体 ────────────────────────────────────────────────────────

export default function MembersPage() {
  const { id: oaId }                         = useParams<{ id: string }>();
  const { role, loading: roleLoading, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const { showToast }                         = useToast();
  const token                                 = getDevToken();

  const [section,     setSection]     = useState<Section>("members");
  const [members,     setMembers]     = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingM,    setLoadingM]    = useState(true);
  const [loadingI,    setLoadingI]    = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [myUserId,    setMyUserId]    = useState<string | null>(null);

  const canManage = isOwner || isAdmin;

  // ── ロール階層ソート（API 側と同じ基準。フロント側でも保証） ─────────
  const ROLE_SORT_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, tester: 3 };
  function sortMembers(list: WorkspaceMember[]): WorkspaceMember[] {
    return [...list].sort(
      (a, b) => (ROLE_SORT_ORDER[a.role] ?? 9) - (ROLE_SORT_ORDER[b.role] ?? 9)
    );
  }

  // ── データ取得 ────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    setLoadingM(true);
    setErrorMsg(null);
    try {
      const data = await memberApi.list(token, oaId);
      setMembers(sortMembers(data));   // フロント側でもソート保証
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : TOAST.membersLoadFailed);
    } finally {
      setLoadingM(false);
    }
  }, [oaId, token]);

  const fetchInvitations = useCallback(async () => {
    setLoadingI(true);
    try {
      const data = await invitationApi.list(token, oaId);
      setInvitations(data);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : TOAST.invitationsLoadFailed);
    } finally {
      setLoadingI(false);
    }
  }, [oaId, token]);

  // 自分の user_id を取得（自己操作ガードに使用）
  useEffect(() => {
    if (!roleLoading && canManage) {
      memberApi.getMyRole(token, oaId)
        .then((me) => setMyUserId(me.user_id))
        .catch(() => {}); // 取得失敗時は null のまま（制限なしに倒す）
    }
  }, [roleLoading, canManage, oaId, token]);

  useEffect(() => {
    if (!roleLoading && canManage) {
      fetchMembers();
    }
  }, [roleLoading, canManage, fetchMembers]);

  useEffect(() => {
    if (!roleLoading && canManage && section === "invitations") {
      fetchInvitations();
    }
  }, [roleLoading, canManage, section, fetchInvitations]);

  // ── アクセスガード ────────────────────────────────────────────────

  if (!roleLoading && !canManage) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>アクセス権限がありません</p>
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          メンバー管理は admin / owner のみ利用できます
        </p>
        <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost" style={{ marginTop: 20 }}>
          設定に戻る
        </Link>
      </div>
    );
  }

  const activeInvitations  = invitations.filter((i) => !i.is_expired && !i.is_accepted);
  const expiredInvitations = invitations.filter((i) => i.is_expired || i.is_accepted);

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "メンバー管理" },
          ]} />
          <h2>メンバー管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            ワークスペースメンバーのロール・ステータスを管理します
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {errorMsg}
        </div>
      )}

      {/* ── タブ ── */}
      <div style={{
        display:      "flex",
        gap:          0,
        marginBottom: 20,
        borderBottom: "2px solid #e5e7eb",
      }}>
        {(["members", "invitations"] as Section[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            style={{
              padding:      "9px 20px",
              fontSize:     13,
              fontWeight:   section === s ? 700 : 500,
              color:        section === s ? "#111827" : "#6b7280",
              background:   "none",
              border:       "none",
              borderBottom: section === s ? "2px solid #111827" : "2px solid transparent",
              marginBottom: -2,
              cursor:       "pointer",
              transition:   "color .15s",
            }}
          >
            {s === "members" ? `👥 メンバー（${members.length}）` : `✉️ 招待`}
            {s === "invitations" && activeInvitations.length > 0 && (
              <span style={{
                display:      "inline-block",
                marginLeft:   6,
                padding:      "1px 7px",
                fontSize:     11,
                fontWeight:   700,
                background:   "#dbeafe",
                color:        "#1e40af",
                borderRadius: 99,
              }}>
                {activeInvitations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── タブコンテンツ ── */}
      {section === "members" && (
        <MembersSection
          oaId={oaId}
          token={token}
          members={members}
          loading={loadingM}
          myRole={role}
          myUserId={myUserId}
          isOwner={isOwner}
          isAdmin={isAdmin}
          onRefresh={fetchMembers}
          showToast={showToast}
        />
      )}

      {section === "invitations" && (
        <InvitationsSection
          oaId={oaId}
          token={token}
          activeInvitations={activeInvitations}
          expiredInvitations={expiredInvitations}
          loading={loadingI}
          isOwner={isOwner}
          isAdmin={isAdmin}
          onRefresh={fetchInvitations}
          showToast={showToast}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section 1: メンバー一覧
// ────────────────────────────────────────────────────────────────────

interface MembersSectionProps {
  oaId:      string;
  token:     string;
  members:   WorkspaceMember[];
  loading:   boolean;
  myRole:    Role | null;
  myUserId:  string | null;  // 自己操作ガード用
  isOwner:   boolean;
  isAdmin:   boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string, type: "success" | "error") => void;
}

function MembersSection({
  oaId, token, members, loading, myUserId, isOwner, isAdmin, onRefresh, showToast,
}: MembersSectionProps) {

  // ── 派生値 ───────────────────────────────────────────────────────
  const ownerCount = members.filter((m) => m.role === "owner").length;

  /** 自分自身かどうか（user_id が取得できた場合のみ判定） */
  const isMe = (m: WorkspaceMember) =>
    myUserId !== null && m.user_id === myUserId;

  /** 最後の owner かどうか（削除・ロール変更を禁止するため） */
  const isLastOwner = (m: WorkspaceMember) =>
    m.role === "owner" && ownerCount <= 1;

  /**
   * ロール / ステータス を変更できるか
   *   - owner: 自分以外の全メンバーを操作可
   *   - admin: owner 以外のメンバーを操作可（自分も変更不可）
   * ※ isMe / isLastOwner の制限は呼び出し側で別途チェック
   */
  function canModify(target: WorkspaceMember): boolean {
    if (isOwner) return true;
    if (isAdmin && target.role !== "owner") return true;
    return false;
  }

  // ── ハンドラ ─────────────────────────────────────────────────────

  async function handleRoleChange(m: WorkspaceMember, newRole: Role) {
    const name = m.email ?? m.user_id;
    if (!confirm(CONFIRM.roleChange(name, ROLE_LABELS[newRole]))) return;
    try {
      await memberApi.updateRole(token, oaId, m.id, newRole);
      showToast(TOAST.roleChanged, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.roleChangeFailed, "error");
    }
  }

  async function handleStatusChange(m: WorkspaceMember, newStatus: string) {
    const name = m.email ?? m.user_id;
    if (newStatus === "suspended") {
      if (!confirm(CONFIRM.suspend(name))) return;
    } else {
      const label = STATUS_LABELS[newStatus] ?? newStatus;
      if (!confirm(CONFIRM.statusChange(name, label))) return;
    }
    try {
      await memberApi.updateStatus(token, oaId, m.id, newStatus);
      showToast(TOAST.statusChanged, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.statusChangeFailed, "error");
    }
  }

  async function handleDelete(m: WorkspaceMember) {
    const name = m.email ?? m.user_id;
    if (!confirm(CONFIRM.deleteMember(name))) return;
    try {
      await memberApi.remove(token, oaId, m.id);
      showToast(TOAST.memberDeleted, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.deleteFailed, "error");
    }
  }

  // ── ローディング ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: "45%", height: 14, marginBottom: 6, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: "25%", height: 11, borderRadius: 4 }} />
            </div>
            <div className="skeleton" style={{ width: 90, height: 30, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: 90, height: 30, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>
        <p style={{ fontSize: 14 }}>メンバーがいません</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* テーブルヘッダー */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "1fr 140px 140px 100px 80px",
        gap:                 8,
        padding:             "10px 20px",
        background:          "#f9fafb",
        borderBottom:        "1px solid #e5e7eb",
        fontSize:            11,
        fontWeight:          700,
        color:               "#6b7280",
        textTransform:       "uppercase",
        letterSpacing:       "0.06em",
      }}>
        <span>ユーザー</span>
        <span>ロール</span>
        <span>ステータス</span>
        <span>参加日</span>
        <span style={{ textAlign: "right" }}>操作</span>
      </div>

      {/* ── 行 ── */}
      {members.map((m) => {
        const modifiable  = canModify(m);
        const isSelf      = isMe(m);
        const isLastOwn   = isLastOwner(m);
        const statusStyle = STATUS_COLORS[m.status] ?? STATUS_COLORS.active;
        const joinedDate  = m.joined_at
          ? new Date(m.joined_at).toLocaleDateString("ja-JP", {
              year: "numeric", month: "2-digit", day: "2-digit",
            })
          : "—";

        // ── role select の無効化理由 ──────────────────────────────
        const roleDisabled = isSelf || isLastOwn;
        const roleTitle    = isSelf    ? TOOLTIP.selfRoleChange
                           : isLastOwn ? TOOLTIP.lastOwnerRoleChange
                           : undefined;

        // ── status select の無効化理由 ────────────────────────────
        const statusDisabled = isSelf;
        const statusTitle    = isSelf ? TOOLTIP.selfStatusChange : undefined;

        // ── 削除ボタンの無効化理由 ────────────────────────────────
        const deleteDisabled = isSelf || isLastOwn;
        const deleteTitle    = isSelf    ? TOOLTIP.selfDelete
                             : isLastOwn ? TOOLTIP.lastOwnerDelete
                             : TOOLTIP.deleteButton;

        return (
          <div
            key={m.id}
            style={{
              display:             "grid",
              gridTemplateColumns: "1fr 140px 140px 100px 80px",
              gap:                 8,
              padding:             "12px 20px",
              borderBottom:        "1px solid #f3f4f6",
              alignItems:          "center",
              // 自分の行を薄いハイライト
              background:          isSelf ? "#fafafa" : undefined,
            }}
          >
            {/* ── ユーザー列 ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{
                width:          36,
                height:         36,
                borderRadius:   "50%",
                background:     isSelf ? "#dbeafe" : "#e5e7eb",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                fontSize:       14,
                fontWeight:     700,
                color:          isSelf ? "#1e40af" : "#6b7280",
                flexShrink:     0,
              }}>
                {(m.email ?? m.user_id).slice(0, 1).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display:     "flex",
                  alignItems:  "center",
                  gap:         6,
                  fontSize:    13,
                  fontWeight:  600,
                  color:       "#111827",
                }}>
                  <span style={{
                    overflow:    "hidden",
                    textOverflow:"ellipsis",
                    whiteSpace:  "nowrap",
                  }}>
                    {m.email ?? (
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af" }}>
                        {m.user_id.slice(0, 20)}…
                      </span>
                    )}
                  </span>
                  {/* 自分バッジ */}
                  {isSelf && (
                    <span style={{
                      flexShrink:   0,
                      fontSize:     10,
                      fontWeight:   700,
                      padding:      "1px 6px",
                      borderRadius: 99,
                      background:   "#dbeafe",
                      color:        "#1e40af",
                    }}>
                      自分
                    </span>
                  )}
                </div>
                {m.email && (
                  <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
                    {m.user_id.slice(0, 16)}…
                  </div>
                )}
              </div>
            </div>

            {/* ── ロール列 ── */}
            {modifiable ? (
              <select
                value={m.role}
                disabled={roleDisabled}
                title={roleTitle}
                onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                style={{
                  padding:      "5px 8px",
                  fontSize:     12,
                  border:       "1px solid #e5e7eb",
                  borderRadius: 6,
                  background:   roleDisabled ? "#f3f4f6" : "#fff",
                  color:        roleDisabled ? "#9ca3af" : "#111827",
                  cursor:       roleDisabled ? "not-allowed" : "pointer",
                  width:        "100%",
                  opacity:      roleDisabled ? 0.7 : 1,
                }}
              >
                {ROLES.filter((r) =>
                  // admin は owner ロールを付与不可
                  isOwner ? true : r !== "owner"
                ).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            ) : (
              <RoleBadge role={m.role as Role} />
            )}

            {/* ── ステータス列 ── */}
            {modifiable ? (
              <select
                value={m.status}
                disabled={statusDisabled}
                title={statusTitle}
                onChange={(e) => handleStatusChange(m, e.target.value)}
                style={{
                  padding:      "5px 8px",
                  fontSize:     12,
                  border:       `1px solid ${statusDisabled ? "#e5e7eb" : statusStyle.border}`,
                  borderRadius: 6,
                  background:   statusDisabled ? "#f3f4f6" : statusStyle.bg,
                  color:        statusDisabled ? "#9ca3af" : statusStyle.color,
                  cursor:       statusDisabled ? "not-allowed" : "pointer",
                  fontWeight:   600,
                  width:        "100%",
                  opacity:      statusDisabled ? 0.7 : 1,
                }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <StatusBadge status={m.status} />
            )}

            {/* ── 参加日列 ── */}
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{joinedDate}</div>

            {/* ── 操作列（owner のみ表示） ── */}
            <div style={{ textAlign: "right" }}>
              {isOwner && (
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{
                    padding:  "4px 10px",
                    fontSize: 11,
                    opacity:  deleteDisabled ? 0.4 : 1,
                    cursor:   deleteDisabled ? "not-allowed" : "pointer",
                  }}
                  disabled={deleteDisabled}
                  title={deleteTitle}
                  onClick={() => !deleteDisabled && handleDelete(m)}
                >
                  削除
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* フッター: ロール説明 */}
      <div style={{
        padding:    "12px 20px",
        background: "#f9fafb",
        borderTop:  "1px solid #e5e7eb",
      }}>
        <details style={{ fontSize: 12 }}>
          <summary style={{ color: "#6b7280", cursor: "pointer", userSelect: "none" }}>
            ロール権限の説明
          </summary>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {ROLES.map((r) => (
              <div key={r} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <RoleBadge role={r} />
                <span style={{ color: "#6b7280", paddingTop: 2, lineHeight: 1.4 }}>
                  {ROLE_DESCRIPTIONS[r]}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section 2: 招待一覧 + 招待フォーム
// ────────────────────────────────────────────────────────────────────

interface InvitationsSectionProps {
  oaId:               string;
  token:              string;
  activeInvitations:  Invitation[];
  expiredInvitations: Invitation[];
  loading:            boolean;
  isOwner:            boolean;
  isAdmin:            boolean;
  onRefresh:          () => Promise<void>;
  showToast:          (msg: string, type: "success" | "error") => void;
}

function InvitationsSection({
  oaId, token, activeInvitations, expiredInvitations, loading,
  isOwner, isAdmin, onRefresh, showToast,
}: InvitationsSectionProps) {

  const [inviteEmail,  setInviteEmail]  = useState("");
  const [inviteRole,   setInviteRole]   = useState<Role>("editor");
  const [inviting,     setInviting]     = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [showExpired,  setShowExpired]  = useState(false);
  /** コピー済み状態の招待 ID（2秒間ボタン表示を変える） */
  const [copiedId,     setCopiedId]     = useState<string | null>(null);

  async function handleRevoke(inv: Invitation) {
    if (!confirm(CONFIRM.revokeInvitation(inv.email))) return;
    try {
      await invitationApi.revoke(token, oaId, inv.id);
      showToast(TOAST.invitationRevoked, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.revokeFailed, "error");
    }
  }

  async function handleCopyLink(id: string, url: string) {
    await navigator.clipboard.writeText(url);
    showToast(TOAST.linkCopied, "success");
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setNewInviteUrl(null);
    try {
      const result = await invitationApi.create(token, oaId, {
        email: inviteEmail.trim(),
        role:  inviteRole,
      });
      const url = `${window.location.origin}/invite/${result.token}`;
      setNewInviteUrl(url);
      setInviteEmail("");
      showToast(TOAST.invitationCreated, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.inviteFailed, "error");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── 招待フォーム ── */}
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>メンバーを招待</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
          メールアドレスを入力すると招待リンクが発行されます。リンクを相手に送ってください。
        </p>

        <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="email"
            placeholder="招待するメールアドレス"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            style={{
              flex:     1,
              minWidth: 220,
              padding:  "8px 12px",
              fontSize: 13,
              border:   "1px solid #e5e7eb",
              borderRadius: 6,
            }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            style={{
              padding:  "8px 10px",
              fontSize: 13,
              border:   "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
            }}
          >
            {ROLES.filter((r) => isOwner ? true : r !== "owner").map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={inviting || !inviteEmail.trim()}
          >
            {inviting ? "生成中..." : "招待リンクを発行"}
          </button>
        </form>

        {/* 生成済み招待リンク */}
        {newInviteUrl && (
          <div style={{
            marginTop:    16,
            padding:      "12px 14px",
            background:   "#f0fdf4",
            border:       "1px solid #86efac",
            borderRadius: 8,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
              ✅ 招待リンクが発行されました
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                readOnly
                value={newInviteUrl}
                style={{
                  flex:       1,
                  padding:    "6px 10px",
                  fontSize:   12,
                  border:     "1px solid #86efac",
                  borderRadius: 6,
                  background: "#fff",
                  fontFamily: "monospace",
                  color:      "#111827",
                }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0, fontSize: 12, padding: "6px 12px" }}
                onClick={async () => {
                  await navigator.clipboard.writeText(newInviteUrl);
                  showToast("リンクをコピーしました", "success");
                }}
              >
                コピー
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
              有効期限は 7日間です。期限切れの場合は再発行してください。
            </p>
          </div>
        )}
      </div>

      {/* ── 有効な招待一覧 ── */}
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
          有効な招待
          {activeInvitations.length > 0 && (
            <span style={{
              marginLeft:   8,
              fontSize:     12,
              fontWeight:   400,
              color:        "#6b7280",
            }}>
              {activeInvitations.length} 件
            </span>
          )}
        </h3>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />
            ))}
          </div>
        ) : activeInvitations.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>有効な招待はありません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {activeInvitations.map((inv, idx) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                isLast={idx === activeInvitations.length - 1}
                isCopied={copiedId === inv.id}
                onCopy={(url) => handleCopyLink(inv.id, url)}
                onRevoke={() => handleRevoke(inv)}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 期限切れ / 受け入れ済み ── */}
      {expiredInvitations.length > 0 && (
        <div className="card">
          <button
            type="button"
            onClick={() => setShowExpired(!showExpired)}
            style={{
              background:   "none",
              border:       "none",
              cursor:       "pointer",
              fontSize:     13,
              fontWeight:   600,
              color:        "#6b7280",
              display:      "flex",
              alignItems:   "center",
              gap:          6,
              padding:      0,
            }}
          >
            {showExpired ? "▼" : "▶"} 期限切れ・受け入れ済み（{expiredInvitations.length} 件）
          </button>

          {showExpired && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 0 }}>
              {expiredInvitations.map((inv, idx) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  isLast={idx === expiredInvitations.length - 1}
                  onRevoke={undefined}
                  dimmed
                  showToast={showToast}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 招待行コンポーネント ──────────────────────────────────────────────

function InvitationRow({
  invitation: inv,
  isLast,
  isCopied  = false,
  onCopy,
  onRevoke,
  dimmed    = false,
  showToast: _showToast,
}: {
  invitation: Invitation;
  isLast:     boolean;
  isCopied?:  boolean;
  onCopy?:    (url: string) => void;
  onRevoke?:  () => void;
  dimmed?:    boolean;
  showToast:  (msg: string, type: "success" | "error") => void;
}) {
  const expiresStr = new Date(inv.expires_at).toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inv.token}`;

  // 招待の状態ラベル
  const stateLabel = inv.is_accepted
    ? `✅ ${INVITATION_STATE_LABELS.accepted}`
    : inv.is_expired
    ? `⏰ ${INVITATION_STATE_LABELS.expired}`
    : `有効期限: ${expiresStr}`;

  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          12,
      padding:      "12px 0",
      borderBottom: isLast ? "none" : "1px solid #f3f4f6",
      opacity:      dimmed ? 0.55 : 1,
      flexWrap:     "wrap",
    }}>
      {/* メール + 状態 */}
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{inv.email}</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{stateLabel}</div>
      </div>

      <RoleBadge role={inv.role as Role} />

      {/* 操作（有効な招待のみ） */}
      {!dimmed && (
        <>
          {onCopy && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                fontSize:   11,
                padding:    "4px 10px",
                flexShrink: 0,
                minWidth:   100,
                color:      isCopied ? "#059669" : undefined,
                fontWeight: isCopied ? 700 : undefined,
                transition: "color .2s",
              }}
              onClick={() => onCopy(inviteUrl)}
            >
              {isCopied ? "✅ コピー済み" : "リンクをコピー"}
            </button>
          )}
          {onRevoke && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
              onClick={onRevoke}
            >
              取り消し
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── ステータスバッジ ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  return (
    <span style={{
      display:      "inline-block",
      padding:      "3px 10px",
      borderRadius: 99,
      fontSize:     11,
      fontWeight:   700,
      background:   s.bg,
      color:        s.color,
      border:       `1px solid ${s.border}`,
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
