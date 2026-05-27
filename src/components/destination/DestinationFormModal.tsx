"use client";

// src/components/destination/DestinationFormModal.tsx
// destination 追加・編集モーダル。
// リアルタイム URL プレビュー + テンプレート候補 + query params 編集。
//
// Phase 4.2c: UI を Phase 0 トークン + shared/Button + compactInputClass に揃える。
// useDestinations / destinationApi / destinations/page.tsx / DestinationListItem /
// resolveDestinationUrl 本体には触らない。
// payload 8 キー (key/name/description/destination_type/liff_target_type/
// url_or_path/query_params_json/is_enabled) / 順序 / null 処理 / 条件分岐 /
// 空キー除外 / key 入力正規化 / canSubmit / applyTemplate / 編集時初期化 /
// onSave→成功時 onClose / オーバーレイクリック close + 内側 stopPropagation /
// TEMPLATES 中身・全文言は完全維持。

import { useState, useEffect } from "react";
import { QueryParamsEditor } from "./QueryParamsEditor";
import { DestinationUrlPreview } from "./DestinationUrlPreview";
import { Button } from "@/components/shared";
import type { LineDestination, DestinationType, LiffTargetType } from "@/types";
import type { DestinationFormData } from "@/hooks/useDestinations";

// ── テンプレート候補 ─────────────────────────────
const TEMPLATES: { key: string; name: string; desc: string; type: DestinationType; liffTarget: LiffTargetType; params: Record<string, string> }[] = [
  { key: "start",    name: "開始画面",     desc: "リッチメニューの「はじめる」",       type: "liff", liffTarget: "work_main", params: { entry: "richmenu" } },
  { key: "evidence", name: "証拠一覧",     desc: "証拠確認ページ",                     type: "liff", liffTarget: "work_main", params: { tab: "evidence" } },
  { key: "progress", name: "進捗表示",     desc: "クリア進捗の確認",                   type: "liff", liffTarget: "work_main", params: { tab: "progress" } },
  { key: "profile",  name: "プロフィール", desc: "ユーザー情報ページ",                 type: "liff", liffTarget: "work_main", params: {} },
];

// ── ローカル共通: 必須マーク (= /account / works edit と同じパターン) ──
function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-danger">*</span>;
}

// ── 共通スタイル: 行内 input / select (= Phase 3.1 compactInputClass) ──
const compactInputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

interface Props {
  workId: string;
  saving: boolean;
  /** 編集時は既存データ。新規なら null */
  editingDestination: LineDestination | null;
  onSave: (data: DestinationFormData, editingId: string | null) => Promise<boolean>;
  onClose: () => void;
}

