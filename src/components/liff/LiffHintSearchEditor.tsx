"use client";

// src/components/liff/LiffHintSearchEditor.tsx
//
// 検索型ヒント (page_type="hint_search") の CMS 編集 UI。
// 親 (LiffConfigHeader) から settings を受け取り、onChange で settings_json へ流す（FAQ 編集と同じ流儀）。
//
// 編集対象:
//   1. ヒント項目   … settings.hint_search_entries
//   2. 質問ツリー   … settings.hint_search_guide_question / hint_search_guide_options
//
// 名称の使い分け（ネタバレ防止の要）:
//   - 管理用メモ (internal_title) … フェーズ番号 / 内部シナリオ名を入れる欄。プレイヤーには出ない。
//   - 検索結果の名称 (search_result_label) … プレイヤーが見る唯一の名称。
//   検索対象にも internal_title は含めないので、内部名から情報が漏れることはない。

import { useMemo } from "react";
import type {
  HintSearchEntry,
  HintSearchGuideNode,
  LiffPageConfigSettings,
} from "@/types";
import {
  HINT_SEARCH_GUIDE_DEFAULT_QUESTION,
  HINT_SEARCH_GUIDE_MAX_DEPTH,
  HINT_SEARCH_GUIDE_MAX_OPTIONS,
  HINT_SEARCH_MAX_HINT_LEVELS,
} from "@/lib/liff/hint-search";

interface Props {
  settings: LiffPageConfigSettings;
  readOnly: boolean;
  onChange: (patch: Partial<LiffPageConfigSettings>) => void;
}

const labelCls = "block text-xs font-medium text-gray-500 mb-1";
const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";
const cardCls = "bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-4";
const smallBtn = "px-2 py-1 text-xs border border-gray-200 rounded transition-colors hover:bg-gray-50 disabled:opacity-30";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newEntry(): HintSearchEntry {
  return { id: newId(), search_result_label: "", keywords: [], aliases: [], hints: [{ level: 1, body: "" }] };
}

