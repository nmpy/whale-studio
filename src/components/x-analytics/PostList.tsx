'use client';

import { useState } from 'react';
import type { XPost, PostSortKey } from '@/lib/types/x';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const SORT_OPTIONS: { key: PostSortKey; label: string }[] = [
  { key: 'latest',  label: '新着順'    },
  { key: 'likes',   label: 'いいね順'  },
  { key: 'reposts', label: 'リポスト順' },
  { key: 'replies', label: '返信順'    },
];

function sortPosts(posts: XPost[], key: PostSortKey): XPost[] {
  const sorted = [...posts];
  switch (key) {
    case 'latest':  return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'likes':   return sorted.sort((a, b) => b.likeCount   - a.likeCount);
    case 'reposts': return sorted.sort((a, b) => b.repostCount - a.repostCount);
    case 'replies': return sorted.sort((a, b) => b.replyCount  - a.replyCount);
  }
}

export default function PostList({ posts }: { posts: XPost[] }) {
  const [sortKey, setSortKey] = useState<PostSortKey>('latest');
  const sorted = sortPosts(posts, sortKey);

  return (
    <div className="card xa-post-list">
      <div className="xa-post-list-header">
        <div>
          <h3 className="xa-chart-title" style={{ marginBottom: 2 }}>投稿一覧</h3>
          <div className="xa-chart-badge">③ 将来自動化データ（現在モック）</div>
        </div>
        <div className="xa-sort-buttons">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`xa-sort-btn ${sortKey === opt.key ? 'active' : ''}`}
              onClick={() => setSortKey(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="xa-post-items">
        {sorted.map(post => (
          <div key={post.id} className="xa-post-item">
            <div className="xa-post-meta">{formatDateTime(post.createdAt)}</div>
            <div className="xa-post-text">{post.text}</div>
            <div className="xa-post-metrics">
              <span title="いいね">♡ {post.likeCount}</span>
              <span title="リポスト">↺ {post.repostCount}</span>
              <span title="返信">✉ {post.replyCount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
