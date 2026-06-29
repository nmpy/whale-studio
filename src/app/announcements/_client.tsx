"use client";

// src/app/announcements/_client.tsx
// お知らせ一覧（ログインユーザー向け閲覧）。GET /api/announcements（公開済み・新しい日付順）を全件表示。
// 取得失敗・空でもページ全体は落とさず空状態を表示する。

import { useEffect, useState } from "react";
import { TLink as Link } from "@/components/TLink";
import { getAuthHeaders } from "@/lib/api-client";

type ApiAnnouncement = {
  id:           string;
  type:         string;
  title:        string;
  body:         string;
  important:    boolean;
  published_at: string | null;
  created_at:   string;
};

export function AnnouncementsListClient() {
  const [items,  setItems]  = useState<ApiAnnouncement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/announcements", { headers: { ...getAuthHeaders() } })
      .then((r) => (r.ok ? (r.json() as Promise<{ data: ApiAnnouncement[] }>) : null))
      .then((j) => {
        if (j && Array.isArray(j.data)) setItems(j.data);
      })
      .catch(() => { /* 失敗時は空状態 */ })
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
      {/* 見出し + 戻る導線 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary, #1a1a1a)", margin: 0 }}>
          お知らせ
        </h1>
        <Link href="/oas" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary, #2F6F5E)", textDecoration: "none", whiteSpace: "nowrap" }}>
          ← アカウント一覧に戻る
        </Link>
      </div>

      {!loaded ? null : items.length === 0 ? (
        <div style={{
          background: "#fff", border: "1px solid var(--color-border-default, #e5e5e5)", borderRadius: 10,
          padding: "40px 20px", textAlign: "center",
        }}>
          <p style={{ fontSize: 14, color: "var(--color-text-muted, #666)", margin: 0 }}>
            現在公開中のお知らせはありません。
          </p>
        </div>
      ) : (
        <div style={{
          background: "#fff", border: "1px solid var(--color-border-default, #e5e5e5)", borderRadius: 10, overflow: "hidden",
        }}>
          {items.map((a, i) => (
            <article
              key={a.id}
              style={{ padding: "16px 20px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-soft, #f0f0f0)" }}
            >
              <div style={{ fontSize: 11, color: "var(--color-text-muted, #999)", marginBottom: 4 }}>
                {(a.published_at ?? a.created_at).slice(0, 10)}
              </div>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary, #1a1a1a)", margin: "0 0 6px" }}>
                {a.title}
              </h2>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary, #444)", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
                {a.body}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
