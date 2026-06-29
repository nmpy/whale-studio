// src/app/announcements/page.tsx
// ログインユーザー向けのお知らせ一覧ページ。
// /oas の AnnouncementBanner の「もっとみる」遷移先。公開済みお知らせを新しい日付順で全件表示する。
// ログイン必須（middleware の PROTECTED_PREFIXES に /announcements を追加済み）。

import { AnnouncementsListClient } from "./_client";

export const dynamic = "force-dynamic";

export default function AnnouncementsPage() {
  return <AnnouncementsListClient />;
}
