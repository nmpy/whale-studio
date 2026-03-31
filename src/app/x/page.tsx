'use client';

// /x — X分析ツール ダッシュボード
//
// レンダリング戦略:
//   ① 固定データ (profile)   → 即時表示（ローディングなし）
//   ② 手動更新データ (stats) → 即時表示（ローディングなし）
//   ③ 将来自動化データ       → 非同期ローディング（スケルトン表示）

import { useEffect, useState } from 'react';
import { getProfile, getManualStats, getAutoData } from '@/lib/services/x-data';
import type { XDashboardData } from '@/lib/types/x';
import XAccountCard from '@/components/x-analytics/XAccountCard';
import StatsCards from '@/components/x-analytics/StatsCards';
import { FollowerChart, PostChart, LikeChart } from '@/components/x-analytics/Charts';
import PostList from '@/components/x-analytics/PostList';
import TopPosts from '@/components/x-analytics/TopPosts';

// ① ② は同期取得（モジュールロード時に確定）
const profile = getProfile();
const stats   = getManualStats();

export default function XPage() {
  // ③ 将来自動化データのみ非同期
  const [autoData, setAutoData] = useState<Pick<XDashboardData, 'followerHistory' | 'dailyEngagement' | 'posts'> | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);

  useEffect(() => {
    getAutoData()
      .then(setAutoData)
      .finally(() => setAutoLoading(false));
  }, []);

  return (
    <div className="xa-dashboard">
      {/* ページタイトル */}
      <div className="xa-page-header">
        <h1>X分析ツール</h1>
      </div>

      {/* ① 固定データ — プロフィールカード（即時表示） */}
      <XAccountCard profile={profile} isMock={false} />

      {/* ② 手動更新データ — KPI カード（即時表示） */}
      <StatsCards stats={stats} />

      {/* ③ 将来自動化データ — グラフ・投稿（非同期） */}
      {autoLoading ? (
        <AutoDataSkeleton />
      ) : autoData ? (
        <>
          <div className="xa-charts-grid">
            <FollowerChart data={autoData.followerHistory} />
            <PostChart     data={autoData.dailyEngagement} />
            <LikeChart     data={autoData.dailyEngagement} />
          </div>
          <div className="xa-bottom-grid">
            <TopPosts posts={autoData.posts} />
            <PostList posts={autoData.posts} />
          </div>
        </>
      ) : (
        <AutoDataEmpty />
      )}
    </div>
  );
}

// ── ③ データのスケルトン ──────────────────────────────────

function AutoDataSkeleton() {
  return (
    <>
      <div className="xa-charts-grid">
        {[1, 2, 3].map(i => (
          <div key={i} className="card xa-chart-card">
            <div className="skeleton" style={{ width: '40%', height: 14, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: '100%', height: 220, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="xa-bottom-grid">
        {[1, 2].map(i => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="skeleton" style={{ width: '40%', height: 14, marginBottom: 16 }} />
            {[1, 2, 3].map(j => (
              <div key={j} className="skeleton" style={{ width: '100%', height: 52, marginBottom: 8 }} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function AutoDataEmpty() {
  return (
    <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
      <p style={{ fontWeight: 600 }}>グラフ・投稿データがありません</p>
      <p style={{ fontSize: 12, marginTop: 4 }}>
        X アーカイブをインポートするとデータが表示されます
      </p>
    </div>
  );
}
