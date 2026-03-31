/**
 * X 投稿・グラフ用モックデータ（将来自動化予定）
 *
 * ─────────────────────────────────────────────────────────
 * ③ 将来自動化データ
 *    現在はサンプルデータを返す。
 *    将来: lib/importers/x-archive.ts でアーカイブ読込、
 *          または lib/services/x-data.ts で X API v2 に差し替え。
 * ─────────────────────────────────────────────────────────
 */

import type { XFollowerPoint, XDailyEngagement, XPost } from '@/lib/types/x';

// ─────────────────────────────────────────────────────────
// 30 日分のフォロワー推移（プレースホルダー）
// ─────────────────────────────────────────────────────────

export function getMockFollowerHistory(): XFollowerPoint[] {
  const data: XFollowerPoint[] = [];
  let followers = 1510;
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    followers += Math.floor(Math.random() * 5) - 1; // 日々 -1〜+4
    data.push({ date: d.toISOString().slice(0, 10), followers });
  }
  return data;
}

// ─────────────────────────────────────────────────────────
// 30 日分の日別エンゲージメント（プレースホルダー）
// ─────────────────────────────────────────────────────────

export function getMockDailyEngagement(): XDailyEngagement[] {
  const data: XDailyEngagement[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    data.push({
      date:  d.toISOString().slice(0, 10),
      posts: isWeekend
        ? Math.floor(Math.random() * 2)
        : Math.floor(Math.random() * 4) + 1,
      likes: Math.floor(Math.random() * 120) + 20,
    });
  }
  return data;
}

// ─────────────────────────────────────────────────────────
// 投稿一覧（プレースホルダー）
// ─────────────────────────────────────────────────────────

const SAMPLE_POSTS: { text: string; days: number }[] = [
  { text: 'Next.js 14のApp Routerでキャッシュ戦略をまとめました。ISR・SSG・SSRの使い分けポイントを整理。', days: 0 },
  { text: '個人開発でSaaSを作るなら、最初はSQLiteで十分。後からPostgreSQLに移行すればいい。', days: 1 },
  { text: 'LINE Messaging APIのWebhook処理、非同期キューに入れるだけでUXが劇的に変わる。', days: 2 },
  { text: 'TypeScriptのsatisfies演算子、もっと早く知りたかった。型推論を保ちつつ型チェックできる。', days: 3 },
  { text: '朝のコーヒーを飲みながらコード書く時間が一番集中できる。', days: 4 },
  { text: 'Prismaのリレーション設計、最初にちゃんとやっておくと後が楽。CASCADE deleteの設定は慎重に。', days: 5 },
  { text: 'TailwindやめてCSS変数＋バニラCSSに戻したら、バンドルサイズが30%減った話。', days: 7 },
  { text: 'Supabase AuthのJWT検証、Edge Functionsでやるとレイテンシが半分になった。', days: 8 },
  { text: 'React Server Componentsのメンタルモデルがやっと腑に落ちた。データフェッチはサーバー、インタラクションはクライアント。', days: 9 },
  { text: '技術ブログを週1で書き続けて半年。PVは大したことないけど、自分の理解が深まるのが一番の収穫。', days: 10 },
  { text: 'Zodでバリデーション書くの快適すぎる。フロントとバックで型を共有できるのが最高。', days: 12 },
  { text: 'CI/CDパイプライン、GitHub Actionsで組むならキャッシュ設定をちゃんとやるだけで3分短縮できた。', days: 13 },
  { text: '個人開発のモチベ維持のコツ: 毎日触ること。5分でもいいからコードを書く。', days: 15 },
  { text: 'Vercelのデプロイ、pushしてから30秒でプレビューURL出るの本当に便利。', days: 16 },
  { text: 'SQLiteのWALモード、読み込み性能が段違い。開発DBには必須設定。', days: 18 },
  { text: 'フロントのフォームバリデーション、UXを考えるとonBlurでリアルタイムチェックが正解だった。', days: 19 },
  { text: 'APIレスポンスの型安全性、zodで入出力両方バリデーションするようにしたらバグが激減。', days: 21 },
  { text: 'ダークモード対応、CSS変数を使えば切り替えロジックは10行で済む。', days: 22 },
  { text: 'Reactのusememo、9割のケースで不要。計測してから入れるべし。', days: 24 },
  { text: 'プロダクトの初期ユーザー、Twitterで直接DMした方がLPより効果あった。', days: 25 },
];

let _postCache: XPost[] | null = null;

export function getMockPosts(): XPost[] {
  if (_postCache) return _postCache;
  _postCache = SAMPLE_POSTS.map(({ text, days }, i) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60), 0, 0);
    const baseLike = Math.floor(Math.random() * 200) + 10;
    return {
      id:              `mock-post-${i + 1}`,
      text,
      createdAt:       d.toISOString(),
      likeCount:       baseLike,
      repostCount:     Math.floor(baseLike * 0.12) + Math.floor(Math.random() * 5),
      replyCount:      Math.floor(baseLike * 0.07) + Math.floor(Math.random() * 3),
      impressionCount: baseLike * 18 + Math.floor(Math.random() * 1000),
    };
  });
  return _postCache;
}
