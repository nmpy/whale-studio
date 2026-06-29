// src/lib/admin-help/prompt.ts
// 管理画面ヘルプAI（MVP）の system prompt（instructions）と input 組み立て。
// OpenAI Responses API に渡す。個人情報・内部ID・本文・secret は渡さない。

import type { AdminHelpKnowledgeItem } from "./types";

/** ヘルプAIの役割・制約（Responses API の instructions）。 */
export function buildSystemPrompt(): string {
  return [
    "あなたは Whale Studio 管理画面の操作サポートAIです。",
    "回答対象は Whale Studio の操作方法・機能説明・設定手順のみです。",
    "提供された『ヘルプ知識』と『現在画面情報』に基づいて答えてください。",
    "わからない場合や知識に無い場合は、推測で断定せず「画面上の設定内容を確認してください」「確認が必要です」と答えてください。",
    "Whale Studio に存在しない機能を、存在するように説明しないでください。",
    "作品本文、参加者情報、LINE userId、回答履歴、webhookログ、APIキー、secret、内部IDには触れないでください。",
    "あなたは設定変更・保存・削除・公開・LINE送信・DB更新などの実行はできません。『このAIが代わりに設定します』とは言わないでください。",
    "現在画面情報がある場合は、それを踏まえて『この画面のどこで何をするか』を案内してください。",
    "ITに詳しくない制作者にもわかる、やさしい日本語で説明してください。",
    "回答は簡潔に。手順が必要な場合だけ番号付きで短くまとめてください。全体で500〜900文字程度に収めてください。",
    "重要な操作については最後に「重要な設定は画面上の内容を確認してください」と補足してください。",
    "表記は『クイックリプライ』に統一し、QRコード（QR画像）と混同しないでください。",
  ].join("\n");
}

/** 画面情報（内部IDや本文は含めない・pathname/タイトル/contextType のみ）。 */
export type ScreenContext = {
  pathname?:    string;
  pageTitle?:   string;
  contextType?: string;
};

/** Responses API の input（ヘルプ知識 + 現在画面情報 + ユーザー質問）。 */
export function buildInput(
  question: string,
  knowledge: AdminHelpKnowledgeItem[],
  screen: ScreenContext,
): string {
  const knowledgeBlock = knowledge.length
    ? knowledge.map((k) => `### ${k.title}\n${k.content}`).join("\n\n")
    : "（該当する知識なし）";

  const screenLines = [
    screen.pathname    ? `- 現在のパス: ${screen.pathname}` : null,
    screen.pageTitle   ? `- 画面タイトル: ${screen.pageTitle}` : null,
    screen.contextType ? `- 画面種別: ${screen.contextType}` : null,
  ].filter(Boolean);
  const screenBlock = screenLines.length ? screenLines.join("\n") : "（画面情報なし）";

  return [
    "# ヘルプ知識（回答の元ネタ。ここに無いことは断定しない）",
    knowledgeBlock,
    "",
    "# 現在画面情報",
    screenBlock,
    "",
    "# ユーザーの質問",
    question,
  ].join("\n");
}

/** 既定の質問例（フロントのチップと、回答の suggestedQuestions フォールバックに使える）。 */
export const ADMIN_HELP_SUGGESTED_QUESTIONS: string[] = [
  "クイックリプライとは？",
  "問題にヒントを出したい",
  "画像タップでフェーズ遷移したい",
  "LIFFページを公開したい",
  "メッセージが5通以上あるとどうなる？",
];
