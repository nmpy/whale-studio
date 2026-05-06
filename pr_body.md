## 概要

LIFFページをヒントサイトとして利用できるように、ヒントサイト用のページ種別・固定ヘッダー・ネスト可能なトグルUI・画像/テキスト/ボタン等のブロック表示を追加しました。

## 主な変更

- LIFFページに `hint_site` 用のページ種別を追加
- `draft / published / archived` の公開ステータスを追加
- ヒントサイト用の固定ヘッダーを追加
  - ロゴ画像
  - CTAボタン
  - ネタバレ注意文言
  - テーマ設定
- ネスト可能な accordion ブロックを追加
  - 最大3階層
  - `+ / -` 表示
  - `aria-expanded` / `aria-controls` 対応
- 以下のLIFFブロックを追加
  - heading
  - text
  - warning
  - image
  - button_link
  - divider
  - accordion
- 既存のLIFF設定画面からヒントサイトを作成・プレビュー・公開できるように変更
- 画像ブロックに表示サイズ設定を追加
- ヒントサイト用の簡易analyticsイベントハブを追加

## DB変更

`liff_page_configs` に以下を追加しました。

- `page_type`
- `publish_status`
- `settings_json`

既存の `is_enabled = true` のLIFF設定は `published` に移行されます。

## 動作確認

- `npx prisma generate`
- `npm run build`

## 補足

- プレイヤー側からの画像投稿機能は今回のスコープ外です
- ハンバーガーメニューは枠のみで、中身のドロワー実装は今回のスコープ外です
- accordion のドラッグ&ドロップ並び替えは未実装で、▲▼ボタンで代替しています