export function DestinationFormModal({ workId, saving, editingDestination, onSave, onClose }: Props) {
  const isEditing = !!editingDestination;

  // ── Form state ──
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [destType, setDestType] = useState<DestinationType>("liff");
  const [liffTarget, setLiffTarget] = useState<LiffTargetType>("work_main");
  const [urlOrPath, setUrlOrPath] = useState("");
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);

  // 編集時に初期値をセット
  useEffect(() => {
    if (editingDestination) {
      setKey(editingDestination.key);
      setName(editingDestination.name);
      setDesc(editingDestination.description ?? "");
      setDestType(editingDestination.destination_type);
      setLiffTarget(editingDestination.liff_target_type ?? "work_main");
      setUrlOrPath(editingDestination.url_or_path ?? "");
      setQueryParams(editingDestination.query_params_json ?? {});
      setEnabled(editingDestination.is_enabled);
    }
  }, [editingDestination]);

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setKey(t.key);
    setName(t.name);
    setDesc(t.desc);
    setDestType(t.type);
    setLiffTarget(t.liffTarget);
    setQueryParams(t.params);
    setUrlOrPath("");
  };

  const handleSubmit = async () => {
    // 空キーを除去
    const cleanParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      if (k.trim()) cleanParams[k.trim()] = v;
    }

    const data: DestinationFormData = {
      key,
      name,
      description: desc || null,
      destination_type: destType,
      liff_target_type: destType === "liff" ? liffTarget : null,
      url_or_path: destType !== "liff" ? urlOrPath : null,
      query_params_json: cleanParams,
      is_enabled: enabled,
    };

    const success = await onSave(data, editingDestination?.id ?? null);
    if (success) onClose();
  };

  const canSubmit = key.trim() && name.trim() && !saving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dest-modal-heading"
        className="mx-4 max-h-[85vh] w-full max-w-[540px] overflow-auto rounded-card border border-line bg-surface p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="dest-modal-heading"
          className="font-round mb-4 text-[16px] font-extrabold leading-[1.2] text-ink"
        >
          {isEditing ? "遷移先を編集" : "遷移先を追加"}
        </h3>

        {/* テンプレート候補（新規のみ） */}
        {!isEditing && (
          <div className="mb-5 rounded-field border border-line bg-bg-tint p-3">
            <p className="mb-2 text-[11px] font-medium text-ink-3">よく使う設定</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => {
                const selected = key === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className={
                      "rounded-full px-3 py-1.5 text-xs transition-colors " +
                      (selected
                        ? "border border-brand bg-brand-soft text-brand-ink"
                        : "border border-line bg-surface text-ink-2 hover:bg-brand-soft hover:text-brand-ink hover:border-brand/30")
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* name + key (SP: 1 列 / PC: 2 列) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dest-name" className="mb-1 block text-[13px] font-bold text-ink">
                表示名<RequiredMark />
              </label>
              <input
                id="dest-name"
                className={compactInputClass + " w-full"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="開始画面"
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="dest-key" className="mb-1 block text-[13px] font-bold text-ink">
                識別キー<RequiredMark />
              </label>
              <input
                id="dest-key"
                className={compactInputClass + " w-full font-mono"}
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="start"
                aria-required="true"
                aria-describedby="dest-key-help"
              />
              <p id="dest-key-help" className="mt-0.5 text-[10px] text-ink-3">英数字・ハイフン・アンダースコア</p>
            </div>
          </div>

          {/* description */}
          <div>
            <label htmlFor="dest-desc" className="mb-1 block text-[13px] font-bold text-ink">
              説明
            </label>
            <input
              id="dest-desc"
              className={compactInputClass + " w-full"}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="リッチメニューの「はじめる」から使う"
            />
          </div>

          {/* destination_type */}
          <div>
            <label htmlFor="dest-type" className="mb-1 block text-[13px] font-bold text-ink">
              遷移先の種類<RequiredMark />
            </label>
            <select
              id="dest-type"
              className={compactInputClass + " w-full"}
              value={destType}
              onChange={(e) => setDestType(e.target.value as DestinationType)}
              aria-required="true"
            >
              <option value="liff">LIFF（LINEアプリ内ページ）</option>
              <option value="internal_url">内部URL（Whale Studio内）</option>
              <option value="external_url">外部URL</option>
            </select>
          </div>

          {/* LIFF 固有 */}
          {destType === "liff" && (
            <>
              <div>
                <label htmlFor="dest-liff-target" className="mb-1 block text-[13px] font-bold text-ink">
                  LIFF遷移先
                </label>
                <select
                  id="dest-liff-target"
                  className={compactInputClass + " w-full"}
                  value={liffTarget}
                  onChange={(e) => setLiffTarget(e.target.value as LiffTargetType)}
                >
                  <option value="work_main">作品メイン画面</option>
                  <option value="custom">カスタム</option>
                </select>
              </div>
              <QueryParamsEditor value={queryParams} onChange={setQueryParams} />
            </>
          )}

          {/* internal_url */}
          {destType === "internal_url" && (
            <div>
              <label htmlFor="dest-internal-path" className="mb-1 block text-[13px] font-bold text-ink">
                内部パス
              </label>
              <input
                id="dest-internal-path"
                className={compactInputClass + " w-full font-mono"}
                value={urlOrPath}
                onChange={(e) => setUrlOrPath(e.target.value)}
                placeholder="/liff/work/abc"
                aria-describedby="dest-internal-help"
              />
              <p id="dest-internal-help" className="mt-0.5 text-[10px] text-ink-3">
                Whale Studio 内のURLを / から始めて指定
              </p>
            </div>
          )}

          {/* external_url */}
          {destType === "external_url" && (
            <div>
              <label htmlFor="dest-external-url" className="mb-1 block text-[13px] font-bold text-ink">
                外部URL
              </label>
              <input
                id="dest-external-url"
                className={compactInputClass + " w-full"}
                value={urlOrPath}
                onChange={(e) => setUrlOrPath(e.target.value)}
                placeholder="https://example.com/campaign"
                aria-describedby="dest-external-help"
              />
              <p id="dest-external-help" className="mt-0.5 text-[10px] text-ink-3">
                https:// から始まる外部サイトURL
              </p>
            </div>
          )}

          {/* 有効/無効 */}
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-brand"
            />
            有効にする
          </label>

          {/* リアルタイム URL プレビュー */}
          <DestinationUrlPreview
            workId={workId}
            destinationType={destType}
            liffTargetType={destType === "liff" ? liffTarget : null}
            urlOrPath={destType !== "liff" ? urlOrPath : null}
            queryParams={queryParams}
          />
        </div>

        {/* アクション */}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            className="sm:w-auto"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={saving || undefined}
            className="flex-1"
          >
            {saving ? "保存中..." : isEditing ? "保存" : "追加"}
          </Button>
        </div>
      </div>
    </div>
  );
}
