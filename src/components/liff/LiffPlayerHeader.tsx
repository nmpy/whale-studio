"use client";

// src/components/liff/LiffPlayerHeader.tsx
// LIFF プレイヤー画面用の共通ヘッダー。
// ヘッダーには「作品名」を表示するのが基本仕様。
// LIFF ページ単体のタイトルは本文側の h1 で表示する (renderers 側で実装)。
//
// 受け取りは workTitle 優先、未指定なら pageTitle にフォールバック、最後は "LIFF"。
// 古い呼び出し (workTitle 無し) でも壊れないようにフォールバック付き。

interface Props {
  /** 作品名。新仕様ではこれが優先表示される */
  workTitle?: string | null;
  /** 互換: ページタイトル。workTitle 未指定のときだけ使う。新規実装では渡さない想定 */
  pageTitle?: string | null;
  /** 互換用エイリアス: 旧 API。pageTitle 相当として扱う */
  title?: string | null;
}

export function LiffPlayerHeader({ workTitle, pageTitle, title }: Props) {
  const shown = pickTitle({ workTitle, pageTitle, title });
  return (
    <header
      className="px-4 h-14 flex items-center justify-center border-b"
      style={{
        background: "var(--liff-header-bg)",
        color: "var(--liff-header-text)",
        borderColor: "var(--liff-header-border)",
      }}
    >
      <div className="max-w-md mx-auto w-full">
        {/* 旧: 緑帯 + 太字大きめ → 白背景 + 細罫線 + 17px 中央寄せ。
            「LINE 内で読む静かなドキュメント」として上品に見えるように。 */}
        <h1 className="text-[17px] leading-tight font-bold break-words text-center">
          {shown}
        </h1>
      </div>
    </header>
  );
}

function pickTitle({ workTitle, pageTitle, title }: Props): string {
  const w = (workTitle ?? "").trim();
  if (w) return w;
  const p = (pageTitle ?? title ?? "").trim();
  if (p) return p;
  return "LIFF";
}
