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
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
  CodeReaderSettings,
  NestedLiffBlock,
  LiffSectionVariant,
} from "@/types";
import { ImageUploadField } from "./ImageUploadField";
import { useLiffEditorData } from "./LiffEditorContext";
import { buildLiffPageUrl, buildLocationCheckinUrl } from "@/lib/liff/public-urls";

type FieldProps<T> = {
  settings: T;
  onChange: (s: T) => void;
  readOnly?: boolean;
};

const inputClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const selectClass =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";

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
          placeholder="作品を始める"
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

export function ImageBlockForm({ settings, onChange, readOnly }: FieldProps<ImageBlockSettings>) {
  return (
    <div className="space-y-3">
      <ImageUploadField
        label="画像"
        value={settings.image_url}
        onChange={(url) => onChange({ ...settings, image_url: url })}
        readOnly={readOnly}
        previewAlt={settings.alt || "画像プレビュー"}
        previewMaxHeight={160}
      />
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
      <div>
        <label className={labelClass}>表示サイズ</label>
        <select
          className={selectClass}
          value={settings.size ?? "normal"}
          onChange={(e) => onChange({ ...settings, size: e.target.value as ImageBlockSettings["size"] })}
          disabled={readOnly}
        >
          <option value="normal">通常</option>
          <option value="wide">広め</option>
          <option value="full">画面いっぱい</option>
        </select>
      </div>
    </div>
  );
}

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
      <ImageUploadField
        label="ポスター画像（任意）"
        value={settings.poster_url}
        onChange={(url) => onChange({ ...settings, poster_url: url })}
        readOnly={readOnly}
        previewAlt="ポスター画像プレビュー"
      />
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

export function HeadingForm({ settings, onChange, readOnly }: FieldProps<HeadingSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>見出しテキスト</label>
        <input
          className={inputClass}
          value={settings.text ?? ""}
          onChange={(e) => onChange({ ...settings, text: e.target.value })}
          disabled={readOnly}
          placeholder="HINTを見る前に"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>レベル</label>
          <select
            className={selectClass}
            value={String(settings.level ?? 2)}
            onChange={(e) =>
              onChange({ ...settings, level: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })
            }
            disabled={readOnly}
          >
            <option value="1">H1（最大）</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
            <option value="4">H4</option>
            <option value="5">H5（最小）</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>太さ</label>
          <select
            className={selectClass}
            value={settings.font_weight ?? "bold"}
            onChange={(e) =>
              onChange({ ...settings, font_weight: e.target.value as "normal" | "medium" | "bold" })
            }
            disabled={readOnly}
          >
            <option value="normal">通常</option>
            <option value="medium">中太</option>
            <option value="bold">太字</option>
          </select>
        </div>
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
      </div>
    </div>
  );
}

export function TextForm({ settings, onChange, readOnly }: FieldProps<TextSettings>) {
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
          placeholder="本文を入力..."
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
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
          <label className={labelClass}>太さ</label>
          <select
            className={selectClass}
            value={settings.font_weight ?? (settings.emphasis === "strong" ? "bold" : "normal")}
            onChange={(e) =>
              onChange({ ...settings, font_weight: e.target.value as "normal" | "medium" | "bold" })
            }
            disabled={readOnly}
          >
            <option value="normal">通常</option>
            <option value="medium">中太</option>
            <option value="bold">太字</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>強調 (旧)</label>
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

export function WarningForm({ settings, onChange, readOnly }: FieldProps<WarningSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>注意文</label>
        <textarea
          className={inputClass}
          rows={3}
          value={settings.body ?? ""}
          onChange={(e) => onChange({ ...settings, body: e.target.value })}
          disabled={readOnly}
          placeholder="ネタバレ注意：このサイトではヒントが見られます。"
        />
      </div>
      <div>
        <label className={labelClass}>トーン</label>
        <select
          className={selectClass}
          value={settings.tone ?? "spoiler"}
          onChange={(e) => onChange({ ...settings, tone: e.target.value as WarningSettings["tone"] })}
          disabled={readOnly}
        >
          <option value="spoiler">スポイラー（黄）</option>
          <option value="info">情報（青）</option>
          <option value="danger">危険（赤）</option>
        </select>
      </div>
    </div>
  );
}

const BUTTON_PAGE_TYPE_LABELS: Record<string, string> = {
  default: "プレイヤー向け", hint: "ヒント", hint_site: "ヒント", faq: "FAQ",
  survey: "アンケート", location: "履歴", character: "キャラクター", werewolf: "人狼",
};
const BUTTON_CHECKIN_LABELS: Record<string, string> = {
  qr_only: "QR", gps_only: "GPS", gps_qr: "GPS+QR", beacon: "ビーコン",
};

