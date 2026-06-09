"use client";

// src/components/liff/LiffDevicePreviewLinks.tsx
// LIFF 設定画面に「実機で確認」用の URL / コピー / QR を出すパネル。
//
// 表示する URL は 2 種類:
//   1) ブラウザ確認用 URL — `${BASE}/liff/work/{workId}/pages/{pageId}`
//      PC / スマホブラウザで見た目だけ確認するためのもの。LINE UID 取得や liff.getProfile は
//      使えない可能性があるが、LIFF SDK 初期化に失敗しても画面が真っ白にならないよう、
//      レンダラー側で graceful fallback している。
//
//   2) 実機 LIFF URL — `https://liff.line.me/{LIFF_ID}/work/{workId}/pages/{pageId}`
//      LINE アプリ内ブラウザで開いて UID 取得 / 位置情報 / shareTargetPicker などを含む
//      本番動作を確認するためのもの。
//      ※ LINE Developers 側の Endpoint URL は `${BASE}/liff` のように LIFF プレイヤー用
//        入口に向けておくこと。Endpoint URL がルート (/) や `/oas` のように管理画面側に
//        向いていると、LIFF アプリを開いたときに Whale Studio 本体が開いてしまう。
//
// ベース URL の解決:
//   - `process.env.NEXT_PUBLIC_BASE_URL` を最優先 (本番 / Vercel Preview 共通の規約)
//   - 未設定時は `window.location.origin` でフォールバック
//   - localhost のときは「スマホからアクセスできない」注意を表示
//
// セキュリティ方針:
//   - 本パネルでは **公開済みのページ URL のみ** を表示する。
//   - 旧 API (/api/liff/works/[workId]?preview=1) は認証なしで draft / archived を返してしまうため、
//     ここから draft プレビュー URL を貼り出すと第三者が閲覧できてしまう。
//     安全な draft プレビューは preview token / owner 認証付き API を別 PR で実装する。
//
// QR コード: 既存で qrcode.react (QRCodeSVG) を使っているのでそれを再利用する。
// 実機 LIFF URL がある (LIFF_ID 設定済み) ときは QR を実機 LIFF URL に切り替え、
// 未設定時はブラウザ URL を載せる + 注意文を出す。

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { buttonClass } from "@/components/shared";

interface Props {
  /** Work の DB 内部 ID (UUID)。URL 生成自体には publicId を優先する */
  workId: string;
  /** Work の公開 URL 用短縮 ID。指定があれば URL に publicId を使う (短縮 URL)。 */
  workPublicId?: string;
  /** 個別 LIFF ページの DB 内部 ID (UUID)。指定があれば /pages/:pageId 形式の URL を生成する。 */
  pageId?: string;
  /** 個別 LIFF ページの公開 URL 用短縮 ID。指定があれば URL に publicId を使う (短縮 URL)。 */
  pagePublicId?: string;
  publishStatus: "draft" | "published" | "archived";
}

function buildBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

/** LIFF アプリの sub-path 部分。LINE Developers の Endpoint URL に付与される相対パス。
 *  Endpoint URL = `${BASE}/liff` を想定しているので、ここでは `/liff` を含めない。
 *  short URL: publicId が指定されていれば /w/{wp}/p/{pp} を使う、無ければ旧 /work/{w}/pages/{p}。 */
function buildLiffSubPath(args: {
  workId: string; workPublicId?: string; pageId?: string; pagePublicId?: string;
}): string {
  const { workId, workPublicId, pageId, pagePublicId } = args;
  if (workPublicId && pagePublicId) return `/w/${workPublicId}/p/${pagePublicId}`;
  if (workPublicId)                  return `/w/${workPublicId}`;
  if (pageId)                        return `/work/${workId}/pages/${pageId}`;
  return `/work/${workId}`;
}

/** ブラウザ用 URL (BASE 込み)。同じく publicId 優先。 */
function buildBrowserPath(args: {
  workId: string; workPublicId?: string; pageId?: string; pagePublicId?: string;
}): string {
  return `/liff${buildLiffSubPath(args)}`;
}

