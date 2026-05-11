"use client";

// src/components/liff/LiffDevicePreviewLinks.tsx
// LIFF 設定画面に「実機で確認」用の URL / コピー / QR を出すパネル。
//
// URL の組み立て:
//   - ベース URL は process.env.NEXT_PUBLIC_BASE_URL を最優先、未設定時は window.location.origin。
//     これにより本番 / Vercel Preview / 各種プレビュー環境でも自前のオリジンを使う。
//   - localhost / 127.0.0.1 のみの場合は注意文を出す (本番 UI に localhost を貼り付けないため)。
//   - 公開ページ: ${BASE}/liff/work/${workId}
//
// セキュリティ方針:
//   - 本パネルでは **公開済みの URL のみ** を表示する。
//   - 既存 API (/api/liff/works/[workId]?preview=1) は認証なしで draft / archived を返してしまう
//     ため、ここから draft の実機プレビュー URL を一般 UI に貼り出すと、共有された第三者が公開前の
//     内容を閲覧可能になってしまう。
//   - draft の実機プレビューを安全に提供するには preview token / owner 認証つきの専用 API が必要。
//     後続 PR で対応予定。
//
// LIFF アプリ URL (https://liff.line.me/<liffId>) について:
//   - LINE Developers で設定された LIFF アプリの endpoint URL は通常 /liff/... のチェックイン用ページに
//     向いており、本ページ用には別個に LIFF アプリを登録しないと使えない。
//   - そのため本パネルでは web URL を主とし、LIFF SDK 経由で開きたい場合は事前に LIFF アプリを用意する旨を
//     注記として残す。
//
// QR コード: 既存で qrcode.react (QRCodeSVG) を使っているのでそれを再利用する。

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  workId: string;
  /** 個別 LIFF ページ ID。指定があれば /pages/:pageId 形式の URL を生成する。 */
  pageId?: string;
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

export function LiffDevicePreviewLinks({ workId, pageId, publishStatus }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // SSR では window が無いので mount 後に解決する
  useEffect(() => {
    setBaseUrl(buildBaseUrl());
  }, []);

  const publicUrl = useMemo(() => {
    if (!baseUrl) return "";
    return pageId
      ? `${baseUrl}/liff/work/${workId}/pages/${pageId}`
      : `${baseUrl}/liff/work/${workId}`;
  }, [baseUrl, workId, pageId]);

  const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1");

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
          下記の URL またはQRコードを使って、スマホで実機表示を確認できます。
          {publishStatus !== "published" && (
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

      <UrlRow
        label="公開ページ URL"
        helpText={publishStatus === "published" ? "公開中のページにアクセスします" : "公開後にこの URL で閲覧できます"}
        url={publicUrl}
        disabled={publishStatus !== "published"}
        copied={copied === "public"}
        onCopy={() => handleCopy("public", publicUrl)}
      />

      <p className="text-[11px] text-gray-400 leading-relaxed">
        ※ 下書き / アーカイブ状態での実機プレビューは現在対応していません。安全なプレビュー (限定共有) は後続 PR で対応予定です。
      </p>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        ※ LINE 内ブラウザ (LIFF) として開きたい場合は LINE Developers で別途 LIFF アプリ
        (endpoint URL: <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">{baseUrl}/liff/work/&lt;workId&gt;</code>) を登録し、その LIFF URL (
        <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">https://liff.line.me/&lt;liffId&gt;</code>
        ) を使ってください。Web URL でも表示自体は確認できますが、LIFF SDK 経由の機能 (shareTargetPicker など) は LINE 内で開いたときのみ動作します。
      </p>
    </div>
  );
}

function UrlRow({
  label, helpText, url, disabled, copied, onCopy,
}: {
  label: string;
  helpText: string;
  url: string;
  disabled: boolean;
  copied: boolean;
  onCopy: () => void;
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
          <div className="text-[11px] text-gray-500">{helpText}</div>
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled}
            className="px-3 py-1 bg-violet-500 text-white rounded text-xs font-semibold hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
    </div>
  );
}