export function ButtonLinkForm({ settings, onChange, readOnly }: FieldProps<ButtonLinkSettings>) {
  // 編集データ（同一作品の LIFFページ/ロケーション）。Provider が無い文脈では null → 外部URLのみ。
  const editor = useLiffEditorData();
  // 後方互換: link_type 未指定の既存データは external として扱う。
  const linkType: "external" | "liff_page" | "location" = settings.link_type ?? "external";

  const setLinkType = (next: "external" | "liff_page" | "location") => {
    // 既存 url は保持（external へ戻しても編集可能なまま）。タイプ外の id 参照だけクリア。
    onChange({
      ...settings,
      link_type: next,
      ...(next !== "liff_page" ? { liff_page_id: undefined } : {}),
      ...(next !== "location"  ? { location_id:  undefined } : {}),
    });
  };

  const selectPage = (id: string) => {
    const p = editor?.pages.find((x) => x.id === id);
    const url = p
      ? buildLiffPageUrl({ workId: editor?.workId, workPublicId: editor?.workPublicId, pageId: p.id, pagePublicId: p.public_id })
      : "";
    // url が解決できたときのみ url を更新（解決不可なら既存 url を保持）。
    onChange({ ...settings, link_type: "liff_page", liff_page_id: id || undefined, ...(url ? { url } : {}) });
  };

  const selectLocation = (id: string) => {
    const l = editor?.locations.find((x) => x.id === id);
    const url = l ? buildLocationCheckinUrl({ workPublicId: editor?.workPublicId, locationPublicId: l.public_id }) : "";
    onChange({ ...settings, link_type: "location", location_id: id || undefined, ...(url ? { url } : {}) });
  };

  // 選択済み参照が一覧に無い（削除済み等）かの判定。取得完了後のみ「見つからない」と断定する。
  const pageMissing = linkType === "liff_page" && !!settings.liff_page_id
    && (editor?.loaded ?? false) && !editor?.pages.some((p) => p.id === settings.liff_page_id);
  const locMissing = linkType === "location" && !!settings.location_id
    && (editor?.loaded ?? false) && !editor?.locations.some((l) => l.id === settings.location_id);

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>ラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="チケットを購入する"
        />
      </div>

      {/* 遷移先タイプ — 編集データがある場合のみ LIFFページ/ロケーションを選べる。 */}
      {editor && (
        <div>
          <label className={labelClass}>遷移先タイプ</label>
          <select
            className={selectClass}
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as "external" | "liff_page" | "location")}
            disabled={readOnly}
          >
            <option value="external">外部URL</option>
            <option value="liff_page">LIFFページ</option>
            <option value="location">ロケーション</option>
          </select>
        </div>
      )}

      {/* external（既存挙動。Provider が無い文脈でも常にこれを表示＝後方互換） */}
      {linkType === "external" && (
        <div>
          <label className={labelClass}>URL</label>
          <input
            className={inputClass}
            value={settings.url ?? ""}
            onChange={(e) => onChange({ ...settings, url: e.target.value })}
            disabled={readOnly}
            placeholder="https://..."
          />
        </div>
      )}

      {/* LIFFページ選択 */}
      {linkType === "liff_page" && editor && (
        <div>
          <label className={labelClass}>遷移先 LIFFページ</label>
          <select
            className={selectClass}
            value={settings.liff_page_id ?? ""}
            onChange={(e) => selectPage(e.target.value)}
            disabled={readOnly}
          >
            <option value="">選択してください</option>
            {editor.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.title?.trim() || "（無題）")}（{BUTTON_PAGE_TYPE_LABELS[p.page_type] ?? p.page_type}）
              </option>
            ))}
          </select>
          {pageMissing && (
            <p className="text-[12px] text-amber-700 mt-1">
              選択済みのページが見つかりません（削除された可能性があります）。{settings.url ? "現在のリンク先は保持されています。" : ""}
            </p>
          )}
          {settings.url && <p className="text-[11px] text-gray-400 mt-1 break-all">リンク先: {settings.url}</p>}
        </div>
      )}

      {/* ロケーション選択 */}
      {linkType === "location" && editor && (
        <div>
          <label className={labelClass}>遷移先ロケーション</label>
          <select
            className={selectClass}
            value={settings.location_id ?? ""}
            onChange={(e) => selectLocation(e.target.value)}
            disabled={readOnly}
          >
            <option value="">選択してください</option>
            {editor.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}{l.checkin_mode ? `（${BUTTON_CHECKIN_LABELS[l.checkin_mode] ?? l.checkin_mode}）` : ""}
              </option>
            ))}
          </select>
          {locMissing && (
            <p className="text-[12px] text-amber-700 mt-1">
              選択済みのロケーションが見つかりません（削除された可能性があります）。{settings.url ? "現在のリンク先は保持されています。" : ""}
            </p>
          )}
          {settings.url && <p className="text-[11px] text-gray-400 mt-1 break-all">リンク先: {settings.url}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>variant</label>
          <select
            className={selectClass}
            value={settings.variant ?? "default"}
            onChange={(e) => onChange({ ...settings, variant: e.target.value as LiffSectionVariant })}
            disabled={readOnly}
          >
            <option value="default">default</option>
            <option value="dark">dark</option>
            <option value="purple">purple</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
          <input
            type="checkbox"
            checked={settings.open_external ?? true}
            onChange={(e) => onChange({ ...settings, open_external: e.target.checked })}
            disabled={readOnly}
            className="rounded border-gray-300"
          />
          外部ブラウザで開く
        </label>
      </div>
    </div>
  );
}

