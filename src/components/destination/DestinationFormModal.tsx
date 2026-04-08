"use client";

// src/components/destination/DestinationFormModal.tsx
// destination 追加・編集モーダル。
// リアルタイム URL プレビュー + テンプレート候補 + query params 編集。

import { useState, useEffect } from "react";
import { QueryParamsEditor } from "./QueryParamsEditor";
import { DestinationUrlPreview } from "./DestinationUrlPreview";
import type { LineDestination, DestinationType, LiffTargetType } from "@/types";
import type { DestinationFormData } from "@/hooks/useDestinations";

// ── テンプレート候補 ─────────────────────────────
const TEMPLATES: { key: string; name: string; desc: string; type: DestinationType; liffTarget: LiffTargetType; params: Record<string, string> }[] = [
  { key: "start",    name: "開始画面",     desc: "リッチメニューの「はじめる」",       type: "liff", liffTarget: "work_main", params: { entry: "richmenu" } },
  { key: "evidence", name: "証拠一覧",     desc: "証拠確認ページ",                     type: "liff", liffTarget: "work_main", params: { tab: "evidence" } },
  { key: "progress", name: "進捗表示",     desc: "クリア進捗の確認",                   type: "liff", liffTarget: "work_main", params: { tab: "progress" } },
  { key: "profile",  name: "プロフィール", desc: "ユーザー情報ページ",                 type: "liff", liffTarget: "work_main", params: {} },
];

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-6 w-[540px] max-h-[85vh] overflow-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 mb-4">
          {isEditing ? "遷移先を編集" : "遷移先を追加"}
        </h3>

        {/* テンプレート候補（新規のみ） */}
        {!isEditing && (
          <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-[11px] font-medium text-gray-500 mb-2">よく使う設定</p>
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => applyTemplate(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                    key === t.key
                      ? "bg-teal-50 border-teal-300 text-teal-700"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-teal-50"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* name + key */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">表示名 *</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="開始画面"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">識別キー *</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-200"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="start"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">英数字・ハイフン・アンダースコア</p>
            </div>
          </div>

          {/* description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">説明</label>
            <input
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="リッチメニューの「はじめる」から使う"
            />
          </div>

          {/* destination_type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">遷移先の種類 *</label>
            <select
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200"
              value={destType}
              onChange={(e) => setDestType(e.target.value as DestinationType)}
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
                <label className="block text-xs font-medium text-gray-500 mb-1">LIFF遷移先</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200"
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
              <label className="block text-xs font-medium text-gray-500 mb-1">内部パス</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-200"
                value={urlOrPath}
                onChange={(e) => setUrlOrPath(e.target.value)}
                placeholder="/liff/work/abc"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Whale Studio 内のURLを / から始めて指定</p>
            </div>
          )}

          {/* external_url */}
          {destType === "external_url" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">外部URL</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200"
                value={urlOrPath}
                onChange={(e) => setUrlOrPath(e.target.value)}
                placeholder="https://example.com/campaign"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">https:// から始まる外部サイトURL</p>
            </div>
          )}

          {/* 有効/無効 */}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300"
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
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "保存中..." : isEditing ? "保存" : "追加"}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
