"use client";

// src/app/oas/[id]/works/[workId]/liff/_HomeTab.tsx
//
// 「ホーム」タブ — 作品メニューのホーム画面の見せ方を編集する。
//   左: 詳細ページ (show_in_menu=true) の並び替え + 表示形式 (カード/コンパクト) 編集
//   右: 実機ホームと同じ LiffMenuHomeRenderer を sticky 表示 (ローカル変更を即時反映)
//
// 保存は明示「保存」ボタンでまとめて行う。settingsJson を壊さないよう、保存直前に
// getPage で最新 settings を取得し menu_order / menu_card_style だけ merge して PUT する。

// 管理画面ルートでは LIFF レイアウトの CSS がロードされていないため明示 import する。
import "@/app/liff/liff-font.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { buttonClass, Accordion } from "@/components/shared";
import { ImageUploadField } from "@/components/ImageUploadField";
import {
  liffConfigApi,
  workApi,
  fetchOaLiffId,
  getDevToken,
  type LiffPageSummary,
} from "@/lib/api-client";
import { LiffMenuHomeRenderer, type LiffMenuHomePage } from "@/components/liff/LiffMenuHomeRenderer";
import { formatDateTime } from "./_shared";

interface HomeInit {
  title:       string | null;
  description: string | null;
  image_url:   string | null;
}

type CardStyle = "card" | "compact";

interface Row {
  id:            string;
  title:         string | null;
  description:   string | null;
  pageType:      string;
  publicId:      string | null;
  isEnabled:     boolean;
  publishStatus: string;
  createdAt:     string;
  updatedAt:     string;
  menuLabel:     string | null;
  menuIcon:      string | null;
  cardStyle:     CardStyle;
  /** 永続化されている menu_order（差分判定用。null は未設定）。 */
  origMenuOrder: number | null;
  /** 永続化されている表示形式（差分判定用）。 */
  origCardStyle: CardStyle;
}

interface Props {
  oaId:         string;
  workId:       string;
  /** 公開 LIFF URL 生成用の work publicId（未取得時は undefined → UUID ルートにフォールバック）。 */
  workPublicId?: string;
  workTitle:    string;
  pages:        LiffPageSummary[];
  /** 作品メニューホームの初期設定（title/description/image_url）。 */
  homeInit:     HomeInit;
  isReadOnly:   boolean;
  /** 保存完了後に親へ再読込を促す。 */
  onSaved:      () => void;
}

