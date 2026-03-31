/**
 * X Analytics — 型定義
 *
 * データを 3 種類に分けて管理します。
 *
 * ① 固定データ      → XProfile
 *    コードで管理。アカウント情報が変わるときだけ編集。
 *
 * ② 手動更新データ  → XManualStats
 *    定期的に手動で書き換える数値。
 *    将来: X API または X アーカイブで自動化。
 *
 * ③ 将来自動化データ → XFollowerPoint / XDailyEngagement / XPost
 *    現在はモック。Xアーカイブ読込または X API v2 に差し替え予定。
 */

// ═══════════════════════════════════════════════════════════
// ① 固定データ
// ═══════════════════════════════════════════════════════════

/** アカウント基本情報（変更頻度: ほぼなし） */
export interface XProfile {
  /** 表示名 */
  displayName: string;
  /** ユーザーID（@ なし） */
  username: string;
  /** プロフィールページURL */
  profileUrl: string;
  /** 自己紹介文 */
  bio: string;
  /** アバター画像URL。未設定時はイニシャルを表示 */
  avatarUrl?: string;
}

// ═══════════════════════════════════════════════════════════
// ② 手動更新データ
// ═══════════════════════════════════════════════════════════

/**
 * 手動で管理するアカウント統計
 * lib/mock/x-account.ts の X_MANUAL_STATS を直接書き換えて更新する。
 */
export interface XManualStats {
  /** フォロワー数 */
  followersCount: number;
  /** フォロー中 */
  followingCount: number;
  /** 総ポスト数 */
  totalPostCount: number;
  /** 前日比フォロワー増減 */
  followersDayChange: number;
  /** 7日間フォロワー増減 */
  followersWeekChange: number;
  /** 今月の投稿数 */
  monthlyPostCount: number;
  /** 今月のいいね合計 */
  monthlyLikeTotal: number;
  /**
   * この統計を最後に手動更新した日付（YYYY-MM-DD）
   * 更新したら必ずここも書き換える
   */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════
// ③ 将来自動化データ（現在はモック）
// ═══════════════════════════════════════════════════════════

/** フォロワー推移の1データポイント */
export interface XFollowerPoint {
  date: string;       // YYYY-MM-DD
  followers: number;
}

/** 日別エンゲージメントの1データポイント */
export interface XDailyEngagement {
  date: string;       // YYYY-MM-DD
  posts: number;
  likes: number;
}

/** 投稿データ */
export interface XPost {
  id: string;
  text: string;
  createdAt: string;        // ISO 8601
  likeCount: number;
  repostCount: number;
  replyCount: number;
  impressionCount: number;
}

/** 投稿一覧のソートキー */
export type PostSortKey = 'latest' | 'likes' | 'reposts' | 'replies';

// ═══════════════════════════════════════════════════════════
// ダッシュボード集約型
// ═══════════════════════════════════════════════════════════

/** ダッシュボード全体のデータ */
export interface XDashboardData {
  /** ① 固定データ */
  profile: XProfile;
  /** ② 手動更新データ */
  stats: XManualStats;
  /** ③ 将来自動化データ */
  followerHistory: XFollowerPoint[];
  dailyEngagement: XDailyEngagement[];
  posts: XPost[];
}