export function DividerForm({ settings, onChange, readOnly }: FieldProps<DividerSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>スタイル</label>
        <select
          className={selectClass}
          value={settings.style ?? "solid"}
          onChange={(e) => onChange({ ...settings, style: e.target.value as "solid" | "dashed" })}
          disabled={readOnly}
        >
          <option value="solid">実線</option>
          <option value="dashed">点線</option>
        </select>
      </div>
    </div>
  );
}

export function CodeReaderForm({ settings, onChange, readOnly }: FieldProps<CodeReaderSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>表示ラベル</label>
        <input
          className={inputClass}
          value={settings.label ?? ""}
          onChange={(e) => onChange({ ...settings, label: e.target.value })}
          disabled={readOnly}
          placeholder="チェックインする"
        />
      </div>
      <div>
        <label className={labelClass}>モーダルタイトル</label>
        <input
          className={inputClass}
          value={settings.modal_title ?? ""}
          onChange={(e) => onChange({ ...settings, modal_title: e.target.value })}
          disabled={readOnly}
          placeholder="コードリーダー"
        />
      </div>
      <div>
        <label className={labelClass}>説明文（任意）</label>
        <input
          className={inputClass}
          value={settings.description ?? ""}
          onChange={(e) => onChange({ ...settings, description: e.target.value })}
          disabled={readOnly}
          placeholder="QRコードを読み取ってチェックインします"
        />
      </div>
      <div>
        <label className={labelClass}>読み取り後の動作</label>
        <select
          className={selectClass}
          value={settings.after_scan ?? "location_checkin"}
          onChange={(e) => onChange({ ...settings, after_scan: e.target.value as "location_checkin" | "show_result" })}
          disabled={readOnly}
        >
          <option value="location_checkin">ロケーションチェックイン</option>
          <option value="show_result">読み取り結果を表示</option>
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          ロケーションチェックイン: 読み取ったQRから既存のチェックイン画面へ進みます。
        </p>
      </div>
    </div>
  );
}

import { AccordionChildrenEditor } from "./AccordionChildrenEditor";

export function AccordionForm({ settings, onChange, readOnly }: FieldProps<AccordionSettings>) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>タイトル（必須）</label>
        <input
          className={inputClass}
          value={settings.title ?? ""}
          onChange={(e) => onChange({ ...settings, title: e.target.value })}
          disabled={readOnly}
          placeholder="1st STAGE.（無料エリア）"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>variant</label>
          <select
            className={selectClass}
            value={settings.variant ?? "default"}
            onChange={(e) => onChange({ ...settings, variant: e.target.value as LiffSectionVariant })}
            disabled={readOnly}
          >
            <option value="default">default（白）</option>
            <option value="dark">dark（黒）</option>
            <option value="purple">purple（紫）</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
          <input
            type="checkbox"
            checked={settings.default_open ?? false}
            onChange={(e) => onChange({ ...settings, default_open: e.target.checked })}
            disabled={readOnly}
            className="rounded border-gray-300"
          />
          初期状態で開く
        </label>
      </div>

      <div>
        <label className={labelClass}>子要素</label>
        <AccordionChildrenEditor
          items={settings.children ?? []}
          depth={1}
          readOnly={readOnly}
          onChange={(next) => onChange({ ...settings, children: next })}
        />
      </div>
    </div>
  );
}

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
