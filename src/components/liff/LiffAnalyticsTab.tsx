"use client";

// src/components/liff/LiffAnalyticsTab.tsx
// LIFF ページ詳細画面の "計測" タブ本体。
// /api/works/[workId]/liff-pages/[pageId]/analytics の結果を表示する。
//
// 表示要素:
//   - totals カード (PV / UU / button_click / CTR / page_type 固有指標)
//   - 直近イベント一覧 (event_type / line_user_id / created_at / metadata)
//   - survey ページなら回答一覧
//   - default ページなら直近のチェックイン履歴
//
// 数値は丸めず raw 値で出す (整数 / 比率は小数 1 桁)。
// API 取得失敗時は静かにエラーを出すだけにする (CMS 全体の妨げにならないこと)。

import { useEffect, useState } from "react";
import { liffConfigApi, getDevToken, type LiffPageAnalytics } from "@/lib/api-client";

interface Props {
  workId: string;
  pageId: string;
}

function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "0%";
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

const EVENT_LABELS: Record<string, string> = {
  page_view:       "PV",
  block_view:      "ブロック表示",
  button_click:    "ボタンクリック",
  hint_open:       "ヒント開封",
  faq_open:        "Q&A開封",
  survey_submit:   "アンケート送信",
  checkin_success: "チェックイン成功",
  checkin_failed:  "チェックイン失敗",
};

function shortenLineUserId(id: string | null | undefined): string {
  if (!id) return "(匿名)";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function LiffAnalyticsTab({ workId, pageId }: Props) {
  const [data, setData] = useState<LiffPageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    liffConfigApi
      .getPageAnalytics(getDevToken(), workId, pageId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("計測データの取得に失敗しました"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workId, pageId]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-20 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
        {error ?? "計測データを表示できません"}
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-5">
      {/* 総合計 */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">サマリ</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label="PV" value={t.page_view.toLocaleString()} />
          <StatCard label="UU" value={t.unique_users.toLocaleString()} sub="ユーザー" />
          <StatCard label="ボタンクリック" value={t.button_click.toLocaleString()} />
          <StatCard label="CTR" value={formatPercent(t.ctr)} sub="クリック / PV" />
          {data.page_type === "default" && (
            <>
              <StatCard label="チェックイン成功" value={t.checkin_success.toLocaleString()} />
              <StatCard label="チェックイン失敗" value={t.checkin_failed.toLocaleString()} />
            </>
          )}
          {data.page_type === "survey" && (
            <StatCard label="アンケート送信" value={t.survey_submit.toLocaleString()} />
          )}
          {data.page_type === "faq" && (
            <StatCard label="Q&A開封" value={t.faq_open.toLocaleString()} />
          )}
          {data.page_type === "hint" && (
            <StatCard label="ヒント開封" value={t.hint_open.toLocaleString()} />
          )}
        </div>
      </section>

      {/* ブロック別 */}
      {data.block_breakdown.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">ブロック別内訳</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">ブロックID</th>
                  <th className="text-left px-3 py-2 font-semibold">イベント</th>
                  <th className="text-right px-3 py-2 font-semibold">件数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.block_breakdown.map((b, i) => (
                  <tr key={`${b.block_id}-${b.event_type}-${i}`}>
                    <td className="px-3 py-2 text-gray-600 font-mono">{b.block_id?.slice(0, 8) ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-700">{EVENT_LABELS[b.event_type] ?? b.event_type}</td>
                    <td className="px-3 py-2 text-right text-gray-900 font-semibold">{b.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* アンケート回答 */}
      {data.survey && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            アンケート回答（直近 {data.survey.recent.length} 件 / 合計 {data.survey.total_count.toLocaleString()} 件）
          </h3>
          {data.survey.recent.length === 0 ? (
            <p className="text-xs text-gray-500">まだ回答がありません</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {data.survey.recent.map((r) => (
                  <li key={r.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2 text-gray-500 mb-1">
                      <span>{shortenLineUserId(r.line_user_id)}</span>
                      <span>{formatDateTime(r.submitted_at)}</span>
                    </div>
                    <pre className="text-[11px] bg-gray-50 rounded p-2 overflow-x-auto text-gray-700 whitespace-pre-wrap break-words">
                      {JSON.stringify(r.answers_json, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* チェックイン履歴 */}
      {data.checkin && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            チェックイン履歴（直近 {data.checkin.recent.length} 件 / 合計 {data.checkin.total_count.toLocaleString()} 件）
          </h3>
          {data.checkin.recent.length === 0 ? (
            <p className="text-xs text-gray-500">まだチェックインがありません</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">日時</th>
                    <th className="text-left px-3 py-2 font-semibold">ロケーション</th>
                    <th className="text-left px-3 py-2 font-semibold">ユーザー</th>
                    <th className="text-left px-3 py-2 font-semibold">方式</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.checkin.recent.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 text-gray-700">{formatDateTime(v.visited_at)}</td>
                      <td className="px-3 py-2 text-gray-900">{v.location_name ?? v.location_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono">{shortenLineUserId(v.line_user_id)}</td>
                      <td className="px-3 py-2 text-gray-600">{v.checkin_method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 直近イベント */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          直近イベント（{data.recent_events.length} 件）
        </h3>
        {data.recent_events.length === 0 ? (
          <p className="text-xs text-gray-500">まだイベントが記録されていません</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">日時</th>
                  <th className="text-left px-3 py-2 font-semibold">イベント</th>
                  <th className="text-left px-3 py-2 font-semibold">ユーザー</th>
                  <th className="text-left px-3 py-2 font-semibold">メタデータ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recent_events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                    <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{EVENT_LABELS[e.event_type] ?? e.event_type}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono whitespace-nowrap">{shortenLineUserId(e.line_user_id)}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {e.metadata_json
                        ? <span className="text-[11px] font-mono break-all">{JSON.stringify(e.metadata_json)}</span>
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
