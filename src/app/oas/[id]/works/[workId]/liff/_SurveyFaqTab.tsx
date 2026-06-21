"use client";

// src/app/oas/[id]/works/[workId]/liff/_SurveyFaqTab.tsx
//
// PR-A: LIFF 設定の「アンケート」「よくある質問」タブ。
// 既存の survey / faq page type・editor・保存 API（updatePage）を再利用するインライン編集。
//   - 作品内の該当 page_type の先頭ページを「指定ページ」として編集（無ければ作成導線）。
//   - 表示/非表示 = 既存 publish_status（"published"=表示 / "draft"=非表示）。新規は draft(=非表示)。
//   - 設問/Q&A は既存 LiffSurveyEditor / LiffFaqEditor をそのまま使用（context 非依存）。
//   - 新規の保存 API は作らない。ホームフッターへのリンク表示は後続 PR。

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/shared";
import { useToast } from "@/components/Toast";
import { liffConfigApi, getDevToken, type LiffPageSummary } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageConfigSettings } from "@/types";
import { LiffSurveyEditor } from "@/components/liff/LiffSurveyEditor";
import { LiffFaqEditor } from "@/components/liff/LiffFaqEditor";
import { findDesignatedLiffPage } from "./_tabs-config";

const labelCls = "block text-xs font-medium text-gray-600 mb-1";
const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand disabled:bg-gray-50 disabled:text-gray-500";

interface Props {
  oaId: string;
  workId: string;
  kind: "survey" | "faq";
  pages: LiffPageSummary[];
  isReadOnly: boolean;
  onSaved: () => void;
}

export function SurveyFaqTab({ oaId, workId, kind, pages, isReadOnly, onSaved }: Props) {
  const { showToast } = useToast();
  const label = kind === "survey" ? "アンケート" : "よくある質問";
  const designated = useMemo(() => findDesignatedLiffPage(pages, kind), [pages, kind]);

  const [config, setConfig] = useState<LiffPageConfig | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState<LiffPageConfigSettings>({});
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const applyConfig = useCallback((c: LiffPageConfig) => {
    setConfig(c);
    setTitle(c.title ?? "");
    setDescription(c.description ?? "");
    setSettings(c.settings_json ?? {});
    setPublished(c.publish_status === "published");
  }, []);

  // 指定ページをロード（無ければクリア）。同 id を読込済みなら再取得しない。
  useEffect(() => {
    let alive = true;
    if (!designated) { setConfig(null); return; }
    if (config?.id === designated.id) return;
    setLoading(true);
    liffConfigApi
      .getPage(getDevToken(), workId, designated.id)
      .then((c) => { if (alive) applyConfig(c); })
      .catch(() => { if (alive) showToast("読み込みに失敗しました", "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [designated, workId, applyConfig, showToast, config?.id]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const c = await liffConfigApi.createPage(getDevToken(), workId, { page_type: kind, title: label });
      applyConfig(c);
      onSaved();
      showToast(`${label}を作成しました（非表示の下書きです）`, "success");
    } catch {
      showToast("作成に失敗しました", "error");
    } finally {
      setCreating(false);
    }
  }, [workId, kind, label, applyConfig, onSaved, showToast]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const c = await liffConfigApi.updatePage(getDevToken(), workId, config.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        // 指定ページはホームカードには出さない（後続のフッターリンクから開く想定）。
        settings_json: { ...settings, show_in_menu: false },
        publish_status: published ? "published" : "draft",
      });
      applyConfig(c);
      onSaved();
      showToast("保存しました", "success");
    } catch {
      showToast("保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }, [config, workId, title, description, settings, published, applyConfig, onSaved, showToast]);

  const onEditorChange = useCallback((patch: Partial<LiffPageConfigSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── 未作成（指定ページなし）─────────────────────────────────────────
  if (!designated && !config) {
    return (
      <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
        <p className="text-sm text-gray-600 mb-1">{label}はまだ作成されていません</p>
        <p className="text-xs text-gray-400 mb-4">
          作成すると「非表示（下書き）」の状態で始まります。内容を整えてから「プレイヤーに表示する」をオンにできます。
        </p>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isReadOnly || creating}
          className={buttonClass({ variant: "primary", size: "md" })}
        >
          {creating && <span className="spinner" aria-hidden="true" />}
          {label}を作成
        </button>
      </div>
    );
  }

  if (loading || !config) {
    return <div className="text-sm text-gray-500 py-8 text-center">読み込み中…</div>;
  }

  return (
    <div className="space-y-4">
      {/* 表示 / 非表示 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            disabled={isReadOnly}
            className="rounded border-gray-300 accent-brand"
          />
          プレイヤーに表示する（オフ＝非表示の下書き）
        </label>
        <p className="text-[11px] text-gray-400 mt-1">
          表示 = 公開（published）／ 非表示 = 下書き（draft）。未公開の{label}がプレイヤーに出ることはありません。
        </p>
      </div>

      {/* タイトル / 説明文 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <label className={labelCls}>タイトル</label>
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isReadOnly}
            placeholder={kind === "survey" ? "例: ご感想アンケート" : "例: よくある質問"}
          />
        </div>
        <div>
          <label className={labelCls}>説明文</label>
          <textarea
            className={inputCls}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isReadOnly}
            placeholder="ページ上部に表示する説明文（任意）"
          />
        </div>
      </div>

      {/* 設問 / Q&A（既存エディタを再利用） */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {kind === "survey" ? (
          <>
            <LiffSurveyEditor settings={settings} readOnly={isReadOnly} onChange={onEditorChange} />
            <div>
              <label className={labelCls}>送信完了メッセージ</label>
              <input
                className={inputCls}
                value={settings.survey_thanks_message ?? ""}
                onChange={(e) => onEditorChange({ survey_thanks_message: e.target.value })}
                disabled={isReadOnly}
                placeholder="例: ご回答ありがとうございました。"
              />
            </div>
          </>
        ) : (
          <LiffFaqEditor settings={settings} readOnly={isReadOnly} onChange={onEditorChange} />
        )}
      </div>

      {/* アクション */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/oas/${oaId}/works/${workId}/liff/${config.id}`}
          className="text-[13px] text-gray-500 hover:text-gray-700 underline"
        >
          詳細編集（ブロック・プレビュー）へ
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={isReadOnly || saving}
          className={buttonClass({ variant: "primary", size: "md" })}
        >
          {saving && <span className="spinner" aria-hidden="true" />}
          保存
        </button>
      </div>
    </div>
  );
}
