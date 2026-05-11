"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + page_type 切替 + ヒントサイト用ヘッダー設定
//
// 入力欄の onChange は API を直接呼ばず、すべて onLocalChange (= draft 更新) に集約する。
// 実 API 保存は useLiffConfig 側の debounce auto-save に任せる。

import type { LiffPageConfig, LiffPageConfigSettings, LiffPageType, LiffPublishStatus } from "@/types";
import { normalizeLiffPageType } from "@/types";
import { LiffFaqEditor } from "./LiffFaqEditor";
import { LiffSurveyEditor } from "./LiffSurveyEditor";

interface Props {
  config: LiffPageConfig;
  saving: boolean;
  readOnly: boolean;
  canPublish?: boolean;
  onToggleEnabled: () => void;
  onLocalChange: (patch: Partial<LiffPageConfig>) => void;
  onUpdatePageType: (next: LiffPageType) => void;
  onUpdatePublishStatus: (next: LiffPublishStatus) => void;
}

export function LiffConfigHeader({
  config, saving, readOnly, canPublish,
  onToggleEnabled, onLocalChange,
  onUpdatePageType, onUpdatePublishStatus,
}: Props) {
  const settings: LiffPageConfigSettings = config.settings_json ?? {};
  // 旧 "hint_site" は "hint" に正規化したうえでモード判定する
  const mode = normalizeLiffPageType(config.page_type);
  const isHint = mode === "hint";
  const isFaq = mode === "faq";
  const isSurvey = mode === "survey";

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  const updateSetting = (key: keyof LiffPageConfigSettings, value: unknown) => {
    onLocalChange({ settings_json: { ...settings, [key]: value } });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">LIFF表示設定</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={config.publish_status}
            onChange={(e) => onUpdatePublishStatus(e.target.value as LiffPublishStatus)}
            disabled={saving || readOnly || !canPublish}
            title={!canPublish ? "公開操作は admin 以上の権限が必要です" : undefined}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white disabled:bg-gray-50"
          >
            <option value="draft">下書き</option>
            <option value="published">公開中</option>
            <option value="archived">アーカイブ</option>
          </select>

          <span className="text-sm text-gray-500">
            {config.is_enabled ? "有効" : "無効"}
          </span>
          <button
            onClick={onToggleEnabled}
            disabled={saving || readOnly}
            className="relative w-12 h-[26px] rounded-full border-none cursor-pointer transition-colors"
            style={{ background: config.is_enabled ? "#06C755" : "#d1d5db" }}
          >
            <div
              className="absolute top-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]"
              style={{ left: config.is_enabled ? 24 : 2 }}
            />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <label className={labelCls + " mb-0"}>ページ種別</label>
          <select
            // 表示上は "hint" を選択状態として正規化する（旧 "hint_site" 互換）
            value={mode}
            onChange={(e) => onUpdatePageType(e.target.value as LiffPageType)}
            disabled={readOnly}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="default">既存LIFF（プレイヤー向け）</option>
            <option value="hint">ヒント</option>
            <option value="faq">FAQ（よくある質問）</option>
            <option value="survey">アンケート</option>
            <option value="location">チェックイン履歴</option>
          </select>
          <span className="text-[11px] text-gray-400">
            ※モードによって編集 UI とプレイヤー表示が切り替わります
          </span>
        </div>

        <div className="mb-3">
          <label className={labelCls}>LIFFページタイトル</label>
          <input
            className={inputCls}
            value={config.title ?? ""}
            onChange={(e) => onLocalChange({ title: e.target.value || null })}
            disabled={readOnly}
            placeholder={
              isHint   ? "例: 都市奇譚ヒントサイト"
              : isFaq    ? "例: よくある質問"
              : isSurvey ? "例: ご感想アンケート"
              : mode === "location" ? "例: マイチェックイン履歴"
              : "例: 謎解き探偵ゲーム"
            }
          />
        </div>
        <div>
          <label className={labelCls}>説明</label>
          <input
            className={inputCls}
            value={config.description ?? ""}
            onChange={(e) => onLocalChange({ description: e.target.value || null })}
            disabled={readOnly}
            placeholder="任意の説明文"
          />
        </div>
      </div>

      {isFaq && (
        <LiffFaqEditor
          settings={settings}
          readOnly={readOnly}
          onChange={(patch) => onLocalChange({ settings_json: { ...settings, ...patch } })}
        />
      )}

      {isSurvey && (
        <LiffSurveyEditor
          settings={settings}
          readOnly={readOnly}
          onChange={(patch) => onLocalChange({ settings_json: { ...settings, ...patch } })}
        />
      )}

      {mode === "location" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">チェックイン履歴モード</h2>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            このページではプレイヤーが自分のチェックイン履歴を確認できます。<br />
            ※ 履歴の取得 API は次回 PR で実装予定です。現状ではプレースホルダーが表示されます。
          </p>
        </div>
      )}

      {isHint && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">ヒントサイト ヘッダー設定</h2>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.header_fixed !== false}
              onChange={(e) => updateSetting("header_fixed", e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            ヘッダーを固定する
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ロゴ画像URL</label>
              <input
                className={inputCls}
                value={settings.header_logo_url ?? ""}
                onChange={(e) => updateSetting("header_logo_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className={labelCls}>ロゴ alt テキスト</label>
              <input
                className={inputCls}
                value={settings.header_logo_alt ?? ""}
                onChange={(e) => updateSetting("header_logo_alt", e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CTA ラベル</label>
              <input
                className={inputCls}
                value={settings.header_cta_label ?? ""}
                onChange={(e) => updateSetting("header_cta_label", e.target.value)}
                disabled={readOnly}
                placeholder="チケットを購入する"
              />
            </div>
            <div>
              <label className={labelCls}>CTA URL</label>
              <input
                className={inputCls}
                value={settings.header_cta_url ?? ""}
                onChange={(e) => updateSetting("header_cta_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.show_hamburger ?? false}
              onChange={(e) => updateSetting("show_hamburger", e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            ハンバーガーメニュー枠を表示する（中身は将来拡張）
          </label>

          {/* ネタバレ注意はブロック単位 (Warning ブロック) でのみ管理する。
              旧 settings.spoiler_warning_text の値は表示・編集 UI からは外したが、
              既存データ互換のため保存ロジックでは引き続き許容される。 */}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ヘッダー背景色（CSS color）</label>
              <input
                className={inputCls}
                value={settings.theme?.header_bg ?? ""}
                onChange={(e) => updateSetting("theme", { ...(settings.theme ?? {}), header_bg: e.target.value })}
                disabled={readOnly}
                placeholder="#06C755"
              />
              <p className="text-[11px] text-gray-400 mt-1">未設定時は LINE Green (#06C755) が適用されます。</p>
            </div>
            <div>
              <label className={labelCls}>ヘッダー文字色</label>
              <input
                className={inputCls}
                value={settings.theme?.header_fg ?? ""}
                onChange={(e) => updateSetting("theme", { ...(settings.theme ?? {}), header_fg: e.target.value })}
                disabled={readOnly}
                placeholder="#000000"
              />
              <p className="text-[11px] text-gray-400 mt-1">未設定時は #000000 が適用されます。</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
