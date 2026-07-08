// src/lib/live-stall.ts
//
// 停滞(stalled)検知 + 最終アクション時刻の相対表示（PR2b-2・表示側で導出）。
// LiveParticipant.lastSeenAt の経過時間から「止まっていないか」を導出する。cron 不要。
//   - 保存された status（waiting/active/stuck/completed/dropped）とは別軸の「表示上の停滞」。
//   - completed / dropped は停滞対象外（進行の必要がない）。

/** この時間アクションが無ければ「停滞」とみなす既定閾値（ミリ秒）。= 10 分。 */
export const LIVE_STALL_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * 参加者が「停滞」しているか（表示用の導出）。
 *   - completed / dropped は常に false
 *   - lastSeenAt が無い / 不正なら false（＝アクション実績が無い＝判定不能は非停滞）
 *   - lastSeenAt からの経過が閾値を超えたら true
 */
export function isParticipantStalled(
  status: string,
  lastSeenAt: string | Date | null | undefined,
  nowMs: number,
  thresholdMs: number = LIVE_STALL_THRESHOLD_MS,
): boolean {
  if (status === "completed" || status === "dropped") return false;
  if (lastSeenAt == null) return false;
  const t = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > thresholdMs;
}

/**
 * 最終アクション時刻の相対表示（"たった今" / "N分前" / "N時間前" / "N日前"）。
 * null / 不正は "—"。
 */
export function formatRelativeTime(value: string | Date | null | undefined, nowMs: number): string {
  if (value == null) return "—";
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "たった今";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  return `${day}日前`;
}
