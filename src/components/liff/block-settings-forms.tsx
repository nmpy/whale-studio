"use client";

// src/components/liff/block-settings-forms.tsx
// ブロックタイプごとの設定フォーム

import type {
  LiffBlockType,
  FreeTextSettings,
  StartButtonSettings,
  ResumeButtonSettings,
  ProgressSettings,
  EvidenceListSettings,
  HintListSettings,
  CharacterListSettings,
  ImageBlockSettings,
  VideoBlockSettings,
} from "@/types";

type FieldProps<T> = {
  settings: T;
  onChange: (s: T) => void;
  readOnly?: boolean;
};

// ── 共通 input スタイル ──────────────────────────
const inputClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:bg-gray-50 disabled:text-gray-500";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const selectClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50";

// ── FreeText ─────────────────────────────────────
export function FreeTextForm({ settings, onChange, readOnly }: FieldProps<FreeTextSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>本文</label>
        <textarea
          className={inputClass}
          rows={4}
          value={settings.body ?? ""}
          onChange={(e) => onChange({ ...settings, body: e.target.value })}
          disabled={readOnly}
          placeholder="自由テキストを入力..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>配置</label>
          <select
            className={selectClass}
            value={settings.align ?? "left"}
            onChange={(e) => onChange({ ...settings, align: e.target.value as "left" | "center" })}
            disabled={readOnly}
          >
            <option value="left">左揃え</option>
            <option value="center">中央揃え</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>強調</label>
          <select
            className={selectClass}
            value={settings.emphasis ?? "normal"}
            onChange={(e) => onChange({ ...settings, emphasis: e.target.value as "normal" | "strong" })}
            disabled={readOnly}
          >
            <option value="normal">通常</option>
            <option value="strong">強調</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── StartButton ──────────────────────────────────
export function StartButtonForm({ settings, onChange, readOnly }: FieldProps<StartButtonSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ボタンラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="謎解きを始める"
        />
      </div>
      <div>
        <label className={labelClass}>確認メッセージ（任意）</label>
        <input
          className={inputClass}
          value={settings.confirm_message ?? ""}
          onChange={(e) => onChange({ ...settings, confirm_message: e.target.value })}
          disabled={readOnly}
          placeholder="本当に開始しますか？"
        />
      </div>
    </div>
  );
}

// ── ResumeButton ─────────────────────────────────
export function ResumeButtonForm({ settings, onChange, readOnly }: FieldProps<ResumeButtonSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ボタンラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="途中から再開する"
        />
      </div>
    </div>
  );
}

// ── Progress ─────────────────────────────────────
export function ProgressForm({ settings, onChange, readOnly }: FieldProps<ProgressSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示形式</label>
        <select
          className={selectClass}
          value={settings.display_format ?? "bar"}
          onChange={(e) => onChange({ ...settings, display_format: e.target.value as "bar" | "text" })}
          disabled={readOnly}
        >
          <option value="bar">プログレスバー</option>
          <option value="text">テキスト</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_denominator ?? true}
          onChange={(e) => onChange({ ...settings, show_denominator: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        分母を表示する
      </label>
    </div>
  );
}

// ── EvidenceList ─────────────────────────────────
export function EvidenceListForm({ settings, onChange, readOnly }: FieldProps<EvidenceListSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示上限件数</label>
        <input
          className={inputClass}
          type="number"
          min={1}
          max={100}
          value={settings.max_display_count ?? 10}
          onChange={(e) => onChange({ ...settings, max_display_count: Number(e.target.value) })}
          disabled={readOnly}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.hide_undiscovered ?? false}
          onChange={(e) => onChange({ ...settings, hide_undiscovered: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        未取得の証拠を非表示にする
      </label>
      <div>
        <label className={labelClass}>空状態の文言</label>
        <input
          className={inputClass}
          value={settings.empty_message ?? ""}
          onChange={(e) => onChange({ ...settings, empty_message: e.target.value })}
          disabled={readOnly}
          placeholder="まだ証拠はありません"
        />
      </div>
    </div>
  );
}

// ── HintList ─────────────────────────────────────
export function HintListForm({ settings, onChange, readOnly }: FieldProps<HintListSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示上限件数</label>
        <input
          className={inputClass}
          type="number"
          min={1}
          max={100}
          value={settings.max_display_count ?? 10}
          onChange={(e) => onChange({ ...settings, max_display_count: Number(e.target.value) })}
          disabled={readOnly}
        />
      </div>
      <div>
        <label className={labelClass}>空状態の文言</label>
        <input
          className={inputClass}
          value={settings.empty_message ?? ""}
          onChange={(e) => onChange({ ...settings, empty_message: e.target.value })}
          disabled={readOnly}
          placeholder="ヒントはまだありません"
        />
      </div>
    </div>
  );
}

// ── CharacterList ────────────────────────────────
export function CharacterListForm({ settings, onChange, readOnly }: FieldProps<CharacterListSettings>) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_icon ?? true}
          onChange={(e) => onChange({ ...settings, show_icon: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        アイコンを表示する
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={settings.show_description ?? true}
          onChange={(e) => onChange({ ...settings, show_description: e.target.checked })}
          disabled={readOnly}
          className="rounded border-gray-300"
        />
        説明を表示する
      </label>
    </div>
  );
}

// ── Image ────────────────────────────────────────
export function ImageBlockForm({ settings, onChange, readOnly }: FieldProps<ImageBlockSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>画像URL</label>
        <input
          className={inputClass}
          value={settings.image_url ?? ""}
          onChange={(e) => onChange({ ...settings, image_url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className={labelClass}>alt テキスト</label>
        <input
          className={inputClass}
          value={settings.alt ?? ""}
          onChange={(e) => onChange({ ...settings, alt: e.target.value })}
          disabled={readOnly}
        />
      </div>
      <div>
        <label className={labelClass}>キャプション</label>
        <input
          className={inputClass}
          value={settings.caption ?? ""}
          onChange={(e) => onChange({ ...settings, caption: e.target.value })}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

// ── Video ────────────────────────────────────────
export function VideoBlockForm({ settings, onChange, readOnly }: FieldProps<VideoBlockSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>動画URL</label>
        <input
          className={inputClass}
          value={settings.video_url ?? ""}
          onChange={(e) => onChange({ ...settings, video_url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className={labelClass}>ポスター画像URL</label>
        <input
          className={inputClass}
          value={settings.poster_url ?? ""}
          onChange={(e) => onChange({ ...settings, poster_url: e.target.value })}
          disabled={readOnly}
          placeholder="https://..."
        />
      </div>
      <div>
        <label className={labelClass}>キャプション</label>
        <input
          className={inputClass}
          value={settings.caption ?? ""}
          onChange={(e) => onChange({ ...settings, caption: e.target.value })}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

// ── Settings Form ルーター（レジストリベース） ──
import { getBlockEntry } from "./block-type-registry";

export function BlockSettingsForm({
  blockType,
  settings,
  onChange,
  readOnly,
}: {
  blockType: LiffBlockType;
  settings: Record<string, unknown>;
  onChange: (s: Record<string, unknown>) => void;
  readOnly?: boolean;
}) {
  const entry = getBlockEntry(blockType);
  if (!entry) return <p className="text-sm text-gray-400">不明なブロックタイプです</p>;

  const { SettingsForm } = entry;
  return <SettingsForm settings={settings} onChange={onChange} readOnly={readOnly} />;
}
