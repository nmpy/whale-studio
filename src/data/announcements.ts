// src/data/announcements.ts
// お知らせデータ。
// 将来: 管理画面から編集可能にする場合は DB テーブル (Announcement) に移行し、
//       GET /api/announcements エンドポイントを追加するだけでよい構成にしてある。

export type AnnouncementType = "update" | "bugfix" | "known_issue" | "info";

export interface Announcement {
  id:        string;
  date:      string;          // YYYY-MM-DD
  type:      AnnouncementType;
  important: boolean;         // true → 赤帯で目立たせる
  title:     string;
  body:      string;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id:        "2026-04-02-001",
    date:      "2026-04-02",
    type:      "update",
    important: false,
    title:     "メッセージ・謎タブのUI改善",
    body:      "クイックリプライにヒント機能を追加しました。謎の保存時のバリデーションエラーを修正し、あいさつメッセージの管理場所をOA設定に集約しました。",
  },
  {
    id:        "2026-04-02-002",
    date:      "2026-04-02",
    type:      "update",
    important: false,
    title:     "フィードバック機能を追加",
    body:      "ヘッダー右上の「フィードバック」ボタンからご意見・ご要望をお送りいただけるようになりました。お気づきの点があればぜひお聞かせください。",
  },
  {
    id:        "2026-03-15-001",
    date:      "2026-03-15",
    type:      "known_issue",
    important: true,
    title:     "【既知の不具合】カルーセルメッセージの画像が一部表示されない場合があります",
    body:      "特定の画像URLを使用した場合にカルーセルのサムネイルが表示されないことが確認されています。現在調査中です。回避策: 画像URLを直接URLで指定してください。",
  },
];
