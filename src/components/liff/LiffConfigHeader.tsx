"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + page_type 切替 + ヒントサイト用ヘッダー設定
//
// 入力欄の onChange は API を直接呼ばず、すべて onLocalChange (= draft 更新) に集約する。
// 実 API 保存は最下部「すべての変更を保存」(useLiffConfig.saveAll = 一括保存) に任せる。

import type { LiffPageConfig, LiffPageConfigSettings, LiffPageType, LiffPublishStatus } from "@/types";
import { normalizeLiffPageType } from "@/types";
import { LiffFaqEditor } from "./LiffFaqEditor";
import { LiffHintSearchEditor } from "./LiffHintSearchEditor";
import { LiffSurveyEditor } from "./LiffSurveyEditor";
import { LiffContactEditor } from "./LiffContactEditor";
import { LiffPuzzleEditor } from "./LiffPuzzleEditor";
import { ImageUploadField } from "./ImageUploadField";
import { Switch } from "@/components/Switch";

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
  const isHintSearch = mode === "hint_search";
  const isSurvey = mode === "survey";
  const isContact = mode === "contact";
  const isPuzzle = mode === "puzzle";

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  const updateSetting = (key: keyof LiffPageConfigSettings, value: unknown) => {
    onLocalChange({ settings_json: { ...settings, [key]: value } });
  };

  // 公開状態の変更は LINE プレイヤーから即時影響を受けるため、必ず確認ダイアログを挟む。
  // 既存にプロジェクト固有のモーダルが無いため window.confirm の最小実装で十分。
  const handlePublishStatusChange = (next: LiffPublishStatus) => {
    if (next === config.publish_status) return;
    const msg =
      next === "published" ? "このLIFFページを公開しますか？プレイヤーが閲覧できる状態になります。" :
      next === "draft"     ? "このLIFFページを下書きに戻しますか？公開中の場合、プレイヤーから見えなくなる可能性があります。" :
      next === "archived"  ? "このLIFFページをアーカイブしますか？通常の一覧やプレイヤー表示から除外される可能性があります。" :
      "状態を変更しますか？";
    if (typeof window !== "undefined" && !window.confirm(msg)) {
      return;
    }
    onUpdatePublishStatus(next);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">LIFF設定</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={config.publish_status}
            onChange={(e) => {
              // select の onChange はキャンセル時に表示値だけ巻き戻したいので、
              // currentTarget.value を元に戻したうえで handlePublishStatusChange に委譲する
              const next = e.target.value as LiffPublishStatus;
              e.currentTarget.value = config.publish_status;
              handlePublishStatusChange(next);
            }}
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
            style={{ background: config.is_enabled ? "var(--color-brand)" : "#d1d5db" }}
          >
            <div
              className="absolute top-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]"
              style={{ left: config.is_enabled ? 24 : 2 }}
            />
          </button>
        </div>
      </div>

      {/* ページ設定 — ページ種別 / ページタイトル / ヘッダータイトル / 説明 / フォント / 説明文の配置。
          ・ページタイトル(config.title): プレビュー本文・カードに出るタイトル（プレビュー上の「新規ページ」に対応）。
          ・ヘッダータイトル(settings.header_title): LIFF 画面上部ヘッダーのタイトル（別項目）。 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">ページ設定</h2>

        {/* 1. ページ種別 */}
        <div>
          <label className={labelCls}>ページ種別</label>
          <select
            // 表示上は "hint" を選択状態として正規化する（旧 "hint_site" 互換）
            value={mode}
            onChange={(e) => onUpdatePageType(e.target.value as LiffPageType)}
            disabled={readOnly}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="default">デフォルト</option>
            <option value="hint">ヒント</option>
            <option value="hint_search">ヒント（キーワード検索型）</option>
            <option value="faq">FAQ（よくある質問）</option>
            <option value="survey">アンケート</option>
            <option value="contact">お問い合わせ</option>
            <option value="character">キャラクター</option>
            <option value="puzzle">謎・問題</option>
            <option value="werewolf">人狼（配役閲覧）</option>
            {/* 「チェックイン履歴」はページ種別から廃止し、ブロックとして追加できるようにした。
                ただし既存データ（pageType="location"）を壊さないため、既にこの種別のページだけは
                旧種別を選択肢として残し表示する（自動移行はしない＝保存時も書き換えない）。 */}
            {mode === "location" && (
              <option value="location">チェックイン履歴（旧・ページ種別）</option>
            )}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">※モードによって編集 UI とプレイヤー表示が切り替わります</p>
          {mode === "location" && (
            <p className="text-[11px] text-amber-600 mt-1">
              「チェックイン履歴」はページ種別から「チェックイン履歴ブロック」へ移行しました。今後は「デフォルト」に切り替え、表示ブロックから「チェックイン履歴」を追加してください（このページは現状のまま表示できます）。
            </p>
          )}
        </div>

        {/* 2. ページタイトル — プレビュー本文・カードに表示されるタイトル（config.title）。
            ヘッダータイトル（画面上部）とは別項目。任意入力。未入力でも既存のフォールバック挙動を維持し、
            既存値は勝手に空で上書きしない（onChange はユーザー入力時のみ発火）。 */}
        <div>
          <label className={labelCls}>ページタイトル</label>
          <input
            className={inputCls}
            value={config.title ?? ""}
            onChange={(e) => onLocalChange({ title: e.target.value || null })}
            disabled={readOnly}
            placeholder="例: 新規ページ"
            maxLength={10}
          />
          {(() => {
            const len = (config.title ?? "").length;
            const over = len > 10;
            return (
              <p className={`text-[11px] mt-1 ${over ? "text-red-600" : "text-gray-400"}`}>
                ページ本文・メニューカードに表示されるタイトルです（最大 10 文字・現在 {len}/10）。
                {over && " 10 文字以内にしてください。"}
              </p>
            );
          })()}
        </div>

        {/* 3. ヘッダータイトル */}
        <div>
          <label className={labelCls}>ヘッダータイトル</label>
          <input
            className={inputCls}
            value={settings.header_title ?? ""}
            onChange={(e) => updateSetting("header_title", e.target.value)}
            disabled={readOnly}
            placeholder="例: チェックイン / 設定資料 / ご案内"
            maxLength={30}
          />
          <p className="text-[11px] text-gray-400 mt-1">LIFF 画面上部に表示されるタイトルです。未設定時は作品名が使われます。</p>
        </div>

        {/* 4. 説明 */}
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

        {/* 5-6. フォント / 説明文の配置 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>フォント</label>
            <select
              className={inputCls}
              value={settings.font_preset ?? (settings.font_family === "mincho" ? "serif" : "line_seed_jp")}
              onChange={(e) =>
                updateSetting("font_preset", e.target.value as "line_seed_jp" | "system_sans" | "noto_sans_jp" | "serif")
              }
              disabled={readOnly}
            >
              <option value="line_seed_jp">LINE Seed JP（既定）</option>
              <option value="system_sans">System Sans</option>
              <option value="noto_sans_jp">Noto Sans JP</option>
              <option value="serif">Serif（明朝）</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">LIFF 画面全体の本文フォントです。未設定は LINE Seed JP。</p>
          </div>
          <div>
            <label className={labelCls}>説明文の配置</label>
            <select
              className={inputCls}
              value={settings.description_align ?? "center"}
              onChange={(e) => updateSetting("description_align", e.target.value as "left" | "center" | "right")}
              disabled={readOnly}
            >
              <option value="left">左寄せ</option>
              <option value="center">中央寄せ（既定）</option>
              <option value="right">右寄せ</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">description テキストの揃え。未設定は中央寄せ。</p>
          </div>
        </div>

        {/* シェアボタン設定は廃止（LIFF プレイヤーのシェアボタンも表示しない）。
            既存 settings.share_enabled / share_message は無視（後方互換・非破壊）。 */}
      </div>

      {/* ホームに表示する — 表示有無(トグル) + カード名のみ。並び順・絵文字は「LIFF設定 → ホーム」タブで管理する。
          （menu_order / menu_icon の入力は UI から除外。既存 settings_json の値は保存時に保持される） */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">ホームに表示する</h2>

        <div className="flex items-center gap-2.5">
          <Switch
            checked={settings.show_in_menu !== false}
            onChange={(v) => updateSetting("show_in_menu", v)}
            disabled={readOnly}
            ariaLabel="ホームに表示する"
          />
          <span className="text-sm text-gray-700">このページをホームに表示する</span>
        </div>
        <p className="text-[11px] text-gray-400 -mt-1">
          OFF にすると、作品ホーム (`/liff/w/...`) のカード一覧から除外されます。個別 URL (`.../p/...`) を直接開いた場合の表示は維持されます。
        </p>

        <div>
          <label className={labelCls}>カード名（メニューに表示）</label>
          <input
            className={inputCls}
            value={settings.menu_label ?? ""}
            onChange={(e) => updateSetting("menu_label", e.target.value)}
            disabled={readOnly}
            placeholder={
              mode === "hint"      ? "例: ヒント"
              : mode === "location"  ? "例: ロケーション"
              : mode === "survey"    ? "例: アンケート"
              : mode === "character" ? "例: キャラクター"
              : mode === "faq"       ? "例: FAQ"
              : mode === "hint_search" ? "例: ヒント"
              : "例: メニュー"
            }
            maxLength={30}
          />
          <p className="text-[11px] text-gray-400 mt-1">未設定時はページ種別の既定名にフォールバック。並び順・表示形式は「LIFF設定 → ホーム」タブで調整できます。</p>
        </div>
      </div>

      {isHintSearch && (
        <LiffHintSearchEditor
          settings={settings}
          readOnly={readOnly}
          onChange={(patch) => onLocalChange({ settings_json: { ...settings, ...patch } })}
        />
      )}

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

      {isContact && (
        <LiffContactEditor
          settings={settings}
          readOnly={readOnly}
          onChange={(patch) => onLocalChange({ settings_json: { ...settings, ...patch } })}
        />
      )}

      {isPuzzle && (
        <LiffPuzzleEditor
          settings={settings}
          readOnly={readOnly}
          onChange={(patch) => onLocalChange({ settings_json: { ...settings, ...patch } })}
        />
      )}

      {mode === "location" && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">チェックイン履歴モード（旧ページ種別）</h2>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            このページではプレイヤー本人のチェックイン履歴を表示します（現状のまま動作します）。<br />
            「チェックイン履歴」はページ種別から<strong>ブロック</strong>へ移行しました。今後は「デフォルト」に切り替え、表示ブロックから「チェックイン履歴」を追加する構成を推奨します。
          </p>
        </div>
      )}

      {isHint && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-4">
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
            <ImageUploadField
              label="ロゴ画像"
              value={settings.header_logo_url}
              onChange={(url) => updateSetting("header_logo_url", url)}
              readOnly={readOnly}
              previewAlt={settings.header_logo_alt || "ロゴプレビュー"}
              previewMaxHeight={80}
            />
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

          {/* 廃止済み:
              - CTA ラベル / CTA URL (header_cta_label / header_cta_url)
              - ハンバーガーメニュー枠 (show_hamburger)
              - ネタバレ注意帯 (spoiler_warning_text)
              既存データ互換のため型・Zod では引き続き optional 残置するが、UI からは外し、レンダラーも参照しない。 */}

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
                placeholder="#ffffff"
              />
              <p className="text-[11px] text-gray-400 mt-1">未設定時は #ffffff が適用されます。</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
