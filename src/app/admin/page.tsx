"use client";

// src/app/admin/page.tsx
// /admin → /admin/announcements へリダイレクト

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminIndexPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/announcements"); }, [router]);
  return null;
}
