import { redirect } from "next/navigation";

/**
 * /nazotoki → 謎解きBot セクションのエントリー
 * OA 一覧（/oas）にリダイレクト
 */
export default function NazotokiPage() {
  redirect("/oas");
}
