"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, getDevToken, type OaListItem } from "@/lib/api-client";

export default function LandingPage() {
  const [recents, setRecents] = useState<OaListItem[]>([]);

  useEffect(() => {
    oaApi.list(getDevToken(), { page: 1, limit: 3 })
      .then((r) => setRecents(r.data))
      .catch(() => {});
  }, []);

  return (
    <div className="landing-root">
      <div className="landing-hero">
        <div className="landing-wordmark">
          <span className="landing-brand">WHALE STUDIO</span>
        </div>
        <span className="landing-subtitle">LINEでつくる物語体験 β版</span>
        <Link href="/oas" className="btn btn-primary landing-cta">
          体験をつくる
        </Link>
      </div>

      {recents.length > 0 && (
        <div className="landing-recents">
          <span className="landing-recents-label">最近使ったアカウント</span>
          <div className="landing-recents-list">
            {recents.map((oa) => (
              <Link key={oa.id} href={`/oas/${oa.id}/works`} className="landing-recent-chip">
                {oa.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
