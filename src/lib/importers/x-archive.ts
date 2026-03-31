/**
 * X Archive Importer
 *
 * X（旧Twitter）のアーカイブデータを読み込み、
 * DashboardData 互換の形式に変換するモジュール。
 *
 * ─ 将来の差し替え手順 ─────────────────────────────────
 * 1. X.com の設定 → 「アカウント」→「データのアーカイブをリクエスト」で ZIP を取得
 * 2. ZIP 内の `data/tweets.js` / `data/tweet.js` を解析して Post[] に変換
 * 3. importFromXArchive(file) を呼び出すと Post[] が返る
 * 4. lib/services/x-analytics.ts の fetchDashboardData() 内でこの関数に差し替える
 * ─────────────────────────────────────────────────────
 */

import type { Post, DailyEngagement } from '@/lib/types/x-analytics';

export interface XArchiveImportResult {
  posts: Post[];
  dailyEngagement: DailyEngagement[];
}

/**
 * X アーカイブ ZIP / tweets.js ファイルから投稿データをインポートする
 *
 * @param file - X アーカイブの ZIP ファイル、または tweets.js を直接指定
 * @returns 変換済みの投稿データと日別エンゲージメント集計
 *
 * TODO: 実装
 *   - ZIP の場合: JSZip 等で展開 → data/tweets.js を取り出す
 *   - tweets.js の形式: `window.YTD.tweets.part0 = [ ... ]` → JSON.parse 前に先頭行を除去
 *   - 各ツイートの public_metrics（いいね/RT/返信数）を Post 型にマッピング
 */
export async function importFromXArchive(_file: File): Promise<XArchiveImportResult> {
  throw new Error(
    'X Archive Importer は未実装です。' +
    'lib/importers/x-archive.ts に実装を追加してください。'
  );
}

/**
 * tweets.js の生テキストを直接パースする（ZIP 不要バージョン）
 *
 * tweets.js の先頭行 "window.YTD.tweets.part0 = " を除いた
 * JSON 配列文字列を渡すとパースして返す。
 *
 * TODO: 実装
 */
export async function importFromTweetsJs(_rawJs: string): Promise<XArchiveImportResult> {
  throw new Error(
    'tweets.js パーサーは未実装です。' +
    'lib/importers/x-archive.ts に実装を追加してください。'
  );
}
