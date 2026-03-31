'use client';

import type { XPost } from '@/lib/types/x';

export default function TopPosts({ posts }: { posts: XPost[] }) {
  const top5 = [...posts].sort((a, b) => b.likeCount - a.likeCount).slice(0, 5);

  return (
    <div className="card xa-top-posts">
      <h3 className="xa-chart-title" style={{ marginBottom: 2 }}>伸びた投稿ランキング</h3>
      <div className="xa-chart-badge" style={{ marginBottom: 12 }}>③ 将来自動化データ（現在モック）</div>
      <ol className="xa-ranking-list">
        {top5.map((post, i) => (
          <li key={post.id} className="xa-ranking-item">
            <span className={`xa-rank-badge rank-${i + 1}`}>{i + 1}</span>
            <div className="xa-ranking-body">
              <div className="xa-post-text">{post.text}</div>
              <div className="xa-post-metrics">
                <span>♡ {post.likeCount}</span>
                <span>↺ {post.repostCount}</span>
                <span>✉ {post.replyCount}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