/** 詳細ページ (show_in_menu) を menu_order → created_at 昇順で Row 化する。 */
function buildRows(pages: LiffPageSummary[]): Row[] {
  return pages
    .filter((p) => p.show_in_menu !== false)
    .slice()
    .sort((a, b) => {
      const ao = a.menu_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.menu_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .map((p) => ({
      id:            p.id,
      title:         p.title,
      description:   p.description,
      pageType:      p.page_type,
      publicId:      p.public_id ?? null,
      isEnabled:     p.is_enabled,
      publishStatus: p.publish_status,
      createdAt:     p.created_at,
      updatedAt:     p.updated_at,
      menuLabel:     p.menu_label ?? null,
      menuIcon:      p.menu_icon ?? null,
      cardStyle:     p.menu_card_style === "compact" ? "compact" : "card",
      origMenuOrder: p.menu_order ?? null,
      origCardStyle: p.menu_card_style === "compact" ? "compact" : "card",
    }));
}

const PUBLISH_BADGE: Record<string, string> = {
  draft:     "下書き",
  published: "公開中",
  archived:  "アーカイブ",
};

// 入力値（空文字含む）を保存用に正規化: trim 後空なら "" を送る（API 側で解除扱い）。
const norm = (v: string) => (v.trim() === "" ? "" : v);

export function HomeTab({ oaId, workId, workPublicId, workTitle, pages, homeInit, isReadOnly, onSaved }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>(() => buildRows(pages));
  const [saving, setSaving] = useState(false);

  // ── ホームLIFF URL アコーディオン用 ───────────────────────────
  // origin はクライアントでのみ確定（preview→preview / 本番→本番）。SSR mismatch 回避のため mount 後に設定。
  const [origin, setOrigin] = useState("");
  const [liffId, setLiffId] = useState<string | null>(null);
  const [liffLoaded, setLiffLoaded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchOaLiffId(oaId)
      .then((id) => { if (!cancelled) setLiffId(id); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLiffLoaded(true); });
    return () => { cancelled = true; };
  }, [oaId]);

  // 公開ホーム URL: publicId があれば短縮ルート、無ければ UUID ルート。origin 未確定時は空。
  const browserHomeUrl = origin
    ? (workPublicId ? `${origin}/liff/w/${workPublicId}` : `${origin}/liff/work/${workId}`)
    : "";
  const realLiffUrl = liffId ? `https://liff.line.me/${liffId}` : "";

  const copyUrl = useCallback(async (key: string, url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1500);
    } catch {
      showToast("URL のコピーに失敗しました", "error");
    }
  }, [showToast]);

  // ホーム設定（タイトル/説明文/画像）。テキストエリアは制御のため空文字を保持する。
  const [homeTitle, setHomeTitle] = useState(homeInit.title ?? "");
  const [homeDescription, setHomeDescription] = useState(homeInit.description ?? "");
  const [homeImageUrl, setHomeImageUrl] = useState(homeInit.image_url ?? "");

  // 親が pages を再取得したら Row を作り直す（保存後リセット含む）。
  useEffect(() => { setRows(buildRows(pages)); }, [pages]);
  // 親が work を再取得したらホーム設定も同期（保存後リセット含む）。
  useEffect(() => {
    setHomeTitle(homeInit.title ?? "");
    setHomeDescription(homeInit.description ?? "");
    setHomeImageUrl(homeInit.image_url ?? "");
  }, [homeInit.title, homeInit.description, homeInit.image_url]);

  const homeDirty =
    norm(homeTitle) !== (homeInit.title ?? "") ||
    norm(homeDescription) !== (homeInit.description ?? "") ||
    norm(homeImageUrl) !== (homeInit.image_url ?? "");

  const rowsDirty = useMemo(
    () => rows.some((r, i) => r.origMenuOrder !== i || r.cardStyle !== r.origCardStyle),
    [rows],
  );
  const dirty = rowsDirty || homeDirty;

  const move = useCallback((index: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = prev.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const setCardStyle = useCallback((id: string, style: CardStyle) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cardStyle: style } : r)));
  }, []);

  const handleSave = useCallback(async () => {
    if (isReadOnly || saving || !dirty) return;
    setSaving(true);
    const token = getDevToken();
    // index = 望ましい menu_order。永続値と異なる or 表示形式が変わった行だけ保存する。
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.origMenuOrder !== i || r.cardStyle !== r.origCardStyle);
    try {
      // ① ホーム設定（タイトル/説明文/画像）を work にまとめて保存（変更時のみ）。
      //    空文字は API 側で解除扱い。works.liff_home_settings_json に merge される。
      if (homeDirty) {
        await workApi.update(token, workId, {
          liff_home_settings: {
            title:       norm(homeTitle),
            description: norm(homeDescription),
            image_url:   norm(homeImageUrl),
          },
        });
      }
      // ② 各ページの並び順・表示形式。settingsJson を壊さないよう最新を取得して merge。
      for (const { r, i } of targets) {
        const full = await liffConfigApi.getPage(token, workId, r.id);
        const merged = {
          ...(full.settings_json ?? {}),
          menu_order:      i,
          menu_card_style: r.cardStyle,
        };
        await liffConfigApi.updatePage(token, workId, r.id, { settings_json: merged });
      }
      showToast("ホームの設定を保存しました", "success");
      onSaved();
    } catch {
      showToast("保存に失敗しました。時間をおいて再度お試しください", "error");
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, saving, dirty, homeDirty, homeTitle, homeDescription, homeImageUrl, rows, workId, showToast, onSaved]);

  // ── プレビュー用ページ（ローカルの順序・形式・ラベルを即時反映）──
  const previewPages = useMemo<LiffMenuHomePage[]>(
    () => rows.map((r, i) => ({
      id:          r.id,
      public_id:   r.publicId,
      title:       r.title,
      description: r.description,
      page_type:   r.pageType,
      is_enabled:  r.isEnabled,
      settings_json: {
        show_in_menu:    true,
        menu_order:      i,
        menu_card_style: r.cardStyle,
        ...(r.menuLabel ? { menu_label: r.menuLabel } : {}),
        ...(r.menuIcon ? { menu_icon: r.menuIcon } : {}),
      },
      created_at: r.createdAt,
    })),
    [rows],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* 左: 編集 */}
      <div className="flex-1 min-w-0 w-full">
        {/* 保存ボタンは左側編集エリアの末尾（下部）に配置する。ここでは導入文のみ。 */}
        <p className="text-[12px] text-gray-500 mb-3">ホームの見た目と並びを設定します。変更は右のプレビューに即時反映されます。</p>

        {/* ホーム設定（タイトル / 説明文 / 画像）— すべて任意。未設定時は従来表示。 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-900">ホーム設定</h2>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ホームタイトル</label>
            <input
              type="text"
              value={homeTitle}
              onChange={(e) => setHomeTitle(e.target.value)}
              disabled={isReadOnly}
              placeholder="ホーム"
              maxLength={40}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50"
            />
            <p className="text-[11px] text-gray-400 mt-1">未入力の場合は「ホーム」と表示されます。</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ホーム説明文</label>
            <textarea
              value={homeDescription}
              onChange={(e) => setHomeDescription(e.target.value)}
              disabled={isReadOnly}
              placeholder="このホーム画面の説明文を入力できます"
              rows={3}
              maxLength={2000}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50"
            />
            <p className="text-[11px] text-gray-400 mt-1">未入力の場合は表示されません。改行はそのまま反映されます。</p>
          </div>

          <ImageUploadField
            label="ホーム画像"
            value={homeImageUrl}
            onChange={(next) => setHomeImageUrl(next)}
            readOnly={isReadOnly}
            previewAlt="ホーム画像プレビュー"
            previewMaxHeight={160}
            urlInputCollapsibleLabel="画像URLを直接入力する"
          />
          <p className="text-[11px] text-gray-400 -mt-1">未設定の場合は表示されません。設定するとホーム見出しの上に表示されます。</p>
        </div>

        {/* ページ一覧 */}
        <div className="mb-3">
          <h2 className="text-base font-semibold text-gray-900">ホームに表示するページ</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">並び順と表示形式を編集できます。右のプレビューに即時反映されます。</p>
        </div>

        {rows.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
            <p className="text-sm text-gray-500 mb-2">ホームに表示する詳細ページがまだありません</p>
            <p className="text-xs text-gray-400">
              LIFFページ作成時に「このページを作品メニューのカードとして表示する」をオンにすると、ここに表示されます。
            </p>
          </div>
        ) : (
          <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {rows.map((r, i) => (
              <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                {/* 並び替え (上下ボタン) — 固定幅 */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={isReadOnly || i === 0}
                    aria-label="上へ"
                    className="w-6 h-5 inline-flex items-center justify-center rounded border border-gray-200 text-gray-500 text-[11px] hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={isReadOnly || i === rows.length - 1}
                    aria-label="下へ"
                    className="w-6 h-5 inline-flex items-center justify-center rounded border border-gray-200 text-gray-500 text-[11px] hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▼
                  </button>
                </div>

                {/* 順番番号 — 固定幅 */}
                <span className="shrink-0 w-6 text-center text-[12px] font-bold text-gray-400 tabular-nums leading-5">{i + 1}</span>

                {/* ページ情報 — 可変幅・縦積み。
                    1 行目: タイトル + ステータス、2 行目: 表示形式、3 行目: 更新日時。
                    select はページ情報ブロック内に収め、行右端に固定しない（バッジと重ならない）。 */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-[14px] font-semibold text-gray-900">
                      {r.menuLabel?.trim() || r.title?.trim() || "（無題）"}
                    </span>
                    <span
                      className={`shrink-0 whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        r.publishStatus === "published"
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : r.publishStatus === "archived"
                            ? "bg-gray-100 text-gray-500 border border-gray-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {PUBLISH_BADGE[r.publishStatus] ?? r.publishStatus}
                    </span>
                    {!r.isEnabled && (
                      <span className="shrink-0 whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                        無効
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-gray-500">表示形式</span>
                    <select
                      value={r.cardStyle}
                      onChange={(e) => setCardStyle(r.id, e.target.value as CardStyle)}
                      disabled={isReadOnly}
                      aria-label="表示形式"
                      className="w-full max-w-[180px] sm:w-36 px-2 py-1.5 border border-gray-200 rounded-md text-xs bg-white disabled:bg-gray-50"
                    >
                      <option value="card">カード</option>
                      <option value="compact">コンパクト</option>
                    </select>
                  </div>

                  <div className="mt-1 text-[11px] text-gray-400 truncate">
                    更新: {formatDateTime(r.updatedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 保存ボタン（左側編集エリアの末尾）。ホーム設定 + 並び順 + 表示形式 をまとめて保存。 */}
        {!isReadOnly && (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              aria-busy={saving || undefined}
              className={buttonClass({ variant: "primary", size: "md" })}
            >
              {saving && <span className="spinner" aria-hidden="true" />}
              {saving ? "保存中..." : dirty ? "保存" : "保存済み"}
            </button>
            {!dirty && !saving && <span className="text-xs text-gray-400">変更はありません</span>}
          </div>
        )}

        {/* ホームLIFF URL アコーディオン（保存ボタンの下）。初期は閉じた状態。 */}
        <div className="mt-4">
          <Accordion title="ホームLIFF URL" defaultOpen={false}>
            <div className="space-y-4 pt-1">
              <UrlRow
                label="ブラウザ確認用 URL"
                hint="ブラウザで直接ホームを確認するための URL です。"
                url={browserHomeUrl}
                copied={copiedKey === "browser"}
                onCopy={() => copyUrl("browser", browserHomeUrl)}
              />
              <UrlRow
                label="実機 LIFF URL"
                hint="LINE アプリで実際に開くための URL です。"
                url={realLiffUrl}
                emptyText={liffLoaded ? "LIFF ID が未設定です。OAのLIFF設定を確認してください。" : undefined}
                copied={copiedKey === "liff"}
                onCopy={() => copyUrl("liff", realLiffUrl)}
              />
            </div>
          </Accordion>
        </div>
      </div>

      {/* 右: プレビュー (sticky) */}
      <div className="w-full lg:w-auto lg:shrink-0 lg:sticky lg:top-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-2">ホームプレビュー</h2>
        <div className="w-[375px] max-w-full min-h-[600px] rounded-[32px] overflow-hidden border border-[#e3e8ec] bg-[#f5f8f6] shadow-[0_10px_30px_rgba(31,64,92,0.10)]">
          <div className="flex items-center justify-center gap-2 py-2.5 bg-white border-b border-[#eef2f5]">
            <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
            <span className="text-[10px] font-semibold tracking-[0.06em] text-[#9aa8a2]">LIFF プレビュー</span>
            <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
          </div>
          <div className="overflow-auto bg-[#f5f8f6]" style={{ maxHeight: 720 }}>
            <LiffMenuHomeRenderer
              workTitle={workTitle}
              pages={previewPages}
              homeTitle={homeTitle}
              homeDescription={homeDescription}
              homeImageUrl={homeImageUrl}
              preview
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** ホームLIFF URL アコーディオン内の 1 URL 行（URL 表示 + コピー/開く、未設定時は空状態）。 */
function UrlRow({
  label, hint, url, emptyText, copied, onCopy,
}: {
  label: string;
  hint: string;
  url: string;
  /** url が空のときに出す未設定メッセージ。未指定なら「読み込み中...」を表示。 */
  emptyText?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-gray-700">{label}</div>
      <p className="text-[11px] text-gray-400 mb-1.5">{hint}</p>
      {url ? (
        <div className="flex items-center gap-2 flex-wrap">
          <code
            className="min-w-0 flex-1 truncate text-[12px] text-brand-ink bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5"
            title={url}
          >
            {url}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
          >
            {copied ? "コピーしました" : "コピー"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
          >
            開く
          </a>
        </div>
      ) : emptyText ? (
        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          {emptyText}
        </p>
      ) : (
        <p className="text-[12px] text-gray-400">読み込み中...</p>
      )}
    </div>
  );
}
