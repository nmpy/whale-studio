"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Section = "nazotoki" | "x";

function useSection(): Section {
  const pathname = usePathname();
  if (
    pathname.startsWith("/nazotoki") ||
    pathname.startsWith("/oas") ||
    pathname.startsWith("/playground")
  ) {
    return "nazotoki";
  }
  return "x";
}

export default function AppHeader() {
  const section   = useSection();
  const title     = section === "nazotoki" ? "LINE謎解きbot" : "X分析ツール";
  const titleHref = section === "nazotoki" ? "/nazotoki" : "/x";

  return (
    <header>
      <div className="container">
        {/* ロゴ */}
        <h1>
          <a href={titleHref}>{title}</a>
        </h1>

        {/* セパレーター */}
        <span className="app-header-sep" />

        {/* セクション切り替えナビ */}
        <nav className="app-nav">
          <Link
            href="/nazotoki"
            className={`app-nav-item${section === "nazotoki" ? " active" : ""}`}
          >
            謎解きBot
          </Link>
          <Link
            href="/x"
            className={`app-nav-item${section === "x" ? " active" : ""}`}
          >
            X分析ツール
          </Link>
        </nav>
      </div>
    </header>
  );
}
