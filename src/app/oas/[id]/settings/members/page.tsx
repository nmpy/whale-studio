"use client";

// src/app/oas/[id]/settings/members/page.tsx
//
// メンバー管理ページ（admin / owner のみアクセス可）
//
// セクション構成:
//   1. メンバー一覧   — role プルダウン / status セレクト / 削除（権限制御付き）
//   2. 招待一覧       — 有効な招待の表示・リンクコピー・取り消し
//   3. 招待フォーム   — email + role → 招待リンク生成

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDevToken,
  memberApi,
  invitationApi,
  type WorkspaceMember,
  type ProvisionalUser,
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
  INVITATION_STATUS_STYLES,
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

  const [section,      setSection]      = useState<Section>("members");
  const [members,      setMembers]      = useState<WorkspaceMember[]>([]);
  const [provisional,  setProvisional]  = useState<ProvisionalUser[]>([]);
  const [invitations,  setInvitations]  = useState<Invitation[]>([]);
  const [loadingM,     setLoadingM]     = useState(true);
  const [loadingI,     setLoadingI]     = useState(false);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [myUserId,     setMyUserId]     = useState<string | null>(null);

  const canManage = isOwner || isAdmin;

  // ── ロール階層ソート（API 側と同じ基準。フロント側でも保証） ─────────
  const ROLE_SORT_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, tester: 3, viewer: 4 };
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
      const { members: list, provisional: prov } = await memberApi.list(token, oaId);
      setMembers(sortMembers(list));   // フロント側でもソート保証
      setProvisional(prov);
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

  const pendingInvitationsCount = invitations.filter((i) => !i.is_expired && !i.is_accepted).length;

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
            {s === "members"
            ? `メンバー（${members.length}）${provisional.length > 0 ? ` + 未登録 ${provisional.length}` : ""}`
            : `✉️ 招待`}
            {s === "invitations" && pendingInvitationsCount > 0 && (
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
                {pendingInvitationsCount}
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
          provisional={provisional}
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
          invitations={invitations}
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
  oaId:        string;
  token:       string;
  members:     WorkspaceMember[];
  provisional: ProvisionalUser[];
  loading:     boolean;
  myRole:      Role | null;
  myUserId:    string | null;  // 自己操作ガード用
  isOwner:     boolean;
  isAdmin:     boolean;
  onRefresh:   () => Promise<void>;
  showToast: (msg: string, type: "success" | "error") => void;
}

function MembersSection({
  oaId, token, members, provisional, loading, myUserId, isOwner, isAdmin, onRefresh, showToast,
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

  if (members.length === 0 && provisional.length === 0) {
    return (
      <div className="card" style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>
        <p style={{ fontSize: 14 }}>メンバーがいません</p>
        <p style={{ fontSize: 12, marginTop: 8 }}>
          招待を送るか、アプリにアクセスしたユーザーが自動的にここに表示されます。
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

    {/* ── 正式メンバー一覧 ── */}
    {members.length > 0 && (
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

            {/* ── 操作列（admin / owner に表示。admin は owner 行を操作不可） ── */}
            <div style={{ textAlign: "right" }}>
              {modifiable && (
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
    )} {/* /正式メンバーカード */}

    {/* ── 未登録ユーザー（アプリ操作履歴あり） ── */}
    {provisional.length > 0 && (
      <ProvisionalSection
        oaId={oaId}
        token={token}
        provisional={provisional}
        isOwner={isOwner}
        isAdmin={isAdmin}
        onRefresh={onRefresh}
        showToast={showToast}
      />
    )}

    </div> // outer flex
  );
}

// ────────────────────────────────────────────────────────────────────
// 未登録ユーザーセクション
// ────────────────────────────────────────────────────────────────────

interface ProvisionalSectionProps {
  oaId:        string;
  token:       string;
  provisional: ProvisionalUser[];
  isOwner:     boolean;
  isAdmin:     boolean;
  onRefresh:   () => Promise<void>;
  showToast:   (msg: string, type: "success" | "error") => void;
}

function ProvisionalSection({
  oaId, token, provisional, isOwner, isAdmin, onRefresh, showToast,
}: ProvisionalSectionProps) {
  const canManage = isOwner || isAdmin;

  async function handleRegister(user: ProvisionalUser, role: Role) {
    const name = user.email ?? user.user_id;
    if (!confirm(`${name} を ${ROLE_LABELS[role]} として正式登録しますか？`)) return;
    try {
      await memberApi.add(token, oaId, {
        user_id: user.user_id,
        role,
        ...(user.email ? { email: user.email } : {}),
      });
      showToast(`${name} を ${ROLE_LABELS[role]} として登録しました`, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "登録に失敗しました", "error");
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* ヘッダー */}
      <div style={{
        padding:      "12px 20px",
        background:   "#fffbeb",
        borderBottom: "1px solid #fde68a",
        display:      "flex",
        alignItems:   "center",
        gap:          8,
      }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            未登録ユーザー（{provisional.length}件）
          </span>
          <span style={{ fontSize: 11, color: "#b45309", marginLeft: 8 }}>
            最近アプリを操作したユーザーです。ロールを設定すると正式メンバーに登録されます。
          </span>
        </div>
      </div>

      {/* テーブルヘッダー */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "1fr 80px 160px",
        gap:                 8,
        padding:             "8px 20px",
        background:          "#f9fafb",
        borderBottom:        "1px solid #e5e7eb",
        fontSize:            11,
        fontWeight:          700,
        color:               "#6b7280",
        textTransform:       "uppercase",
        letterSpacing:       "0.06em",
      }}>
        <span>ユーザー</span>
        <span>最終操作</span>
        <span>{canManage ? "ロール付与" : "状態"}</span>
      </div>

      {/* 行 */}
      {provisional.map((u) => (
        <ProvisionalRow
          key={u.user_id}
          user={u}
          canManage={canManage}
          isOwner={isOwner}
          onRegister={handleRegister}
        />
      ))}
    </div>
  );
}

// ── 未登録ユーザー行 ─────────────────────────────────────────────────

function ProvisionalRow({
  user, canManage, isOwner, onRegister,
}: {
  user:       ProvisionalUser;
  canManage:  boolean;
  isOwner:    boolean;
  onRegister: (user: ProvisionalUser, role: Role) => Promise<void>;
}) {
  const [selectedRole, setSelectedRole] = useState<Role>("viewer");
  const [registering,  setRegistering]  = useState(false);

  const lastSeen = new Date(user.last_seen_at).toLocaleDateString("ja-JP", {
    month: "2-digit", day: "2-digit",
  });

  async function handleClick() {
    setRegistering(true);
    try {
      await onRegister(user, selectedRole);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: "1fr 80px 160px",
      gap:                 8,
      padding:             "12px 20px",
      borderBottom:        "1px solid #f3f4f6",
      alignItems:          "center",
    }}>
      {/* ユーザー列 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div style={{
          width:          36, height: 36, borderRadius: "50%",
          background:     "#fef9c3",
          display:        "flex", alignItems: "center", justifyContent: "center",
          fontSize:       14, fontWeight: 700, color: "#92400e", flexShrink: 0,
        }}>
          {(user.email ?? user.user_id).slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email ?? (
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9ca3af" }}>
                  {user.user_id.slice(0, 20)}…
                </span>
              )}
            </span>
            {/* 未登録バッジ */}
            <span style={{
              flexShrink: 0, fontSize: 10, fontWeight: 700,
              padding: "1px 6px", borderRadius: 99,
              background: "#fef9c3", color: "#92400e",
              border: "1px solid #fde68a",
            }}>
              未登録
            </span>
          </div>
          {user.email && (
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
              {user.user_id.slice(0, 16)}…
            </div>
          )}
        </div>
      </div>

      {/* 最終操作 */}
      <div style={{ fontSize: 11, color: "#9ca3af" }}>{lastSeen}</div>

      {/* ロール付与 */}
      {canManage ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as Role)}
            disabled={registering}
            style={{
              flex: 1, padding: "5px 6px", fontSize: 12,
              border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff",
            }}
          >
            {ROLES.filter((r) => isOwner ? true : r !== "owner").map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0, whiteSpace: "nowrap" }}
            disabled={registering}
            onClick={handleClick}
          >
            {registering ? "…" : "登録"}
          </button>
        </div>
      ) : (
        <span style={{
          fontSize: 11, fontWeight: 700,
          padding: "2px 8px", borderRadius: 20,
          background: "#f9fafb", color: "#6b7280",
          border: "1px solid #e5e7eb",
        }}>
          閲覧者（未登録）
        </span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section 2: 招待一覧 + 招待フォーム
// ────────────────────────────────────────────────────────────────────

interface InvitationsSectionProps {
  oaId:        string;
  token:       string;
  invitations: Invitation[];
  loading:     boolean;
  isOwner:     boolean;
  isAdmin:     boolean;
  onRefresh:   () => Promise<void>;
  showToast:   (msg: string, type: "success" | "error") => void;
}

// ── 招待をステータス優先 → created_at 降順でソート ─────────────────────
function sortInvitations(list: Invitation[]): Invitation[] {
  const statusOrder = (inv: Invitation): number =>
    inv.is_accepted ? 2 : inv.is_expired ? 1 : 0;
  return [...list].sort((a, b) => {
    const diff = statusOrder(a) - statusOrder(b);
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function InvitationsSection({
  oaId, token, invitations, loading,
  isOwner, isAdmin, onRefresh, showToast,
}: InvitationsSectionProps) {

  const [inviteEmail,   setInviteEmail]  = useState("");
  const [inviteRole,    setInviteRole]   = useState<Role>("editor");
  const [inviting,      setInviting]     = useState(false);
  const [newInviteUrl,  setNewInviteUrl] = useState<string | null>(null);
  const [copiedId,      setCopiedId]     = useState<string | null>(null);
  /** 取り消し確認モーダル対象 */
  const [revokeTarget,  setRevokeTarget] = useState<Invitation | null>(null);
  const [revoking,      setRevoking]     = useState(false);

  /** 招待フォームカードへのref（空状態の「メンバーを招待」ボタンでスクロール） */
  const formCardRef = useRef<HTMLDivElement>(null);

  // ── 集計 ─────────────────────────────────────────────────────────
  const pendingCount  = invitations.filter((i) => !i.is_expired && !i.is_accepted).length;
  const expiredCount  = invitations.filter((i) =>  i.is_expired && !i.is_accepted).length;
  const acceptedCount = invitations.filter((i) =>  i.is_accepted).length;

  const sorted = sortInvitations(invitations);

  // ── ハンドラ ─────────────────────────────────────────────────────

  /** pending → 取り消しモーダルを開く */
  function handleRevoke(inv: Invitation) {
    setRevokeTarget(inv);
  }

  /** モーダルで「取り消す」確定 */
  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await invitationApi.revoke(token, oaId, revokeTarget.id);
      showToast(TOAST.invitationRevoked, "success");
      setRevokeTarget(null);
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.revokeFailed, "error");
    } finally {
      setRevoking(false);
    }
  }

  /** expired → 再発行（同メール・同ロールで create = upsert） */
  async function handleReissue(inv: Invitation) {
    try {
      const result = await invitationApi.create(token, oaId, {
        email: inv.email,
        role:  inv.role,
      });
      const url = `${window.location.origin}/invite/${result.token}`;
      setNewInviteUrl(url);
      showToast(TOAST.invitationReissued, "success");
      await onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : TOAST.inviteFailed, "error");
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

      {/* ── 取り消し確認モーダル ── */}
      {revokeTarget && (
        <RevokeConfirmModal
          email={revokeTarget.email}
          revoking={revoking}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={confirmRevoke}
        />
      )}

      {/* ── 招待フォーム ── */}
      <div className="card" ref={formCardRef}>
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
              flex:         1,
              minWidth:     220,
              padding:      "8px 12px",
              fontSize:     13,
              border:       "1px solid #e5e7eb",
              borderRadius: 6,
            }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            style={{
              padding:      "8px 10px",
              fontSize:     13,
              border:       "1px solid #e5e7eb",
              borderRadius: 6,
              background:   "#fff",
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
              招待リンクが発行されました
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                readOnly
                value={newInviteUrl}
                style={{
                  flex:         1,
                  padding:      "6px 10px",
                  fontSize:     12,
                  border:       "1px solid #86efac",
                  borderRadius: 6,
                  background:   "#fff",
                  fontFamily:   "monospace",
                  color:        "#111827",
                }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0, fontSize: 12, padding: "6px 12px" }}
                onClick={async () => {
                  await navigator.clipboard.writeText(newInviteUrl);
                  showToast(TOAST.linkCopied, "success");
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

      {/* ── 招待一覧 ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>

        {/* カードヘッダー（件数表示） */}
        <div style={{
          padding:      "14px 20px",
          borderBottom: "1px solid #e5e7eb",
          display:      "flex",
          alignItems:   "center",
          gap:          10,
          flexWrap:     "wrap",
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>招待一覧</h3>
          {invitations.length > 0 && (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              有効 {pendingCount} / 期限切れ {expiredCount} / 受諾済み {acceptedCount}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          /* ── 空状態 ── */
          <div style={{ padding: "48px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✉️</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 6 }}>
              まだ招待はありません
            </p>
            <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>
              メンバーを招待すると、ここに一覧で表示されます
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              メンバーを招待
            </button>
          </div>
        ) : (
          <>
            <InvitationTableHeader />
            {sorted.map((inv, idx) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                isLast={idx === sorted.length - 1}
                isCopied={copiedId === inv.id}
                onCopy={(url) => handleCopyLink(inv.id, url)}
                onRevoke={() => handleRevoke(inv)}
                onReissue={() => handleReissue(inv)}
                showToast={showToast}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── テーブルヘッダー（招待一覧共通） ─────────────────────────────────

function InvitationTableHeader() {
  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: "minmax(0,1fr) 88px 92px 90px auto",
      gap:                 8,
      padding:             "8px 20px",
      background:          "#f9fafb",
      borderBottom:        "1px solid #e5e7eb",
      fontSize:            11,
      fontWeight:          700,
      color:               "#9ca3af",
      textTransform:       "uppercase",
      letterSpacing:       "0.06em",
    }}>
      <span>メールアドレス</span>
      <span>権限</span>
      <span>ステータス</span>
      <span>有効期限</span>
      <span />
    </div>
  );
}

// ── 招待行コンポーネント ──────────────────────────────────────────────

function InvitationRow({
  invitation: inv,
  isLast,
  isCopied   = false,
  onCopy,
  onRevoke,
  onReissue,
  showToast: _showToast,
}: {
  invitation: Invitation;
  isLast:     boolean;
  isCopied?:  boolean;
  onCopy?:    (url: string) => void;
  onRevoke?:  () => void;
  onReissue?: () => void;
  showToast:  (msg: string, type: "success" | "error") => void;
}) {
  const expiresStr = new Date(inv.expires_at).toLocaleDateString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inv.token}`;

  const statusKey: keyof typeof INVITATION_STATUS_STYLES =
    inv.is_accepted ? "accepted" : inv.is_expired ? "expired" : "pending";

  const isPending  = !inv.is_expired && !inv.is_accepted;
  const isExpired  =  inv.is_expired && !inv.is_accepted;
  // is_accepted → 操作なし

  return (
    <div style={{
      display:             "grid",
      gridTemplateColumns: "minmax(0,1fr) 88px 92px 90px auto",
      gap:                 8,
      padding:             "12px 20px",
      borderBottom:        isLast ? "none" : "1px solid #f3f4f6",
      alignItems:          "center",
      opacity:             inv.is_accepted ? 0.5 : 1,
    }}>

      {/* メールアドレス */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize:     13,
          fontWeight:   600,
          color:        "#111827",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {inv.email}
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontFamily: "monospace" }}>
          {inv.id.slice(0, 8)}…
        </div>
      </div>

      {/* 権限バッジ */}
      <div><RoleBadge role={inv.role as Role} /></div>

      {/* ステータスバッジ */}
      <div><InviteStatusBadge statusKey={statusKey} /></div>

      {/* 有効期限 */}
      <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
        {inv.is_accepted ? "—" : expiresStr}
      </div>

      {/* 操作 — pending: コピー+取り消し / expired: 再発行 / accepted: なし */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
        {isPending && onCopy && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              fontSize:   11,
              padding:    "4px 10px",
              minWidth:   90,
              color:      isCopied ? "#059669" : undefined,
              fontWeight: isCopied ? 700 : undefined,
              transition: "color .2s",
            }}
            onClick={() => onCopy(inviteUrl)}
          >
            {isCopied ? "コピー済み" : "リンクをコピー"}
          </button>
        )}
        {isPending && onRevoke && (
          <button
            type="button"
            className="btn btn-danger"
            style={{ fontSize: 11, padding: "4px 10px" }}
            onClick={onRevoke}
          >
            取り消し
          </button>
        )}
        {isExpired && onReissue && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: "4px 10px" }}
            onClick={onReissue}
          >
            再発行
          </button>
        )}
      </div>
    </div>
  );
}

// ── 取り消し確認モーダル ──────────────────────────────────────────────

function RevokeConfirmModal({
  email,
  revoking,
  onCancel,
  onConfirm,
}: {
  email:     string;
  revoking:  boolean;
  onCancel:  () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0,0,0,0.45)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        zIndex:          1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background:   "#fff",
        borderRadius: 12,
        padding:      "28px 32px",
        width:        380,
        maxWidth:     "90vw",
        boxShadow:    "0 20px 48px rgba(0,0,0,0.18)",
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#111827" }}>
          招待を取り消しますか？
        </h3>
        <p style={{ fontSize: 13, color: "#374151", marginBottom: 6, lineHeight: 1.65 }}>
          この招待リンクは無効になります。送信済みのリンクからは参加できなくなります。
        </p>
        <p style={{
          fontSize:    12,
          color:       "#9ca3af",
          marginBottom: 24,
          fontFamily:  "monospace",
          wordBreak:   "break-all",
        }}>
          {email}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={revoking}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={revoking}
          >
            {revoking ? "取り消し中..." : "取り消す"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 招待ステータスバッジ ──────────────────────────────────────────────

function InviteStatusBadge({
  statusKey,
}: {
  statusKey: keyof typeof INVITATION_STATUS_STYLES;
}) {
  const s     = INVITATION_STATUS_STYLES[statusKey];
  const label = INVITATION_STATE_LABELS[statusKey];
  return (
    <span style={{
      display:      "inline-block",
      padding:      "3px 10px",
      borderRadius: 99,
      fontSize:     11,
      fontWeight:   600,
      background:   s.bg,
      color:        s.color,
      border:       `1px solid ${s.border}`,
      whiteSpace:   "nowrap",
    }}>
      {label}
    </span>
  );
}

// ── メンバーステータスバッジ ──────────────────────────────────────────

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
