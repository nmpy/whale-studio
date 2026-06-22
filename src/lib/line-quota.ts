// src/lib/line-quota.ts
//
// LINE Messaging API の「今月の送信上限」「送信済み数（消費通数）」取得ラッパー。
//   - GET /v2/bot/message/quota            → 月間上限（type="limited" のとき value、"none" は上限なし）
//   - GET /v2/bot/message/quota/consumption → 今月の送信済み数（totalUsage）
//
// 「時間差メッセージ（予約送信）= push 配信」は通数を消費するため、CMS で使用状況を可視化し、
// 70% 注意 / 90% 警告 / 100% 送信失敗リスク を表示するための土台。
//
// push/reply 等の既存呼び出しと同じ Bearer 認証・try/catch + console ログ方針に合わせる。
// 失敗時は null を返し、呼び出し側は "unknown" 表示にフォールバックできる。

const LINE_QUOTA_URL             = "https://api.line.me/v2/bot/message/quota";
const LINE_QUOTA_CONSUMPTION_URL = "https://api.line.me/v2/bot/message/quota/consumption";

/** GET /v2/bot/message/quota の戻り。type="none" = 上限なし（無制限）。 */
export interface LineMessageQuota {
  /** "none"（上限なし）| "limited"（value が月間上限） */
  type:  "none" | "limited";
  /** type="limited" のときの月間上限。none のときは null。 */
  value: number | null;
}

async function lineGet<T>(url: string, channelAccessToken: string, tag: string): Promise<T | null> {
  if (!channelAccessToken) return null;
  try {
    const res = await fetch(url, {
      method:  "GET",
      headers: { Authorization: `Bearer ${channelAccessToken}` },
      // OA の月間使用状況はリアルタイム性が要るためキャッシュしない。
      cache:   "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let lineMessage: string | null = null;
      try { lineMessage = (JSON.parse(body) as { message?: string })?.message ?? null; } catch { /* 非JSON */ }
      console.error(`[line-quota:${tag}:failed]`, JSON.stringify({ status: res.status, lineMessage }));
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[line-quota:${tag}:failed]`, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

/** 今月の月間メッセージ上限を取得（push/multicast 等の対象通数枠）。失敗時 null。 */
export function fetchLineMessageQuota(channelAccessToken: string): Promise<LineMessageQuota | null> {
  return lineGet<LineMessageQuota>(LINE_QUOTA_URL, channelAccessToken, "quota");
}

/** 今月の送信済み数（totalUsage）を取得。失敗時 null。 */
export async function fetchLineMessageConsumption(channelAccessToken: string): Promise<number | null> {
  const r = await lineGet<{ totalUsage?: number }>(LINE_QUOTA_CONSUMPTION_URL, channelAccessToken, "consumption");
  return r && typeof r.totalUsage === "number" ? r.totalUsage : null;
}

// ── 使用状況サマリ（CMS 表示用） ───────────────────────────

/**
 * しきい値レベル:
 *   - "unlimited": 上限なし（type="none"）
 *   - "unknown":   取得失敗（API エラー等）
 *   - "ok":        ~70% 未満
 *   - "notice":    70% 以上（注意）
 *   - "warn":      90% 以上（警告）
 *   - "over":      100% 以上（送信失敗リスク）
 */
export type QuotaLevel = "unlimited" | "unknown" | "ok" | "notice" | "warn" | "over";

export interface OaQuotaUsage {
  type:      "none" | "limited" | "unknown";
  /** 月間上限（limited のときのみ）。 */
  limit:     number | null;
  /** 今月の送信済み数。 */
  used:      number | null;
  /** 残り通数（limited のときのみ・0 下限）。 */
  remaining: number | null;
  /** 使用率（0-1）。limited かつ limit>0 のときのみ。 */
  ratio:     number | null;
  level:     QuotaLevel;
}

/** 使用率（0-1）と上限種別から表示レベルを決める純関数（しきい値: 70% / 90% / 100%）。 */
export function resolveQuotaLevel(args: { type: "none" | "limited" | "unknown"; ratio: number | null }): QuotaLevel {
  if (args.type === "none") return "unlimited";
  if (args.type === "unknown" || args.ratio == null || !Number.isFinite(args.ratio)) return "unknown";
  if (args.ratio >= 1)    return "over";
  if (args.ratio >= 0.9)  return "warn";
  if (args.ratio >= 0.7)  return "notice";
  return "ok";
}

/** 上限・送信済みをまとめて取得し、表示用サマリ（レベル含む）を返す。 */
export async function getOaQuotaUsage(channelAccessToken: string): Promise<OaQuotaUsage> {
  const [quota, used] = await Promise.all([
    fetchLineMessageQuota(channelAccessToken),
    fetchLineMessageConsumption(channelAccessToken),
  ]);

  if (!quota) {
    return { type: "unknown", limit: null, used: used, remaining: null, ratio: null, level: "unknown" };
  }
  if (quota.type === "none") {
    return { type: "none", limit: null, used: used, remaining: null, ratio: null, level: "unlimited" };
  }
  const limit = quota.value ?? null;
  const ratio = (limit && limit > 0 && used != null) ? used / limit : null;
  const remaining = (limit != null && used != null) ? Math.max(0, limit - used) : null;
  return {
    type: "limited", limit, used, remaining, ratio,
    level: resolveQuotaLevel({ type: "limited", ratio }),
  };
}
