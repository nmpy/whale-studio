// src/lib/admin-help/select-knowledge.ts
// ユーザー質問 / pathname / contextType から関連ヘルプ知識だけを選ぶ純ロジック。
// 毎回全件を OpenAI に渡さず、最大 5 カテゴリ程度に絞る。該当なしなら general を含める。

import type { AdminHelpCategory, AdminHelpKnowledgeItem } from "./types";
import { ADMIN_HELP_KNOWLEDGE } from "./knowledge";

const MAX_CATEGORIES = 5;

const byId = new Map<AdminHelpCategory, AdminHelpKnowledgeItem>(
  ADMIN_HELP_KNOWLEDGE.map((k) => [k.id, k]),
);

/** 質問に含まれると対象カテゴリを足す語のマップ（部分一致・日本語/英語）。 */
const KEYWORD_RULES: { categories: AdminHelpCategory[]; terms: string[] }[] = [
  { categories: ["quick_reply"], terms: ["クイックリプライ", "選択肢", "ボタン", "次へ"] },
  { categories: ["puzzle_hint"], terms: ["ヒント", "問題", "謎", "なぞ", "不正解", "正解", "クイズ"] },
  { categories: ["image_action"], terms: ["画像タップ", "画像", "タップ"] },
  { categories: ["phase"], terms: ["フェーズ", "遷移", "進行", "シナリオフロー"] },
  { categories: ["liff_pages"], terms: ["liff", "ＬＩＦＦ", "ページ", "公開", "ミニアプリ"] },
  { categories: ["survey"], terms: ["アンケート", "フォーム", "回答フォーム"] },
  { categories: ["faq"], terms: ["faq", "よくある質問"] },
  { categories: ["announcement"], terms: ["お知らせ", "告知", "アナウンス"] },
  { categories: ["monthly_message_count"], terms: ["通数", "月間", "上限", "送信数"] },
  { categories: ["scheduled_messages"], terms: ["予約", "時間差", "スケジュール"] },
  { categories: ["checkin"], terms: ["チェックイン", "地点", "到着", "ビーコン", "gps", "位置"] },
  { categories: ["carousel"], terms: ["カルーセル", "カード", "横スクロール"] },
  { categories: ["audit_log"], terms: ["ログ", "履歴", "監査"] },
  { categories: ["messages"], terms: ["メッセージ", "送信", "連続", "チェーン", "5通", "6通", "並び替え", "表示順"] },
];

/** pathname 断片 → 優先カテゴリ。 */
const PATH_RULES: { categories: AdminHelpCategory[]; fragment: string }[] = [
  { categories: ["messages", "quick_reply"], fragment: "/messages" },
  { categories: ["liff_pages"], fragment: "/liff" },
  { categories: ["phase"], fragment: "/phases" },
  { categories: ["puzzle_hint"], fragment: "/riddles" },
  { categories: ["checkin"], fragment: "/locations" },
  { categories: ["announcement"], fragment: "/announcements" },
];

/**
 * 関連知識を選ぶ。pathname 由来を優先し、次に質問キーワード、最後に general を補う。最大 MAX_CATEGORIES 件。
 */
export function selectKnowledge(
  question: string,
  pathname?: string,
  contextType?: string,
): AdminHelpKnowledgeItem[] {
  const q = (question ?? "").toLowerCase();
  const path = (pathname ?? "").toLowerCase();
  const ctx = (contextType ?? "").toLowerCase();

  const ordered: AdminHelpCategory[] = [];
  const add = (cats: AdminHelpCategory[]) => {
    for (const c of cats) if (!ordered.includes(c) && byId.has(c)) ordered.push(c);
  };

  // 1) pathname 由来（現在画面）を優先
  for (const r of PATH_RULES) if (path.includes(r.fragment)) add(r.categories);
  // 2) contextType（任意・カテゴリ名そのものが来たら採用）
  if (ctx && byId.has(ctx as AdminHelpCategory)) add([ctx as AdminHelpCategory]);
  // 3) 質問キーワード
  for (const r of KEYWORD_RULES) {
    if (r.terms.some((t) => q.includes(t.toLowerCase()))) add(r.categories);
  }

  // 4) 該当なしは general、ある場合も general を補助として最後に含める
  if (ordered.length === 0) add(["general"]);
  else if (!ordered.includes("general")) add(["general"]);

  return ordered.slice(0, MAX_CATEGORIES).map((id) => byId.get(id)!);
}
