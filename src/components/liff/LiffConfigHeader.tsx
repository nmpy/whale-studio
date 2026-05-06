"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + page_type 切替 + ヒントサイト用ヘッダー設定

import type { LiffPageConfig, LiffPageConfigSettings, LiffPageType, LiffPublishStatus } from "@/types";

interface Props {
  config: LiffPageConfig;
  saving: boolean;
  readOnly: boolean;
  canPublish?: boolean;
  onToggleEnabled: () => void;
  onUpdateField: (field: "title" | "description", value: string | null) => void;
  onLocalChange: (patch: Partial<LiffPageConfig>) => void;
  onUpdateSettingsField: (key: keyof LiffPageConfigSettings, value: unknown) => void;
  onUpdatePageType: (next: LiffPageType) => void;
  onUpdatePublishStatus: (next: LiffPublishStatus) => void;
}

export function LiffConfigHeader({
  config, saving, readOnly, canPublish,
  onToggleEnabled, onUpdateField, onLocalChange,
  onUpdateSettingsField, onUpdatePageType, onUpdatePublishStatus,
}: Props) {
  const settings: LiffPageConfigSettings = config.settings_json ?? {};
  const isHintSite = config.page_type === "hint_site";

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

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
            value={config.page_type}
            onChange={(e) => onUpdatePageType(e.target.value as LiffPageType)}
            disabled={readOnly}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="default">既存LIFF（プレイヤー向け）</option>
            <option value="hint_site">ヒントサイト</option>
          </select>
          <span className="text-[11px] text-gray-400">
            ※「default」はGPS/QRや進捗表示などの従来機能、「hint_site」はSTAGE型ヒントページ
          </span>
        </div>

        <div className="mb-3">
          <label className={labelCls}>LIFFページタイトル</label>
          <input
            className={inputCls}
            value={config.title ?? ""}
            onChange={(e) => onLocalChange({ title: e.target.value || null })}
            onBlur={(e) => onUpdateField("title", e.target.value)}
            disabled={readOnly}
            placeholder={isHintSite ? "例: 都市奇譚ヒントサイト" : "例: 謎解き探偵ゲーム"}
          />
        </div>
        <div>
          <label className={labelCls}>説明</label>
          <input
            className={inputCls}
            value={config.description ?? ""}
            onChange={(e) => onLocalChange({ description: e.target.value || null })}
            onBlur={(e) => onUpdateField("description", e.target.value)}
            disabled={readOnly}
            placeholder="任意の説明文"
          />
        </div>
      </div>

      {isHintSite && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">ヒントサイト ヘッダー設定</h2>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.header_fixed !== false}
              onChange={(e) => onUpdateSettingsField("header_fixed", e.target.checked)}
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
                onChange={(e) => onUpdateSettingsField("header_logo_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className={labelCls}>ロゴ alt テキスト</label>
              <input
                className={inputCls}
                value={settings.header_logo_alt ?? ""}
                onChange={(e) => onUpdateSettingsField("header_logo_alt", e.target.value)}
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
                onChange={(e) => onUpdateSettingsField("header_cta_label", e.target.value)}
                disabled={readOnly}
                placeholder="チケットを購入する"
              />
            </div>
            <div>
              <label className={labelCls}>CTA URL</label>
              <input
                className={inputCls}
                value={settings.header_cta_url ?? ""}
                onChange={(e) => onUpdateSettingsField("header_cta_url", e.target.value)}
                disabled={readOnly}
                placeholder="https://..."
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.show_hamburger ?? false}
              onChange={(e) => onUpdateSettingsField("show_hamburger", e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300"
            />
            ハンバーガーメニュー枠を表示する（中身は将来拡張）
          </label>

          <div>
            <label className={labelCls}>ネタバレ注意帯テキスト</label>
            <input
              className={inputCls}
              value={settings.spoiler_warning_text ?? ""}
              onChange={(e) => onUpdateSettingsField("spoiler_warning_text", e.target.value)}
              disabled={readOnly}
              placeholder="ネタバレ注意：ここから先はヒントサイトです"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ヘッダー背景色（CSS color）</label>
              <input
                className={inputCls}
                value={settings.theme?.header_bg ?? ""}
                onChange={(e) => onUpdateSettingsField("theme", { ...(settings.theme ?? {}), header_bg: e.target.value })}
                disabled={readOnly}
                placeholder="#000000"
              />
            </div>
            <div>
              <label className={labelCls}>ヘッダー文字色</label>
              <input
                className={inputCls}
                value={settings.theme?.header_fg ?? ""}
                onChange={(e) => onUpdateSettingsField("theme", { ...(settings.theme ?? {}), header_fg: e.target.value })}
                disabled={readOnly}
                placeholder="#ffffff"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