export function LiffDevicePreviewLinks({ workId, workPublicId, pageId, pagePublicId, publishStatus }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // SSR では window が無いので mount 後に解決する
  useEffect(() => {
    setBaseUrl(buildBaseUrl());
  }, []);

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim() || "";

  const browserUrlExplicit = useMemo(() => {
    if (!baseUrl) return "";
    return `${baseUrl}${buildBrowserPath({ workId, workPublicId, pageId, pagePublicId })}`;
  }, [baseUrl, workId, workPublicId, pageId, pagePublicId]);

  const liffUrl = useMemo(() => {
    if (!liffId) return "";
    return `https://liff.line.me/${liffId}${buildLiffSubPath({ workId, workPublicId, pageId, pagePublicId })}`;
  }, [liffId, workId, workPublicId, pageId, pagePublicId]);

  const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1");
  const isPublished = publishStatus === "published";

  const handleCopy = async (key: string, url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(key);
        window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1500);
      } catch {
        // 失敗時は何もしない (alert はうるさい)
      }
    }
  };

  if (!baseUrl) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">実機で確認する</h2>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
          下記の URL またはQRコードで、PC ブラウザ・スマホ・LINE アプリ内ブラウザでの表示を確認できます。
          {!isPublished && (
            <>
              <br />
              現在 <strong>未公開</strong> のため、この URL ではまだ閲覧できません。公開すると有効になります。
            </>
          )}
        </p>
        {isLocalhost && (
          <p className="text-[11px] text-amber-600 mt-1">
            ※ localhost で起動中のため、スマホからは直接アクセスできません。Vercel Preview など外部からアクセスできる URL で確認してください。
          </p>
        )}
      </div>

      {/* ── ブラウザ確認用 URL ── */}
      <UrlRow
        label="ブラウザ確認用 URL"
        helpText="PC/スマホのブラウザで開く。見た目だけの確認に使う。LINE UID / shareTargetPicker など LIFF SDK 機能は使えない。"
        url={browserUrlExplicit}
        disabled={!isPublished}
        copied={copied === "browser"}
        onCopy={() => handleCopy("browser", browserUrlExplicit)}
        showQr={!liffId}
      />

      {/* ── 実機 LIFF URL ── */}
      {liffId ? (
        <UrlRow
          label="実機 LIFF URL"
          helpText="LINE アプリ内ブラウザで開く。LINE UID / プロフィール / shareTargetPicker など本番動作を確認できる。"
          url={liffUrl}
          disabled={!isPublished}
          copied={copied === "liff"}
          onCopy={() => handleCopy("liff", liffUrl)}
          showQr
        />
      ) : (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-[12px] text-amber-800 leading-relaxed">
          <strong>LIFF ID 未設定</strong>: 実機 LIFF URL を発行するには <code className="text-[10px] bg-white border border-amber-200 px-1 rounded">NEXT_PUBLIC_LIFF_ID</code> を環境変数に設定してください。
          設定後、LINE Developers の Endpoint URL を{" "}
          <code className="text-[10px] bg-white border border-amber-200 px-1 rounded">{baseUrl}/liff</code>
          {" "}にすると、LIFF アプリから本ページを開けるようになります。
        </div>
      )}

      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          <strong>LINE Developers 側の設定:</strong> 該当 LIFF アプリの Endpoint URL を
          {" "}<code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">{baseUrl}/liff</code>{" "}
          に設定してください。Endpoint URL がルート ( / ) や{" "}
          <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">/oas</code>{" "}
          のように管理画面側に向いていると、LIFF を開いたとき Whale Studio 本体が表示されてしまいます。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          ※ 下書き / アーカイブ状態での実機プレビューは現在対応していません。安全な限定共有 (preview token / owner 認証) は別 PR で対応予定です。
        </p>
      </div>

      {/* QR は片方の UrlRow に表示する。両方表示するとレイアウトが重くなるため。 */}
      {/* ↑ 上記 UrlRow の showQr で制御 */}
    </div>
  );
}

function UrlRow({
  label, helpText, url, disabled, copied, onCopy, showQr,
}: {
  label: string;
  helpText: string;
  url: string;
  disabled: boolean;
  copied: boolean;
  onCopy: () => void;
  showQr: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-3 flex flex-col sm:flex-row gap-3 ${
        disabled ? "bg-gray-50 border-gray-200" : "bg-white border-gray-200"
      }`}
    >
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <div className="text-xs font-semibold text-gray-900 mb-0.5">{label}</div>
          <div className="text-[11px] text-gray-500 leading-relaxed">{helpText}</div>
        </div>
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`w-full px-2 py-1.5 border border-gray-200 rounded text-[12px] font-mono ${
            disabled ? "bg-gray-100 text-gray-500" : "bg-white text-gray-800"
          }`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled}
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            {copied ? "コピーしました!" : "URL をコピー"}
          </button>
          <a
            href={disabled ? undefined : url}
            target="_blank"
            rel="noopener noreferrer"
            className={`px-3 py-1 border border-gray-200 text-gray-700 rounded text-xs hover:bg-gray-50 ${
              disabled ? "pointer-events-none opacity-40" : ""
            }`}
          >
            別タブで開く
          </a>
        </div>
      </div>

      {showQr && (
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div
            className={`p-2 border border-gray-200 rounded bg-white ${
              disabled ? "opacity-40" : ""
            }`}
          >
            <QRCodeSVG value={url || "https://example.com"} size={96} level="M" />
          </div>
          <div className="text-[10px] text-gray-400">QR でスマホから</div>
        </div>
      )}
    </div>
  );
}
