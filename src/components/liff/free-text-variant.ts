// src/components/liff/free-text-variant.ts
// PR-BLK4e: フリーテキスト（free_text ブロック）の表示スタイル解決（純関数・no JSX → node テスト可）。
//
// settings.variant から「実際に描画するスタイル」を返す。
//   - "sub"               → "sub"（小さめ・控えめな補足テキスト）
//   - undefined / 不明値   → "body"（既存の本文表示）
// 副作用なし。window/document/prisma/fetch 等に依存しない。

export type FreeTextVariant = "body" | "sub";

export function resolveFreeTextVariant(variant: string | undefined): FreeTextVariant {
  return variant === "sub" ? "sub" : "body";
}
