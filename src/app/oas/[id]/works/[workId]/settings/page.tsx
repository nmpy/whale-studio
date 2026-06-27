"use client";

// src/app/oas/[id]/works/[workId]/settings/page.tsx
//
// 作品設定ページ。現状はタブ「あいさつメッセージ」のみ（旧 messages の「共通設定」タブを移設）。
// 将来の設定項目を追加できるようタブ構造にしてある。
//   - データ: GET /api/works/[workId]（workApi.get）から welcome_message / follow_action / resume_enabled を取得。
//     messages bootstrap には依存しない。
//   - 権限: useWorkspaceRole の canEdit（owner/admin/editor 編集可・viewer 読み取り）を踏襲。
//   - 保存ロジック・API・DB/schema は不変（_WorkGreetingSettings 内で既存 workApi.update を使用）。

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { ViewerBanner } from "@/components/PermissionGuard";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { workApi, getDevToken } from "@/lib/api-client";
import WorkGreetingSettings from "./_WorkGreetingSettings";

type FollowAction = "auto_start" | "welcome_wait" | "none";
type SettingsTab = "greeting";

type Loaded = {
  title: string;
  welcome: string | null;
  followAction: FollowAction;
  resumeEnabled: boolean;
};

export default function WorkSettingsPage() {
  const params = useParams<{ id: string; workId: string }>();
  const oaId   = params.id;
  const workId = params.workId;
  const { role, canEdit } = useWorkspaceRole(oaId);

  const [activeTab, setActiveTab] = useState<SettingsTab>("greeting");
  const [data, setData]           = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const w = await workApi.get(getDevToken(), workId);
      setData({
        title:         w.title,
        welcome:       w.welcome_message ?? null,
        followAction:  (w.follow_action as FollowAction | undefined) ?? "auto_start",
        resumeEnabled: w.resume_enabled !== false,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "作品設定の読み込みに失敗しました");
    }
  }, [workId]);

  useEffect(() => { load(); }, [load]);

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(data ? [{ label: data.title, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "作品設定" },
    ]} />
  );

  // 将来タブ追加を見越した定義（現状は「あいさつメッセージ」のみ）。
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: "greeting", label: "あいさつメッセージ" },
  ];
  const tabStyle = (tab: SettingsTab): React.CSSProperties => ({
    padding: "10px 18px", fontSize: 13, fontWeight: 600,
    color: activeTab === tab ? "#06C755" : "#6b7280",
    background: "none", border: "none",
    borderBottom: activeTab === tab ? "2px solid #06C755" : "2px solid transparent",
    cursor: "pointer", whiteSpace: "nowrap",
  });

  if (loadError) {
    return (
      <>
        <div className="page-header"><div>{breadcrumb}<h2>作品設定</h2></div></div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>作品設定</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            作品全体に関わる設定を管理します
          </p>
        </div>
      </div>

      {/* タブバー（将来の設定項目を追加できる構造） */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", marginBottom: 20, gap: 0 }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" style={tabStyle(t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "greeting" && (
        data ? (
          <WorkGreetingSettings
            workId={workId}
            canEdit={canEdit}
            initialWelcome={data.welcome}
            initialFollowAction={data.followAction}
            initialResumeEnabled={data.resumeEnabled}
          />
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <div className="skeleton" style={{ width: 240, height: 16, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: "100%", height: 80 }} />
          </div>
        )
      )}
    </>
  );
}
