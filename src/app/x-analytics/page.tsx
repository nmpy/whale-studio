// /x-analytics → /x にリダイレクト（後方互換）
import { redirect } from "next/navigation";

export default function XAnalyticsLegacyPage() {
  redirect("/x");
}
