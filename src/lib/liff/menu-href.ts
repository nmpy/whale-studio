// src/lib/liff/menu-href.ts
//
// 作品メニューホーム (/liff/w/[workPublicId]) のカードから個別ページへ遷移するときの
// href を決める純関数。DOM / LIFF SDK 非依存でテストできる。
//
// なぜ page_type で分けるのか（LIFF 間遷移 = LIFF-to-LIFF）:
//   LIFF ブラウザで開いている最中に **LIFF URL (https://liff.line.me/{liffId}/...)** を開くと、
//   LINE は「LIFF 間遷移」として扱い、LIFF ブラウザを閉じずに遷移先を重ねて表示する。
//   このとき LINE ネイティブのヘッダーに戻るボタンが出るため、元の画面へ戻れる。
//   条件（LINE 公式仕様）:
//     - LIFF SDK v2.4.1 以上（本プロジェクトは @line/liff ^2.28.0）
//     - 遷移元 LIFF の画面サイズが Full（LINE Developers Console 側の設定）
//     - 遷移先で liff.init() 済み（/liff 配下は useWorkScopedLiff で必ず init する）
//   https://developers.line.biz/ja/docs/liff/opening-liff-app/
//
//   相対パス遷移（= エンドポイント URL への通常遷移）はこの扱いにならず、戻るボタンも出ない。
//   そのため「戻る導線が要るページ」だけ LIFF URL に切り替える。
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
 * LIFF URL を返すのは **次をすべて満たすときだけ**:
 *   1. LINE アプリ内（LIFF ブラウザ）である
 *      → 外部ブラウザで liff.line.me を開くと LINE ログインへ飛ばされ、
 *        「ブラウザで確認」導線が壊れる。
 *   2. 対象が LIFF 間遷移の対象 page_type
 *   3. **Oa.liffId で解決できた LIFF ID がある**
 *      → ⚠️ env フォールバック (NEXT_PUBLIC_LIFF_ID) はテスト用チャネルの LIFF。
 *        それで URL を作るとプレイヤーが別 OA の LIFF に飛ぶ（= 混線）。
 *        呼び出し側は `liffIdForUrl`（source="oa" のときだけ値が入る）を渡すこと。
 *
 * どれか 1 つでも欠ければ従来どおり相対パス。つまり「LIFF URL にできないときは
 * 黙って従来動作に落ちる」= 既存の遷移が壊れない。
 */
export function buildMenuPageHref(args: {
  pageType?:     string | null;
  workId:        string;
  workPublicId?: string | null;
  pageId:        string;
  pagePublicId?: string | null;
  /** Oa.liffId 由来の LIFF ID のみ。env フォールバックは渡さないこと。 */
  liffIdForUrl?: string | null;
  /** liff.isInClient()。LINE アプリ内かどうか。 */
  isInClient?:   boolean;
}): string {
  const relative = buildMenuPageRelativeHref(args);

  if (!args.isInClient) return relative;
  if (!LIFF_TO_LIFF_PAGE_TYPES.has(normalizeLiffPageType(args.pageType))) return relative;
  if (!args.workPublicId || !args.pagePublicId) return relative;

  // buildLiffUrl は liffId が空なら null を返す（env を混ぜない設計）。
  const liffUrl = buildLiffUrl({
    liffId: args.liffIdForUrl,
    path:   `/w/${args.workPublicId}/p/${args.pagePublicId}`,
  });
  return liffUrl ?? relative;
}
