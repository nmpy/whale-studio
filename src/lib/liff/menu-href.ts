// src/lib/liff/menu-href.ts
//
// 作品メニューホーム (/liff/w/[workPublicId]) のカードから個別ページへ遷移するときの
// href を決める純関数。DOM / LIFF SDK 非依存でテストできる。
//
// なぜ page_type で分けるのか（LIFF 間遷移 = LIFF-to-LIFF）:
//   LIFF ブラウザで開いている最中に **LIFF URL (https://liff.line.me/{liffId}/...)** を開くと、
//   LINE は「LIFF 間遷移」として扱い、LIFF ブラウザを閉じずに遷移先を重ねて表示する。
//   このとき LINE ネイティブのヘッダーに戻るボタンが出るため、Web 側で独自の戻る導線を
//   持つ必要がなくなる（= HTML/CSS でネイティブ UI を模倣しない）。
//   条件（LINE 公式仕様）:
//     - LIFF SDK v2.4.1 以上（本プロジェクトは @line/liff ^2.28.0）
//     - **遷移元 LIFF の画面サイズが Full**（LINE Developers Console 側の設定）
//     - 遷移先で liff.init() 済み（/liff 配下は useWorkScopedLiff で必ず init する）
//   https://developers.line.biz/ja/docs/liff/opening-liff-app/
//
//   相対パス遷移（= エンドポイント URL への通常遷移）はこの扱いにならず、戻るボタンも出ない。
//   そのため「戻る導線が必要なページ」だけ LIFF URL に切り替える。
//
// 適用範囲を検索型ヒント (page_type="hint_search") に限定している理由:
//   他の page_type は「メニューから 1 枚開いて読む / 送信して閉じる」構成で、遷移元へ戻る
//   要求が出ていない。全 page_type を LIFF URL 化すると遷移の挙動（ドキュメントの再読込・
//   liff.referrer 付与）が既存ページにも及ぶため、必要な種別だけを対象にする。

import { buildLiffUrl } from "./config";
import { normalizeLiffPageType } from "@/types";

/** LIFF URL 経由で開く（= LINE ネイティブの戻るボタンを出す）page_type。 */
const LIFF_TO_LIFF_PAGE_TYPES = new Set<string>(["hint_search"]);

/** メニューホームのカードから個別ページへの相対パス。publicId が揃えば短縮ルート。 */
export function buildMenuPageRelativeHref(args: {
  workId:        string;
  workPublicId?: string | null;
  pageId:        string;
  pagePublicId?: string | null;
}): string {
  if (args.workPublicId && args.pagePublicId) {
    return `/liff/w/${args.workPublicId}/p/${args.pagePublicId}`;
  }
  return `/liff/work/${args.workId}/pages/${args.pageId}`;
}

/**
 * メニューホームのカードの href。
 *
 * - LINE アプリ内（LIFF ブラウザ）で、対象が LIFF 間遷移の対象 page_type で、liffId が
 *   解決できているときだけ LIFF URL を返す。
 * - それ以外（LINE 外ブラウザ / 実機確認用 URL / CMS プレビュー / liffId 未解決）は従来の
 *   相対パス。外部ブラウザで liff.line.me を開くと LINE ログインへリダイレクトされ、
 *   「ブラウザで確認」導線が壊れるため、isInClient が false のときは使わない。
 */
export function buildMenuPageHref(args: {
  pageType?:     string | null;
  workId:        string;
  workPublicId?: string | null;
  pageId:        string;
  pagePublicId?: string | null;
  /** /api/liff/config で解決した LIFF ID。未解決なら null。 */
  liffId?:       string | null;
  /** liff.isInClient()。LINE アプリ内かどうか。 */
  isInClient?:   boolean;
}): string {
  const relative = buildMenuPageRelativeHref(args);

  if (!args.isInClient) return relative;
  if (!LIFF_TO_LIFF_PAGE_TYPES.has(normalizeLiffPageType(args.pageType))) return relative;

  // Endpoint URL = `{origin}/liff` 前提。LIFF URL には `/liff` を除いた sub-path を付ける
  // （既存の「実機で確認」URL / チケット LIFF URL と同じ組み立て方）。
  const liffUrl = buildLiffUrl({
    liffId: args.liffId,
    path:   relative.replace(/^\/liff/, ""),
  });
  return liffUrl ?? relative;
}
