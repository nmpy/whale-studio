"use client";

// src/components/liff/LiffPuzzleEditor.tsx
// LIFF「謎・問題」(page_type="puzzle") モード用の表示設定 UI [PR-PZ2.1]。
// 親 (LiffConfigHeader) から settings を受け取り、onChange で settings_json に流す。
// ここで設定するのは「見た目 / 表示範囲」のみ。answer / hint 等のネタバレ設定は一切扱わない。
//   - 一覧見出し名: 謎 / 問題 / 自由入力（show_heading で表示可否）
//   - 表示する問題: all / delivered / solved（保存値は単一の display_mode）
//   - 表示件数 max_count / ステータス表示 show_status
// 実際の一覧描画・データ取得・spoiler 除外は PuzzleRenderer → RiddleListBlock + /puzzles API 側。

import type { LiffPageConfigSettings } from "@/types";

interface Props {
  settings: LiffPageConfigSettings;
  readOnly: boolean;
  onChange: (patch: Partial<LiffPageConfigSettings>) => void;
}

const HEADING_CUSTOM_MAX = 20;

export function LiffPuzzleEditor({ settings, readOnly, onChange }: Props) {
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";
  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";
  const radioRowCls = "flex items-center gap-2 text-sm text-gray-700";

  const headingMode = settings.heading_mode ?? "custom";
  const displayMode = settings.display_mode ?? "delivered";
  const showHeading = settings.show_heading !== false; // 既定 true
  const showStatus = settings.show_status !== false;   // 既定 true

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-5">
      <h2 className="text-sm font-semibold text-gray-900">謎・問題ページの表示設定</h2>

      {/* 1. 一覧見出し */}
      <div>
        <span className={labelCls}>一覧見出し</span>
        <div className="space-y-1.5">
          {([
            { v: "riddle",   label: "謎" },
            { v: "question", label: "問題" },
            { v: "custom",   label: "自由入力" },
          ] as const).map((o) => (
            <label key={o.v} className={radioRowCls}>
              <input
                type="radio"
                name="puzzle-heading-mode"
                disabled={readOnly}
                checked={headingMode === o.v}
                onChange={() => onChange({ heading_mode: o.v })}
              />
              {o.label}
            </label>
          ))}
        </div>
        {headingMode === "custom" && (
          <input
            type="text"
            disabled={readOnly}
            value={settings.heading_custom ?? ""}
            maxLength={HEADING_CUSTOM_MAX}
            placeholder="例: これまでの謎"
            onChange={(e) => onChange({ heading_custom: e.target.value })}
            className={`${inputCls} mt-2`}
          />
        )}
        <label className={`${radioRowCls} mt-2`}>
          <input
            type="checkbox"
            disabled={readOnly}
            checked={showHeading}
            onChange={(e) => onChange({ show_heading: e.target.checked })}
          />
          一覧見出しを表示する
        </label>
        <p className="mt-1 text-[11px] text-gray-400">ページタイトルと重複する場合はオフにできます。</p>
      </div>

      {/* 2. 表示する問題（択一・保存値は単一の display_mode） */}
      <div>
        <span className={labelCls}>表示する問題</span>
        <div className="space-y-1.5">
          {([
            { v: "all",       label: "問題をすべて表示する" },
            { v: "delivered", label: "プレイヤーが到達した問題を一覧表示する" },
            { v: "solved",    label: "プレイヤーが過去に解いた問題を表示する" },
          ] as const).map((o) => (
            <label key={o.v} className={radioRowCls}>
              <input
                type="radio"
                name="puzzle-display-mode"
                disabled={readOnly}
                checked={displayMode === o.v}
                onChange={() => onChange({ display_mode: o.v })}
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>

      {/* 3. 表示件数 / ステータス表示 */}
      <div>
        <label className={labelCls} htmlFor="puzzle-max-count">表示件数（空欄で全件）</label>
        <input
          id="puzzle-max-count"
          type="number"
          min={1}
          max={50}
          disabled={readOnly}
          value={settings.max_count ?? ""}
          placeholder="全件"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ max_count: Number.isFinite(n) && n > 0 ? n : undefined });
          }}
          className={`${inputCls} max-w-[140px]`}
        />
      </div>

      <label className={radioRowCls}>
        <input
          type="checkbox"
          disabled={readOnly}
          checked={showStatus}
          onChange={(e) => onChange({ show_status: e.target.checked })}
        />
        「正解済み / 未回答」を表示する
      </label>
    </div>
  );
}
