// src/lib/is-edit-screen.ts
//
// 管理画面の「編集（フォーム）画面」かどうかを pathname で判定する純関数。
// 非編集（閲覧・管理・一覧・ハブ）画面でのみ「アカウント設定」への共通導線を出すために使う
// （AppShell から利用）。pure・依存なしなので単体テスト可能。
//
// 判定ルール（将来の編集画面追加にも破綻しにくいよう、規約ベースで判定する）:
//   1. 末尾セグメントが new / edit / create のページ → 編集
//   2. コレクション配下の個別詳細/編集ページ（collection/[id]）→ 編集
//      collection: messages / characters / liff / locations / riddles /
//                  global-commands / transitions
//   ※ works/[workId]（作品ハブ）は「一覧/ハブ」であり非編集なので、collection に works を含めない。

const EDIT_TAIL = /\/(new|edit|create)\/?$/;
const EDIT_DETAIL =
  /\/(messages|characters|liff|locations|riddles|global-commands|transitions)\/[^/]+\/?$/;

/** 編集（フォーム）画面なら true。null/未マッチは false（= 非編集として扱う）。 */
export function isEditScreen(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (EDIT_TAIL.test(pathname)) return true;
  if (EDIT_DETAIL.test(pathname)) return true;
  return false;
}
