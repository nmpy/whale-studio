'use client';

import type { XManualStats } from '@/lib/types/x';

function formatNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return n.toLocaleString();
}

function ChangeBadge({ value, label }: { value: number; label: string }) {
  const isPositive = value > 0;
  const isZero     = value === 0;
  return (
    <span className={`xa-change ${isPositive ? 'positive' : isZero ? '' : 'negative'}`}>
      {isPositive ? '+' : ''}{value.toLocaleString()} {label}
    </span>
  );
}

export default function StatsCards({ stats }: { stats: XManualStats }) {
  const cards = [
    {
      label: 'フォロワー',
      value: formatNum(stats.followersCount),
      sub: (
        <div className="xa-stat-sub">
          <ChangeBadge value={stats.followersDayChange}  label="前日比" />
          <ChangeBadge value={stats.followersWeekChange} label="7日間" />
        </div>
      ),
    },
    {
      label: '月間投稿数',
      value: stats.monthlyPostCount.toLocaleString(),
      sub: <span className="xa-stat-desc">今月の投稿</span>,
    },
    {
      label: '月間いいね合計',
      value: formatNum(stats.monthlyLikeTotal),
      sub: <span className="xa-stat-desc">今月のいいね総数</span>,
    },
    {
      label: 'フォロー中',
      value: formatNum(stats.followingCount),
      sub: <span className="xa-stat-desc">{stats.totalPostCount.toLocaleString()} ポスト</span>,
    },
  ];

  return (
    <div>
      <div className="xa-stats-grid">
        {cards.map((c) => (
          <div key={c.label} className="card xa-stat-card">
            <div className="xa-stat-label">{c.label}</div>
            <div className="xa-stat-value">{c.value}</div>
            {c.sub}
          </div>
        ))}
      </div>
      {/* 手動更新日の表示 */}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 6, marginBottom: 20 }}>
        ② 手動更新データ — 最終更新: {stats.updatedAt}
      </p>
    </div>
  );
}
