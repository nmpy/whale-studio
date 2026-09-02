"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + page_type 切替 + ヒントサイト用ヘッダー設定
//
// 入力欄の onChange は API を直接呼ばず、すべて onLocalChange (= draft 更新) に集約する。
// 実 API 保存は最下部「すべての変更を保存」(useLiffConfig.saveAll = 一括保存) に任せる。

import type {
  LiffColorMode, LiffFontScale, LiffFontTheme, LiffFontWeightLevel, LiffLayoutDensity,
  LiffPageConfig, LiffPageConfigSettings, LiffPageType, LiffPublishStatus,
  LiffAccordionHeaderSpacing, LiffDividerVisibility, LiffSpacingLevel, LiffTextColor,
  LiffCharacterSize, LiffCharacterPosition, LiffCharacterRendering,
} from "@/types";
import { normalizeLiffPageType } from "@/types";
import {
  resolveColorMode, resolveFontScale, resolveFontTheme, resolveFontWeightLevel,
  resolveHeadingScale, resolveHeadingWeightLevel, resolveLayoutDensity,
  resolveHomeBackButton, defaultHomeBackButton,
  resolveAccordionTitleScale, resolveAccordionHeaderSpacing,
  resolveBlockDivider, resolveAccordionDivider,
  resolveTitleScale, pageOwnsChrome,
  resolvePageMarginX, resolveBlockGap,
  resolveHeadingColor, resolveBodyColor,
  resolveCharacterSize, resolveCharacterPosition, resolveCharacterRendering, resolveCharacterFixed,
} from "./liff-style-helpers";
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
  // キャラクター詳細は URL が入っているときだけ出す（未設定なら描画されないため）。
  const resolveCharacterUrlSet = (settings.character_url ?? "").trim() !== "";
  const isSurvey = mode === "survey";
  const isContact = mode === "contact";
  const isPuzzle = mode === "puzzle";

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  const updateSetting = (key: keyof LiffPageConfigSettings, value: unknown) => {
    onLocalChange({ settings_json: { ...settings, [key]: value } });
  };

  // フォントは font_theme に一本化する。旧 font_preset / font_family が残っていると
  // 「読み込み時のフォールバック」として解決順に混ざり、後から見て何が効いているのか
  // 分からなくなるため、font_theme を保存するタイミングで旧キーを落とす。
  // （既存データを一括変換はしない = ページを編集して保存したときだけ整理される）
  const handleFontThemeChange = (next: LiffFontTheme) => {
    const { font_preset: _dropPreset, font_family: _dropFamily, ...rest } = settings;
    onLocalChange({ settings_json: { ...rest, font_theme: next } });
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

        {/* 5-12. フォント / カラーモード / 本文・見出しの大きさと太さ / 余白 / 説明文の配置 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>フォント</label>
            <select
              className={inputCls}
              value={resolveFontTheme(settings)}
              onChange={(e) => handleFontThemeChange(e.target.value as LiffFontTheme)}
              disabled={readOnly}
            >
              <option value="default">既定（LINE Seed JP）</option>
              <option value="gothic">ゴシック（読みやすい標準）</option>
              <option value="rounded">丸ゴシック（やわらかい）</option>
              <option value="classic">クラシック（明朝・物語向け）</option>
              <option value="modern">モダン（すっきり）</option>
              <option value="dot">ドット（8bit / レトロゲーム風）</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">LIFF 画面全体の本文フォントです。未設定は既定（LINE Seed JP）。</p>
          </div>
          <div>
            <label className={labelCls}>カラーモード</label>
            <select
              className={inputCls}
              value={resolveColorMode(settings)}
              onChange={(e) => updateSetting("color_mode", e.target.value as LiffColorMode)}
              disabled={readOnly}
            >
              <option value="light">ライト（既定）</option>
              <option value="dark">ダーク（ディープ・ボルドー）</option>
              <option value="bordeaux">ボルドー × アイボリー</option>
              <option value="sepia">セピア（暖色）</option>
              <option value="terminal">ターミナル（黒 × 電子グリーン）</option>
              <option value="dot">ドット（黒背景）</option>
              <option value="system">システム（端末の設定に追従）</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">LIFF 画面全体の配色です。未設定はライト（現行の白ベース）。</p>
          </div>
          <div>
            <label className={labelCls}>本文の大きさ</label>
            <select
              className={inputCls}
              value={resolveFontScale(settings)}
              onChange={(e) => updateSetting("font_scale", e.target.value as LiffFontScale)}
              disabled={readOnly}
            >
              <option value="xs">さらに小さめ（約12px）</option>
              <option value="sm">小さめ（約13px）</option>
              <option value="md">標準（既定・14px）</option>
              <option value="lg">大きめ（約15px）</option>
              <option value="xl">特大（約16px）</option>
              <option value="xxl">超特大（約18px）</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">本文テキスト・説明文・注釈など、見出し以外の文字の大きさです。</p>
          </div>
          <div>
            <label className={labelCls}>本文の太さ</label>
            <select
              className={inputCls}
              value={resolveFontWeightLevel(settings)}
              onChange={(e) => updateSetting("font_weight_level", e.target.value as LiffFontWeightLevel)}
              disabled={readOnly}
            >
              <option value="light">細め</option>
              <option value="normal">標準（既定）</option>
              <option value="bold">太め</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              「細め」で本文を細くできるのは<strong>ゴシック / 丸ゴシック / クラシック / モダン</strong>を選んだときです。
              既定（LINE Seed JP）は 400 より軽い字面を持たないため、本文の太さは変わりません。
            </p>
          </div>
          <div>
            <label className={labelCls}>見出しの大きさ</label>
            <select
              className={inputCls}
              value={resolveHeadingScale(settings)}
              onChange={(e) => updateSetting("heading_scale", e.target.value as LiffFontScale)}
              disabled={readOnly}
            >
              <option value="xs">さらに小さめ</option>
              <option value="sm">小さめ</option>
              <option value="md">標準（既定）</option>
              <option value="lg">大きめ</option>
              <option value="xl">特大</option>
              <option value="xxl">超特大</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">ページタイトル・アコーディオンの見出し・見出しブロックの大きさです。</p>
          </div>
          {/* ticket_link / hint_search は renderer が自前の見出しを持ち、ページタイトルの h2 を
              描画しない = title_scale が効かない。効かない項目は出さない。 */}
          {!pageOwnsChrome(mode) && (
          <div>
            <label className={labelCls}>ページタイトルの大きさ</label>
            <select
              className={inputCls}
              // 未設定は "" (= 見出しの大きさに合わせる)。accordion_title_scale と同じ扱い。
              value={resolveTitleScale(settings) ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                updateSetting("title_scale", v === "" ? undefined : (v as LiffFontScale));
              }}
              disabled={readOnly}
            >
              <option value="">「見出しの大きさ」に合わせる（既定）</option>
              <option value="xs">さらに小さめ</option>
              <option value="sm">小さめ</option>
              <option value="md">標準で固定</option>
              <option value="lg">大きめ</option>
              <option value="xl">特大</option>
              <option value="xxl">超特大</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              ページタイトル<strong>だけ</strong>の大きさです。アコーディオン見出し・見出しブロックは動きません。
              「標準で固定」は、上の「見出しの大きさ」を変えてもタイトルだけ等倍に留めたいときに使います。
            </p>
          </div>
          )}
          <div>
            <label className={labelCls}>アコーディオン見出しの大きさ</label>
            <select
              className={inputCls}
              // 未設定は "" (= 見出しの大きさに合わせる)。他の項目と違い「未設定」自体が選択肢。
              value={resolveAccordionTitleScale(settings) ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                updateSetting("accordion_title_scale", v === "" ? undefined : (v as LiffFontScale));
              }}
              disabled={readOnly}
            >
              <option value="">「見出しの大きさ」に合わせる（既定）</option>
              <option value="xs">さらに小さめ</option>
              <option value="sm">小さめ</option>
              <option value="md">標準で固定</option>
              <option value="lg">大きめ</option>
              <option value="xl">特大</option>
              <option value="xxl">超特大</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              アコーディオンの見出し<strong>だけ</strong>の大きさです。ページタイトル・見出しブロックは動きません。
              「標準で固定」は、上の「見出しの大きさ」を変えてもアコーディオンだけ等倍に留めたいときに使います。
            </p>
          </div>
          <div>
            <label className={labelCls}>アコーディオン見出しの余白</label>
            <select
              className={inputCls}
              value={resolveAccordionHeaderSpacing(settings) ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                updateSetting("accordion_header_spacing", v === "" ? undefined : (v as LiffAccordionHeaderSpacing));
              }}
              disabled={readOnly}
            >
              <option value="">「余白の詰め具合」に従う（既定）</option>
              <option value="narrow">詰める</option>
              <option value="normal">標準で固定</option>
              <option value="wide">広げる</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              アコーディオン 1 項目の見出し行の高さ（上下の余白）です。本文側の余白と階層のインデント・ガイド線は変わりません。
              指定すると「余白の詰め具合」より優先します。
            </p>
          </div>
          {/* ページ隅のキャラクター画像。URL が空なら renderer は何も描画しないので、
              サイズ / 配置などの詳細は URL が入っているときだけ出す。 */}
          <div className="sm:col-span-2">
            <label className={labelCls}>キャラクター画像の URL</label>
            <input
              type="url"
              className={inputCls}
              value={settings.character_url ?? ""}
              onChange={(e) => updateSetting("character_url", e.target.value)}
              placeholder="https://res.cloudinary.com/..."
              disabled={readOnly}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              ページ上部の隅に置く装飾画像です。本文の位置は変わらず、画像の下のボタンもそのまま押せます。
              未入力なら何も表示しません。<strong>ドット絵は表示サイズに近い小さめ（32〜96px 程度）</strong>で用意してください。
            </p>
          </div>
          {resolveCharacterUrlSet && (
            <>
              <div>
                <label className={labelCls}>キャラクターの大きさ</label>
                <select
                  className={inputCls}
                  value={resolveCharacterSize(settings)}
                  onChange={(e) => updateSetting("character_size", e.target.value as LiffCharacterSize)}
                  disabled={readOnly}
                >
                  <option value="sm">小（48px）</option>
                  <option value="md">中（72px・既定）</option>
                  <option value="lg">大（96px）</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>キャラクターの配置</label>
                <select
                  className={inputCls}
                  value={resolveCharacterPosition(settings)}
                  onChange={(e) => updateSetting("character_position", e.target.value as LiffCharacterPosition)}
                  disabled={readOnly}
                >
                  <option value="top_right">右上（既定）</option>
                  <option value="top_left">左上</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  ページタイトルの反対側に置くと文字と重なりません。
                </p>
              </div>
              <div>
                <label className={labelCls}>画像の拡大縮小</label>
                <select
                  className={inputCls}
                  value={resolveCharacterRendering(settings)}
                  onChange={(e) => updateSetting("character_rendering", e.target.value as LiffCharacterRendering)}
                  disabled={readOnly}
                >
                  <option value="pixelated">ドット絵向け（既定）</option>
                  <option value="smooth">なめらか（写真・イラスト）</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>スクロール時の固定</label>
                <select
                  className={inputCls}
                  value={resolveCharacterFixed(settings) ? "fixed" : "scroll"}
                  onChange={(e) => updateSetting("character_fixed", e.target.value === "fixed")}
                  disabled={readOnly}
                >
                  <option value="scroll">一緒にスクロールする（既定）</option>
                  <option value="fixed">画面に固定する</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  固定すると実機 LIFF の <strong>LINE 標準ヘッダーと重なる可能性</strong>があります。
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>画像の説明（代替テキスト）</label>
                <input
                  type="text"
                  className={inputCls}
                  value={settings.character_alt ?? ""}
                  onChange={(e) => updateSetting("character_alt", e.target.value)}
                  placeholder="未入力なら装飾として扱います"
                  disabled={readOnly}
                />
              </div>
            </>
          )}
          <div>
            <label className={labelCls}>見出しの色</label>
            <select
              className={inputCls}
              value={resolveHeadingColor(settings)}
              onChange={(e) => updateSetting("heading_color", e.target.value as LiffTextColor)}
              disabled={readOnly}
            >
              <option value="default">既定（カラーモードに従う）</option>
              <option value="white">白</option>
              <option value="red">赤</option>
              <option value="green">緑</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              ページタイトル・アコーディオンの見出し・見出しブロックの色です。
              赤 / 緑は背景の明暗に合わせて自動で濃さが変わります。
              <strong>白は明るい背景のカラーモードでは読めなくなります</strong>のでご注意ください。
            </p>
          </div>
          <div>
            <label className={labelCls}>本文の色</label>
            <select
              className={inputCls}
              value={resolveBodyColor(settings)}
              onChange={(e) => updateSetting("body_color", e.target.value as LiffTextColor)}
              disabled={readOnly}
            >
              <option value="default">既定（カラーモードに従う）</option>
              <option value="white">白</option>
              <option value="red">赤</option>
              <option value="green">緑</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              本文ブロック・アコーディオンの本文の色です。赤 / 緑は背景の明暗に合わせて自動で濃さが変わります。
            </p>
          </div>
          <div>
            <label className={labelCls}>画面左右の余白</label>
            <select
              className={inputCls}
              value={resolvePageMarginX(settings)}
              onChange={(e) => updateSetting("page_margin_x", e.target.value as LiffSpacingLevel)}
              disabled={readOnly}
            >
              <option value="narrow">狭い</option>
              <option value="normal">標準（既定）</option>
              <option value="wide">広い</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              本文の左右の余白です（既定 16px）。狭くすると 1 行に入る文字数が増えます。
            </p>
          </div>
          <div>
            <label className={labelCls}>ブロック間の余白</label>
            <select
              className={inputCls}
              value={resolveBlockGap(settings)}
              onChange={(e) => updateSetting("block_gap", e.target.value as LiffSpacingLevel)}
              disabled={readOnly}
            >
              <option value="narrow">狭い</option>
              <option value="normal">標準（既定）</option>
              <option value="wide">広い</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              ブロックとブロックの縦の間隔です。指定すると「余白の詰め具合」より優先します。
            </p>
          </div>
          <div>
            <label className={labelCls}>ブロック間の横線</label>
            <select
              className={inputCls}
              value={resolveBlockDivider(settings)}
              onChange={(e) => updateSetting("block_divider", e.target.value as LiffDividerVisibility)}
              disabled={readOnly}
            >
              <option value="show">表示する（既定）</option>
              <option value="hide">表示しない</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              ブロックとブロックの間に自動で入る横線です。消しても余白は残ります。「区切り線ブロック」は対象外です。
            </p>
          </div>
          <div>
            <label className={labelCls}>アコーディオンの横線</label>
            <select
              className={inputCls}
              value={resolveAccordionDivider(settings)}
              onChange={(e) => updateSetting("accordion_divider", e.target.value as LiffDividerVisibility)}
              disabled={readOnly}
            >
              <option value="show">表示する（既定）</option>
              <option value="hide">表示しない</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              アコーディオン 1 項目ごとの行区切り線です。項目の高さ・余白は変わりません。
              階層を示す<strong>縦のガイド線</strong>は消えません（消すとネスト構造が読めなくなるため）。
            </p>
          </div>
          <div>
            <label className={labelCls}>見出しの太さ</label>
            <select
              className={inputCls}
              value={resolveHeadingWeightLevel(settings)}
              onChange={(e) => updateSetting("heading_weight", e.target.value as LiffFontWeightLevel)}
              disabled={readOnly}
            >
              <option value="light">細め</option>
              <option value="normal">標準（既定）</option>
              <option value="bold">太め</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              階層差（親見出し / 子見出し）は保ったまま、段階だけずらします。見出しブロックの個別指定はその中での相対指定になります。
            </p>
          </div>
          <div>
            <label className={labelCls}>余白</label>
            <select
              className={inputCls}
              value={resolveLayoutDensity(settings)}
              onChange={(e) => updateSetting("layout_density", e.target.value as LiffLayoutDensity)}
              disabled={readOnly}
            >
              <option value="normal">標準（既定）</option>
              <option value="compact">コンパクト（項目を詰める）</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              アコーディオン 1 項目の高さ・本文の行間・ブロック間の余白を詰めます。階層のインデントは変わりません。
            </p>
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
          <div>
            <label className={labelCls}>「ホームに戻る」ボタン</label>
            {/* ここだけ select ではなくラジオ。ページ種別によって既定が違う（検索型ヒントのみ表示）ため、
                どちらが既定かをその場で読めるようにしている。 */}
            <div className="flex items-center gap-4 mt-1">
              {(["show", "hide"] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="home_back_button"
                    value={v}
                    checked={resolveHomeBackButton(settings, mode) === v}
                    onChange={() => updateSetting("home_back_button", v)}
                    disabled={readOnly}
                  />
                  <span>
                    {v === "show" ? "表示する" : "表示しない"}
                    {defaultHomeBackButton(mode) === v && "（既定）"}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              プレイヤー画面の上部に出す「← ホームに戻る」導線です。押すと作品のメニューホームに移動します。
              <strong>ホームに何も登録していない場合は「表示しない」</strong>にしてください（空のページに飛んでしまうため）。
            </p>
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
