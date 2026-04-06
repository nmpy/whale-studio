// src/app/api/analytics/hub-actions/route.ts
// GET /api/analytics/hub-actions — 作品ハブ主要アクション行クリック集計
//                                    （プラットフォームオーナー専用）
//
// 集計対象: event_logs.event_name = "hub_action_click"
// 方式: 全件 findMany → payload を JSON パース → in-memory 集計
//       （EventLog.payload は JSON string なので SQL 集計が難しいため）
//
// レスポンス: HubActionAnalytics（下部に型定義）

import { prisma }             from "@/lib/prisma";
import { ok, serverError }   from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import type { HubActionClickPayload } from "@/lib/constants/event-names";

// ── ラベル定義 ────────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  messages:   "メッセージ",
  scenario:   "シナリオ",
  preview:    "プレビュー",
  characters: "キャラクター",
  audience:   "分析",
};

const EMPHASIS_LABELS: Record<string, string> = {
  normal:  "通常",
  preview: "プレビュー強調（sky-blue）",
  warning: "要確認強調（amber）",
};

const STATUS_LABELS: Record<string, string> = {
  draft:  "下書き",
  active: "公開中",
  paused: "停止中",
};

// ── レスポンス型 ──────────────────────────────────────────────────────────

interface KeyCountItem {
  key:   string;
  label: string;
  count: number;
  pct:   number;
}

interface EmphasisItem {
  emphasis: string;
  label:    string;
  count:    number;
  pct:      number;
}

interface PositionItem {
  position: number;
  count:    number;
  pct:      number;
  /** そのポジションで実際に押されたアクションキーの内訳（上位3件） */
  top_keys: { key: string; label: string; count: number }[];
}

interface StatusItem {
  status:   string;
  label:    string;
  count:    number;
  /** そのステータスの作品で押されたアクションキーの内訳（上位3件） */
  top_keys: { key: string; label: string; count: number }[];
}

interface NoPlayersStats {
  /** players=0 の文脈での preview クリック数 */
  preview_clicks: number;
  /** players=0 の文脈での全クリック数 */
  total_clicks:   number;
  /** preview_clicks / total_clicks (%) */
  preview_pct:    number;
}

export interface HubActionAnalytics {
  total:         number;
  by_action_key: KeyCountItem[];
  by_emphasis:   EmphasisItem[];
  by_position:   PositionItem[];
  by_status:     StatusItem[];
  no_players:    NoPlayersStats;
}

// ── ヘルパー ──────────────────────────────────────────────────────────────

function countBy<T>(arr: T[], keyFn: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of arr) {
    const k = keyFn(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function topEntries(
  map:   Map<string, number>,
  n:     number,
  labels: Record<string, string>,
): { key: string; label: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
}

// ── API ハンドラ ──────────────────────────────────────────────────────────

export const GET = withPlatformAdmin(async () => {
  try {
    // hub_action_click イベントを全件取得
    // payload は JSON 文字列なので in-memory でパースして集計する
    const rows = await prisma.eventLog.findMany({
      where:   { eventName: "hub_action_click" },
      select:  { payload: true },
      orderBy: { createdAt: "desc" },
    });

    // 不正 JSON は無視して除外
    const payloads = rows.flatMap((r) => {
      try {
        return [JSON.parse(r.payload) as HubActionClickPayload];
      } catch {
        return [];
      }
    });

    const total = payloads.length;
    const pct   = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

    // ── 1. action_key ごとのクリック数 ──────────────────────────────
    // 分析: どのアクションが最も押されるか
    const actionMap    = countBy(payloads, (p) => p.action_key);
    const by_action_key: KeyCountItem[] = [...actionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        label: ACTION_LABELS[key] ?? key,
        count,
        pct:   pct(count),
      }));

    // ── 2. emphasis ごとのクリック数 ────────────────────────────────
    // 分析: warning / preview 強調が押しやすさに影響しているか
    const emphasisMap  = countBy(payloads, (p) => p.emphasis);
    const by_emphasis: EmphasisItem[] = (["normal", "preview", "warning"] as const).map((e) => {
      const count = emphasisMap.get(e) ?? 0;
      return { emphasis: e, label: EMPHASIS_LABELS[e], count, pct: pct(count) };
    });

    // ── 3. position_index ごとの傾向 ────────────────────────────────
    // 分析: 先頭に置かれたアクションほど押されるか（順序効果の検証）
    const positionGroups = new Map<number, HubActionClickPayload[]>();
    for (const p of payloads) {
      const pos = p.position_index ?? 0;
      if (!positionGroups.has(pos)) positionGroups.set(pos, []);
      positionGroups.get(pos)!.push(p);
    }
    const by_position: PositionItem[] = [...positionGroups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([position, items]) => ({
        position,
        count:    items.length,
        pct:      pct(items.length),
        top_keys: topEntries(countBy(items, (p) => p.action_key), 3, ACTION_LABELS),
      }));

    // ── 4. status 別クリック傾向 ────────────────────────────────────
    // 分析: draft / active でアクションパターンが変わるか
    const statusGroups = new Map<string, HubActionClickPayload[]>();
    for (const p of payloads) {
      const s = p.status ?? "unknown";
      if (!statusGroups.has(s)) statusGroups.set(s, []);
      statusGroups.get(s)!.push(p);
    }
    const by_status: StatusItem[] = [...statusGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([status, items]) => ({
        status,
        label:    STATUS_LABELS[status] ?? status,
        count:    items.length,
        top_keys: topEntries(countBy(items, (p) => p.action_key), 3, ACTION_LABELS),
      }));

    // ── 5. players=0 での preview クリック ─────────────────────────
    // 分析: players=0 で preview を上位に出す Rule4 の効果検証
    const noPlayers         = payloads.filter((p) => (p.players ?? 0) === 0);
    const previewInNoPlayers = noPlayers.filter((p) => p.action_key === "preview").length;
    const no_players: NoPlayersStats = {
      preview_clicks: previewInNoPlayers,
      total_clicks:   noPlayers.length,
      preview_pct:    noPlayers.length > 0
        ? Math.round((previewInNoPlayers / noPlayers.length) * 100)
        : 0,
    };

    return ok<HubActionAnalytics>({
      total,
      by_action_key,
      by_emphasis,
      by_position,
      by_status,
      no_players,
    });
  } catch (err) {
    return serverError(err);
  }
});
