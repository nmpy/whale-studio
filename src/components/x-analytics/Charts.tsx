'use client';

import {
  ResponsiveContainer, LineChart, Line,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import type { XFollowerPoint, XDailyEngagement } from '@/lib/types/x';

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function FollowerChart({ data }: { data: XFollowerPoint[] }) {
  const formatted = data.map(d => ({ ...d, label: formatDate(d.date) }));
  return (
    <div className="card xa-chart-card">
      <h3 className="xa-chart-title">フォロワー数推移</h3>
      <div className="xa-chart-badge">③ 将来自動化データ（現在モック）</div>
      <div className="xa-chart-body">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={['dataMin - 10', 'dataMax + 10']} />
            <Tooltip />
            <Line type="monotone" dataKey="followers" stroke="#1d9bf0" strokeWidth={2} dot={false} name="フォロワー" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PostChart({ data }: { data: XDailyEngagement[] }) {
  const formatted = data.map(d => ({ ...d, label: formatDate(d.date) }));
  return (
    <div className="card xa-chart-card">
      <h3 className="xa-chart-title">日別投稿数</h3>
      <div className="xa-chart-badge">③ 将来自動化データ（現在モック）</div>
      <div className="xa-chart-body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="posts" fill="#1d9bf0" radius={[4, 4, 0, 0]} name="投稿数" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function LikeChart({ data }: { data: XDailyEngagement[] }) {
  const formatted = data.map(d => ({ ...d, label: formatDate(d.date) }));
  return (
    <div className="card xa-chart-card">
      <h3 className="xa-chart-title">日別いいね数</h3>
      <div className="xa-chart-badge">③ 将来自動化データ（現在モック）</div>
      <div className="xa-chart-body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="likes" fill="#f91880" radius={[4, 4, 0, 0]} name="いいね" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
