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
import { StatusBadge, Button, Accordion, buttonClass } from "@/components/shared";
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

// ── shared StatusBadge への tone マッピング ────────────────────────────
// Phase 2.2a の方針 (= ユーザー指示):
//   member  active    → active (= brand 外周リング dot)
//   member  inactive  → muted  (= グレー)
//   member  suspended → warn   (= 控えめなくすみ橙)
//   invite  pending   → active (= 有効ステータス)
//   invite  expired   → warn
//   invite  accepted  → muted
function memberStatusTone(status: string): "active" | "muted" | "warn" {
  if (status === "suspended") return "warn";
  if (status === "active")    return "active";
  return "muted"; // inactive / unknown
}
function invitationStatusTone(key: "pending" | "expired" | "accepted"): "active" | "muted" | "warn" {
  if (key === "pending") return "active";
  if (key === "expired") return "warn";
  return "muted"; // accepted
}

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
      <div className="rounded-card border border-line bg-surface p-12 text-center shadow-sm">
        <div aria-hidden="true" className="text-[40px] leading-none">🔒</div>
        <p className="mt-3 text-[16px] font-bold text-ink">アクセス権限がありません</p>
        <p className="mt-1 text-[13px] text-ink-2">
          メンバー管理は admin / owner のみ利用できます
        </p>
        <Link
          href={`/oas/${oaId}/settings`}
          className={buttonClass({ variant: "ghost", size: "md", className: "mt-5" })}
        >
          設定に戻る
        </Link>
      </div>
    );
  }

  const pendingInvitationsCount = invitations.filter((i) => !i.is_expired && !i.is_accepted).length;

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-5">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "設定", href: `/oas/${oaId}/settings` },
          { label: "メンバー管理" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          メンバー管理
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          ワークスペースメンバーのロール・ステータスを管理します
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {errorMsg}
        </div>
      )}

      {/* ── タブ ── */}
      <div
        role="tablist"
        aria-label="メンバー管理セクション"
        className="mb-5 flex gap-0 border-b border-line"
      >
        {(["members", "invitations"] as Section[]).map((s) => {
          const isActive = section === s;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSection(s)}
              className={
                "-mb-px flex items-center gap-1.5 border-b-2 px-5 py-2.5 text-[13px] transition-colors " +
                (isActive
                  ? "border-brand font-bold text-ink"
                  : "border-transparent font-medium text-ink-3 hover:text-ink-2")
              }
            >
              <span>
                {s === "members"
                  ? `メンバー（${members.length}）${provisional.length > 0 ? ` + 未登録 ${provisional.length}` : ""}`
                  : `✉️ 招待`}
              </span>
              {s === "invitations" && pendingInvitationsCount > 0 && (
                // ※ status ではなく件数通知バッジ。<StatusBadge> には統一せず独自小バッジを維持 (= ユーザー指示)
                <span
                  aria-label={`有効な招待 ${pendingInvitationsCount} 件`}
                  className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-sky-soft px-1.5 py-0.5 text-[11px] font-bold text-sky-ink"
                >
                  {pendingInvitationsCount}
                </span>
              )}
            </button>
          );
        })}
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
    // owner の role 変更は強い確認
    const msg = m.role === "owner" && newRole !== "owner"
      ? CONFIRM.ownerRoleChange(name, ROLE_LABELS[newRole])
      : CONFIRM.roleChange(name, ROLE_LABELS[newRole]);
    if (!confirm(msg)) return;
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
    const label = STATUS_LABELS[newStatus] ?? newStatus;
    if (newStatus === "suspended") {
      if (!confirm(CONFIRM.suspend(name))) return;
    } else if (m.role === "owner" && newStatus !== "active") {
      // owner の停止は強い確認
      if (!confirm(CONFIRM.ownerStatusChange(name, label))) return;
    } else {
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
    // owner の削除は強い確認
    const msg = m.role === "owner"
      ? CONFIRM.deleteOwner(name)
      : CONFIRM.deleteMember(name);
    if (!confirm(msg)) return;
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
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="skeleton mb-1.5" style={{ width: "45%", height: 14, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: "30%", height: 11, borderRadius: 4 }} />
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                <div className="skeleton" style={{ width: 100, height: 28, borderRadius: 6 }} />
                <div className="skeleton" style={{ width: 100, height: 28, borderRadius: 6 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (members.length === 0 && provisional.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-12 text-center shadow-sm">
        <p className="text-[14px] font-bold text-ink">メンバーがいません</p>
        <p className="mt-2 text-[12px] text-ink-3">
          招待を送るか、アプリにアクセスしたユーザーが自動的にここに表示されます。
        </p>
      </div>
    );
  }

  // 行内 select の共通 className (= 小型 / border-line / focus 時 brand ring)
  // ※ globals.css の input/select は padding=10px/13px が既定なので、ここで size-sm 用に上書き
  const selectClass =
    "w-full cursor-pointer rounded-md border border-line bg-surface px-2 py-1 " +
    "text-[12px] text-ink transition-shadow focus:border-brand focus:outline-none " +
    "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
    "disabled:text-ink-3 disabled:opacity-70";

  return (
    <div className="flex flex-col gap-5">

    {/* ── 正式メンバー一覧 ── */}
    {members.length > 0 && (
      <div className="flex flex-col gap-3">
        {members.map((m) => {
          const modifiable  = canModify(m);
          const isSelf      = isMe(m);
          const isLastOwn   = isLastOwner(m);
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
          const statusDisabled = isSelf || isLastOwn;
          const statusTitle    = isSelf     ? TOOLTIP.selfStatusChange
                               : isLastOwn  ? TOOLTIP.lastOwnerStatusChange
                               : undefined;

          // ── 削除ボタンの無効化理由 ────────────────────────────────
          const deleteDisabled = isSelf || isLastOwn;
          const deleteTitle    = isSelf    ? TOOLTIP.selfDelete
                               : isLastOwn ? TOOLTIP.lastOwnerDelete
                               : TOOLTIP.deleteButton;

          return (
            <article
              key={m.id}
              className={
                "rounded-card border bg-surface p-4 shadow-sm sm:p-5 " +
                (isSelf ? "border-brand/30 bg-brand-mist" : "border-line")
              }
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

                {/* ── 左: ユーザー情報 ── */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.email ? (
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold text-ink">
                        {m.email}
                      </span>
                    ) : (
                      <span className="font-mono text-[12px] text-ink-3">
                        {m.user_id.slice(0, 20)}…
                      </span>
                    )}
                    {isSelf && (
                      <span className="flex-shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand-ink">
                        自分
                      </span>
                    )}
                  </div>
                  {m.email && (
                    <div className="mt-0.5 font-mono text-[10px] text-ink-3">
                      {m.user_id.slice(0, 16)}…
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-ink-3">
                    参加日: <span className="font-num text-ink-2">{joinedDate}</span>
                  </div>
                </div>

                {/* ── 右: コントロール (role / status / 削除) ── */}
                <div className="flex flex-col gap-2.5 sm:w-[180px] sm:flex-shrink-0">

                  {/* ロール */}
                  <div>
                    <label
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3"
                      htmlFor={`role-${m.id}`}
                    >
                      ロール
                    </label>
                    {modifiable ? (
                      <select
                        id={`role-${m.id}`}
                        value={m.role}
                        disabled={roleDisabled}
                        title={roleTitle}
                        onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                        className={selectClass}
                      >
                        {ROLES.filter((r) =>
                          // admin は owner ロールを付与不可
                          isOwner ? true : r !== "owner"
                        ).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <div><RoleBadge role={m.role as Role} /></div>
                    )}
                  </div>

                  {/* ステータス */}
                  <div>
                    <label
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3"
                      htmlFor={`status-${m.id}`}
                    >
                      ステータス
                    </label>
                    {modifiable ? (
                      <select
                        id={`status-${m.id}`}
                        value={m.status}
                        disabled={statusDisabled}
                        title={statusTitle}
                        onChange={(e) => handleStatusChange(m, e.target.value)}
                        className={selectClass}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <div>
                        <StatusBadge tone={memberStatusTone(m.status)}>
                          {STATUS_LABELS[m.status] ?? m.status}
                        </StatusBadge>
                      </div>
                    )}
                  </div>

                  {/* 削除 (admin / owner に表示。admin は owner 行を操作不可) */}
                  {modifiable && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      fullWidth
                      disabled={deleteDisabled}
                      title={deleteTitle}
                      onClick={() => !deleteDisabled && handleDelete(m)}
                    >
                      削除
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {/* ── ロール権限の説明 (= shared/Accordion defaultOpen=false) ── */}
        <Accordion
          title="ロール権限の説明"
          summary={`${ROLES.length}種類のロールと操作範囲`}
          defaultOpen={false}
          helpTone
        >
          <div className="flex flex-col gap-2.5">
            {ROLES.map((r) => (
              <div key={r} className="flex items-start gap-2.5">
                <div className="flex-shrink-0"><RoleBadge role={r} /></div>
                <span className="pt-0.5 text-[12px] leading-[1.45] text-ink-2">
                  {ROLE_DESCRIPTIONS[r]}
                </span>
              </div>
            ))}
          </div>
        </Accordion>
      </div>
    )}

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

    </div>
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
    <section className="flex flex-col gap-3">
      {/* ヘッダー (warn-soft) */}
      <div
        role="status"
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-field border border-warn/30 bg-warn-soft px-4 py-2.5"
      >
        <span className="text-[13px] font-bold text-warn">
          未登録ユーザー（{provisional.length}件）
        </span>
        <span className="text-[11px] text-warn/85">
          最近アプリを操作したユーザーです。ロールを設定すると正式メンバーに登録されます。
        </span>
      </div>

      {/* 未登録ユーザー カード一覧 */}
      <div className="flex flex-col gap-3">
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
    </section>
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

  const provisionalSelectClass =
    "w-full cursor-pointer rounded-md border border-line bg-surface px-2 py-1 " +
    "text-[12px] text-ink transition-shadow focus:border-brand focus:outline-none " +
    "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
    "disabled:text-ink-3 disabled:opacity-70";

  return (
    <article className="rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

        {/* ── 左: ユーザー情報 ── */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {user.email ? (
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold text-ink">
                {user.email}
              </span>
            ) : (
              <span className="font-mono text-[12px] text-ink-3">
                {user.user_id.slice(0, 20)}…
              </span>
            )}
            {/* 未登録バッジ — warn 系の控えめなバッジで残す */}
            <span className="flex-shrink-0 rounded-full border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">
              未登録
            </span>
          </div>
          {user.email && (
            <div className="mt-0.5 font-mono text-[10px] text-ink-3">
              {user.user_id.slice(0, 16)}…
            </div>
          )}
          <div className="mt-2 text-[11px] text-ink-3">
            最終操作: <span className="font-num text-ink-2">{lastSeen}</span>
          </div>
        </div>

        {/* ── 右: ロール付与 ── */}
        <div className="flex flex-col gap-2.5 sm:w-[200px] sm:flex-shrink-0">
          {canManage ? (
            <>
              <div>
                <label
                  className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3"
                  htmlFor={`prov-role-${user.user_id}`}
                >
                  付与するロール
                </label>
                <select
                  id={`prov-role-${user.user_id}`}
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as Role)}
                  disabled={registering}
                  className={provisionalSelectClass}
                >
                  {ROLES.filter((r) => isOwner ? true : r !== "owner").map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                fullWidth
                disabled={registering}
                onClick={handleClick}
              >
                {registering ? "…" : "登録"}
              </Button>
            </>
          ) : (
            <span className="inline-flex items-center justify-center rounded-full border border-line bg-bg-tint px-2 py-1 text-[11px] font-bold text-ink-3">
              閲覧者（未登録）
            </span>
          )}
        </div>
      </div>
    </article>
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

  // フォーム要素 (input/select) 共通の小型 className (= globals.css の入力デフォルトより compact)
  const compactInputClass =
    "w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
    "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
    "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
    "disabled:text-ink-3";

  return (
    <div className="flex flex-col gap-5">

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
      <div
        ref={formCardRef}
        className="rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6"
      >
        <h3 className="font-round text-[14px] font-bold text-ink">メンバーを招待</h3>
        <p className="mt-1 mb-4 text-[12px] leading-[1.6] text-ink-2">
          メールアドレスを入力すると招待リンクが発行されます。リンクを相手に送ってください。
        </p>

        <form onSubmit={handleInvite} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
          <input
            type="email"
            placeholder="招待するメールアドレス"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            aria-label="招待するメールアドレス"
            className={compactInputClass + " sm:min-w-[220px] sm:flex-1"}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            aria-label="付与するロール"
            className={compactInputClass + " cursor-pointer sm:w-auto sm:flex-shrink-0"}
          >
            {ROLES.filter((r) => isOwner ? true : r !== "owner").map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={inviting || !inviteEmail.trim()}
            className="sm:flex-shrink-0"
          >
            {inviting ? "生成中..." : "招待リンクを発行"}
          </Button>
        </form>

        {/* 生成済み招待リンク (= ブランドトーン) */}
        {newInviteUrl && (
          <div
            role="status"
            className="mt-4 rounded-field border border-brand/30 bg-brand-soft px-3.5 py-3"
          >
            <p className="mb-2 text-[12px] font-bold text-brand-ink">
              招待リンクが発行されました
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={newInviteUrl}
                onFocus={(e) => e.target.select()}
                aria-label="生成された招待リンク"
                className="w-full flex-1 rounded-md border border-brand/30 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="sm:flex-shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(newInviteUrl);
                  showToast(TOAST.linkCopied, "success");
                }}
              >
                コピー
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-[1.5] text-brand-ink/85">
              有効期限は 7日間です。期限切れの場合は再発行してください。
            </p>
          </div>
        )}
      </div>

      {/* ── 招待一覧 ── */}
      <section className="flex flex-col gap-3">
        {/* セクション見出し + 件数表示 */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h3 className="font-round text-[14px] font-bold text-ink">招待一覧</h3>
          {invitations.length > 0 && (
            <span className="text-[12px] text-ink-3">
              有効 {pendingCount} / 期限切れ {expiredCount} / 受諾済み {acceptedCount}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="skeleton mb-1.5" style={{ width: "55%", height: 14, borderRadius: 4 }} />
                    <div className="skeleton" style={{ width: "30%", height: 11, borderRadius: 4 }} />
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                    <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 999 }} />
                    <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 999 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          /* ── 空状態 ── */
          <div className="rounded-card border border-line bg-surface px-5 py-12 text-center shadow-sm">
            <div aria-hidden="true" className="text-[36px] leading-none">✉️</div>
            <p className="mt-3 text-[14px] font-bold text-ink">まだ招待はありません</p>
            <p className="mx-auto mt-1.5 max-w-[340px] text-[13px] leading-[1.7] text-ink-3">
              メンバーを招待すると、ここに一覧で表示されます
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              className="mt-5"
              onClick={() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              メンバーを招待
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((inv) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                isCopied={copiedId === inv.id}
                onCopy={(url) => handleCopyLink(inv.id, url)}
                onRevoke={() => handleRevoke(inv)}
                onReissue={() => handleReissue(inv)}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── 招待行コンポーネント (= 1 招待 = 1 カード、Phase 2.2c でテーブル grid → card に再構成) ──

function InvitationRow({
  invitation: inv,
  isCopied   = false,
  onCopy,
  onRevoke,
  onReissue,
  showToast: _showToast,
}: {
  invitation: Invitation;
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
    <article
      className={
        "rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5 " +
        (inv.is_accepted ? "opacity-60" : "")
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

        {/* ── 左: 招待情報 ── */}
        <div className="min-w-0 flex-1">
          {/* メールアドレス */}
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold text-ink">
            {inv.email}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-3">
            {inv.id.slice(0, 8)}…
          </div>

          {/* RoleBadge + StatusBadge */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RoleBadge role={inv.role as Role} />
            <StatusBadge tone={invitationStatusTone(statusKey)}>
              {INVITATION_STATE_LABELS[statusKey]}
            </StatusBadge>
          </div>

          {/* 有効期限 */}
          <div className="mt-2 text-[11px] text-ink-3">
            有効期限: <span className="font-num text-ink-2">{inv.is_accepted ? "—" : expiresStr}</span>
          </div>
        </div>

        {/* ── 右: 操作 — pending: コピー+取り消し / expired: 再発行 / accepted: なし ── */}
        {(isPending || isExpired) && (
          <div className="flex flex-col gap-2 sm:w-[160px] sm:flex-shrink-0">
            {isPending && onCopy && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth
                onClick={() => onCopy(inviteUrl)}
              >
                {isCopied ? "コピー済み" : "リンクをコピー"}
              </Button>
            )}
            {isPending && onRevoke && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                fullWidth
                onClick={onRevoke}
              >
                取り消し
              </Button>
            )}
            {isExpired && onReissue && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth
                onClick={onReissue}
              >
                再発行
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-modal-title"
      // overlay: z-index 1000 維持 (= 既存挙動)
      style={{ zIndex: 1000 }}
      className="fixed inset-0 flex items-center justify-center bg-ink/45 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-[420px] rounded-card border border-line bg-surface px-6 py-7 shadow-card sm:px-8 sm:py-8">
        <h3
          id="revoke-modal-title"
          className="font-round mb-3 text-[16px] font-bold text-ink"
        >
          招待を取り消しますか？
        </h3>
        <p className="mb-1.5 text-[13px] leading-[1.65] text-ink-2">
          この招待リンクは無効になります。送信済みのリンクからは参加できなくなります。
        </p>
        <p className="mb-6 break-all font-mono text-[12px] text-ink-3">
          {email}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onCancel}
            disabled={revoking}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={onConfirm}
            disabled={revoking}
          >
            {revoking ? "取り消し中..." : "取り消す"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 旧ローカル <InviteStatusBadge> / <StatusBadge> は Phase 2.2a で共通 <StatusBadge> に統合済
// (mapping は memberStatusTone / invitationStatusTone を参照)。
