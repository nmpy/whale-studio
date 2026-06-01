// src/app/admin/documents/page.tsx
//
// ドキュメント管理 (= PDF アップロード機能) はスタジオ管理から除外したため、
// 旧 URL の互換性維持のために /admin に恒久リダイレクトする。
// 既存ブックマーク等が 404 にならないようにするのが目的。

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminDocumentsPage() {
  redirect("/admin");
}
