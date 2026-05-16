"use client";

// src/components/liff/werewolf/WerewolfQRDisplay.tsx
//
// 配役スロット 1 件分の QR コード + URL コピー + token 再発行ボタンを表示する小コンポーネント。
// CMS の slot 行から表示する。

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  slotToken:    string;
  liffId?:      string;
  /** token 再発行クリック時。確認ダイアログは内部で出す。 */
  onRotateToken?: () => Promise<void> | void;
  /** 印刷 / 配布で誤って再発行しないよう、明示的に有効化されるまで隠す。 */
  rotateDisabled?: boolean;
}

/** プレイヤーが実機 LIFF で開く URL を組み立てる。
 *  LIFF ID があれば https://liff.line.me/<id>/r/<token>、無ければ /liff/r/<token> (相対) を返す。 */
function buildPlayerUrl(args: { slotToken: string; liffId?: string }): {
  liffUrl:    string;
  directUrl:  string;
} {
  const baseDirect = typeof window !== "undefined" ? window.location.origin : "";
  const directUrl  = `${baseDirect}/liff/r/${args.slotToken}`;
  const liffUrl    = args.liffId
    ? `https://liff.line.me/${args.liffId}/r/${args.slotToken}`
    : directUrl;
  return { liffUrl, directUrl };
}

export function WerewolfQRDisplay({ slotToken, liffId, onRotateToken, rotateDisabled }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"liff" | "direct" | null>(null);
  const { liffUrl, directUrl } = buildPlayerUrl({ slotToken, liffId });

  // QR には実機で開いて欲しい LIFF URL を埋め込む (LIFF ID 未設定時はフォールバックで directUrl)。
  const qrValue = liffUrl;

  const copy = async (kind: "liff" | "direct", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 1500);
    } catch {
      // silent
    }
  };

  const handleRotate = async () => {
    if (!onRotateToken) return;
    if (!window.confirm("この slot の token を再発行しますか？\n古い QR コードは無効になります。")) return;
    await onRotateToken();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 text-xs border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50"
      >
        QR 表示
      </button>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 flex flex-col items-stretch gap-2 w-full">
      <div className="flex items-start gap-3">
        <div className="shrink-0 bg-white p-2 rounded border border-gray-200">
          <QRCodeSVG value={qrValue} size={120} level="M" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5">LINE LIFF URL (実機用)</p>
            <div className="flex items-center gap-1.5">
              <code className="text-[10px] text-gray-700 truncate flex-1 bg-white border border-gray-200 rounded px-1.5 py-1">
                {liffUrl}
              </code>
              <button
                type="button"
                onClick={() => copy("liff", liffUrl)}
                className="text-[10px] px-2 py-1 border border-gray-200 rounded hover:bg-white"
              >
                {copied === "liff" ? "✓" : "コピー"}
              </button>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5">直接 URL (確認用)</p>
            <div className="flex items-center gap-1.5">
              <code className="text-[10px] text-gray-700 truncate flex-1 bg-white border border-gray-200 rounded px-1.5 py-1">
                {directUrl}
              </code>
              <button
                type="button"
                onClick={() => copy("direct", directUrl)}
                className="text-[10px] px-2 py-1 border border-gray-200 rounded hover:bg-white"
              >
                {copied === "direct" ? "✓" : "コピー"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {onRotateToken && (
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotateDisabled}
            className="text-[11px] px-2.5 py-1 border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
            title="QR を配布してしまった後の差し替えに使います"
          >
            token を再発行
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] px-2.5 py-1 border border-gray-200 text-gray-600 rounded hover:bg-white"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