/** 改行 / 読点 / カンマ区切りのテキストを語リストへ。編集中の空行は保持しない。 */
function parseTerms(text: string): string[] {
  return text
    .split(/[\n,、]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function termsToText(terms: string[] | undefined): string {
  return (terms ?? []).join("\n");
}

export function LiffHintSearchEditor({ settings, readOnly, onChange }: Props) {
  const entries = useMemo<HintSearchEntry[]>(() => {
    const arr = settings.hint_search_entries;
    return Array.isArray(arr) && arr.length > 0 ? arr : [newEntry()];
  }, [settings.hint_search_entries]);

  const guideOptions = settings.hint_search_guide_options ?? [];

  const updateEntries = (next: HintSearchEntry[]) => onChange({ hint_search_entries: next });
  const patchEntry = (idx: number, patch: Partial<HintSearchEntry>) =>
    updateEntries(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const moveEntry = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= entries.length) return;
    const next = entries.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    updateEntries(next);
  };

  const removeEntry = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    updateEntries(next.length > 0 ? next : [newEntry()]);
  };

  /** 質問ツリーの「紐づけ先ヒント」セレクト用の候補（プレイヤー表示名で並べる）。 */
  const hintChoices = entries
    .filter((e) => (e.id ?? "").trim() !== "" && e.search_result_label.trim() !== "")
    .map((e) => ({ id: e.id as string, label: e.search_result_label.trim() }));

  return (
    <>
      {/* ── 1. ヒント項目 ─────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-900">ヒント項目</h2>
          {!readOnly && (
            <button
              type="button"
              onClick={() => updateEntries([...entries, newEntry()])}
              className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors"
            >
              ＋ ヒントを追加
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400 -mt-2">
          プレイヤーはキーワードを入力して検索します。検索対象は「検索結果の名称」「キーワード」「別名」で、
          管理用メモは検索にも表示にも使いません。
        </p>

        <ul className="flex flex-col gap-4">
          {entries.map((entry, idx) => (
            <li key={entry.id ?? idx} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">ヒント {idx + 1}</span>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => moveEntry(idx, -1)} disabled={idx === 0} className={smallBtn} aria-label="上へ移動">↑</button>
                    <button type="button" onClick={() => moveEntry(idx, 1)} disabled={idx === entries.length - 1} className={smallBtn} aria-label="下へ移動">↓</button>
                    <button type="button" onClick={() => removeEntry(idx)} className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded transition-colors hover:bg-red-50" aria-label="削除">削除</button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>管理用メモ（プレイヤーには表示されません）</label>
                  <input
                    className={inputCls}
                    value={entry.internal_title ?? ""}
                    onChange={(e) => patchEntry(idx, { internal_title: e.target.value })}
                    disabled={readOnly}
                    placeholder="例: P7 - 施設特定後の次行動"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className={labelCls}>検索結果の名称（プレイヤー表示）</label>
                  <input
                    className={inputCls}
                    value={entry.search_result_label}
                    onChange={(e) => patchEntry(idx, { search_result_label: e.target.value })}
                    disabled={readOnly}
                    placeholder="例: 施設を探している"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className={labelCls}>ヒント一覧での表示名（未入力なら上と同じ）</label>
                  <input
                    className={inputCls}
                    value={entry.list_title ?? ""}
                    onChange={(e) => patchEntry(idx, { list_title: e.target.value })}
                    disabled={readOnly}
                    placeholder="例: キーボード"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className={labelCls}>カテゴリ（詳細の見出し上に小さく表示・任意）</label>
                  <input
                    className={inputCls}
                    value={entry.category_label ?? ""}
                    onChange={(e) => patchEntry(idx, { category_label: e.target.value })}
                    disabled={readOnly}
                    placeholder="例: 持ち物・道具"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>キーワード（1行に1つ）</label>
                  <textarea
                    className={`${inputCls} resize-y min-h-[72px]`}
                    value={termsToText(entry.keywords)}
                    onChange={(e) => patchEntry(idx, { keywords: parseTerms(e.target.value) })}
                    disabled={readOnly}
                    placeholder={"キーボード\n机\nパソコン"}
                    rows={3}
                  />
                </div>
                <div>
                  <label className={labelCls}>別名・表記ゆれ（1行に1つ）</label>
                  <textarea
                    className={`${inputCls} resize-y min-h-[72px]`}
                    value={termsToText(entry.aliases)}
                    onChange={(e) => patchEntry(idx, { aliases: parseTerms(e.target.value) })}
                    disabled={readOnly}
                    placeholder={"きーぼーど\nキーボード\nkeyboard"}
                    rows={3}
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 -mt-1">
                ひらがな / カタカナ・全角 / 半角・大文字 / 小文字の違いは自動で吸収され、部分一致でもヒットします。
              </p>

              <HintLevelsEditor
                hints={entry.hints ?? []}
                readOnly={readOnly}
                onChange={(hints) => patchEntry(idx, { hints })}
              />

              <div>
                <label className={labelCls}>答え（「答えを見る」で開示。空なら答えボタンを出しません）</label>
                <textarea
                  className={`${inputCls} resize-y min-h-[72px]`}
                  value={entry.answer ?? ""}
                  onChange={(e) => patchEntry(idx, { answer: e.target.value })}
                  disabled={readOnly}
                  placeholder="この場面の結論そのもの"
                  rows={3}
                  maxLength={3000}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ── 2. 質問ツリー ─────────────────────────────── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-900">「キーワードがわからない場合」の質問</h2>
          {!readOnly && guideOptions.length < HINT_SEARCH_GUIDE_MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => onChange({ hint_search_guide_options: [...guideOptions, { id: newId(), label: "" }] })}
              className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors"
            >
              ＋ 選択肢を追加
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400 -mt-2">
          キーワードが思いつかないプレイヤー向けの選択式フローです。選択肢は「ヒントに紐づける」か
          「さらに質問する」のどちらかを設定してください。どちらも未設定の選択肢はプレイヤー側に表示されません。
        </p>

        <div>
          <label className={labelCls}>最初の質問文</label>
          <input
            className={inputCls}
            value={settings.hint_search_guide_question ?? ""}
            onChange={(e) => onChange({ hint_search_guide_question: e.target.value })}
            disabled={readOnly}
            placeholder={HINT_SEARCH_GUIDE_DEFAULT_QUESTION}
            maxLength={200}
          />
        </div>

        {guideOptions.length === 0 ? (
          <p className="text-xs text-gray-400">
            選択肢が未設定のときは、プレイヤー側に「選択肢が登録されていません」と表示されます。
          </p>
        ) : (
          <GuideNodeListEditor
            nodes={guideOptions}
            depth={1}
            readOnly={readOnly}
            hintChoices={hintChoices}
            onChange={(next) => onChange({ hint_search_guide_options: next })}
          />
        )}
      </div>
    </>
  );
}

// ── 段階ヒント（最大 3 段）─────────────────────────────────────
function HintLevelsEditor({
  hints, readOnly, onChange,
}: {
  hints: HintSearchEntry["hints"];
  readOnly: boolean;
  onChange: (hints: HintSearchEntry["hints"]) => void;
}) {
  const list = hints.length > 0 ? hints : [{ level: 1, body: "" }];
  /** level は常に配列順で振り直す（プレイヤー側の開示順と一致させるため）。 */
  const renumber = (arr: HintSearchEntry["hints"]) => arr.map((h, i) => ({ ...h, level: i + 1 }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={labelCls}>段階ヒント（上から順に開示。最大 {HINT_SEARCH_MAX_HINT_LEVELS} 段）</span>
        {!readOnly && list.length < HINT_SEARCH_MAX_HINT_LEVELS && (
          <button
            type="button"
            onClick={() => onChange(renumber([...list, { level: list.length + 1, body: "" }]))}
            className={smallBtn}
          >
            ＋ 段階を追加
          </button>
        )}
      </div>
      {list.map((hint, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 shrink-0 text-[11px] text-gray-400 w-12">ヒント{i + 1}</span>
          <textarea
            className={`${inputCls} resize-y min-h-[64px]`}
            value={hint.body}
            onChange={(e) => onChange(renumber(list.map((h, j) => (j === i ? { ...h, body: e.target.value } : h))))}
            disabled={readOnly}
            placeholder={i === 0 ? "弱いヒント（気づきのきっかけ）" : "より踏み込んだヒント"}
            rows={2}
            maxLength={3000}
          />
          {!readOnly && list.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(renumber(list.filter((_, j) => j !== i)))}
              className="mt-1 px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
              aria-label={`ヒント${i + 1}を削除`}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 質問ツリー（再帰）──────────────────────────────────────────
function GuideNodeListEditor({
  nodes, depth, readOnly, hintChoices, onChange,
}: {
  nodes: HintSearchGuideNode[];
  depth: number;
  readOnly: boolean;
  hintChoices: Array<{ id: string; label: string }>;
  onChange: (next: HintSearchGuideNode[]) => void;
}) {
  const patch = (idx: number, p: Partial<HintSearchGuideNode>) =>
    onChange(nodes.map((n, i) => (i === idx ? { ...n, ...p } : n)));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = nodes.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <ul className="flex flex-col gap-3">
      {nodes.map((node, idx) => {
        const hasChildren = (node.options?.length ?? 0) > 0;
        const canNest = depth < HINT_SEARCH_GUIDE_MAX_DEPTH;
        return (
          <li key={node.id ?? idx} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">選択肢 {idx + 1}</span>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className={smallBtn} aria-label="上へ移動">↑</button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === nodes.length - 1} className={smallBtn} aria-label="下へ移動">↓</button>
                  <button
                    type="button"
                    onClick={() => onChange(nodes.filter((_, i) => i !== idx))}
                    className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
                    aria-label="削除"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>選択肢の文言</label>
              <input
                className={inputCls}
                value={node.label}
                onChange={(e) => patch(idx, { label: e.target.value })}
                disabled={readOnly}
                placeholder="例: 手元のものの扱い方がわからない"
                maxLength={120}
              />
            </div>

            {!hasChildren && (
              <div>
                <label className={labelCls}>この選択肢で表示するヒント</label>
                <select
                  className={inputCls}
                  value={node.hint_id ?? ""}
                  onChange={(e) => patch(idx, { hint_id: e.target.value || undefined })}
                  disabled={readOnly}
                >
                  <option value="">（未設定）</option>
                  {hintChoices.map((h) => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                  ))}
                </select>
              </div>
            )}

            {hasChildren && (
              <div>
                <label className={labelCls}>次の質問文</label>
                <input
                  className={inputCls}
                  value={node.question ?? ""}
                  onChange={(e) => patch(idx, { question: e.target.value })}
                  disabled={readOnly}
                  placeholder="例: そのものについて、どこまで確認されましたか。"
                  maxLength={200}
                />
              </div>
            )}

            {canNest && !readOnly && (node.options?.length ?? 0) < HINT_SEARCH_GUIDE_MAX_OPTIONS && (
              <button
                type="button"
                onClick={() => patch(idx, { options: [...(node.options ?? []), { id: newId(), label: "" }] })}
                className={`${smallBtn} self-start`}
              >
                ＋ さらに質問する（子の選択肢を追加）
              </button>
            )}

            {hasChildren && (
              <div className="pl-3 border-l-2 border-gray-100">
                <GuideNodeListEditor
                  nodes={node.options ?? []}
                  depth={depth + 1}
                  readOnly={readOnly}
                  hintChoices={hintChoices}
                  onChange={(next) => patch(idx, { options: next })}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
