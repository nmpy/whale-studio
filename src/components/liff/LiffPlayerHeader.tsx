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
      className="px-4 py-3"
      style={{
        background: "var(--liff-header-bg)",
        color: "var(--liff-header-text)",
      }}
    >
      <div className="max-w-md mx-auto">
        {/* LINE Design System に揃え、ヘッダー (作品名) は中央寄せ。
            ヘッダー帯は full-width、内側で px-4 + 中央揃え。 */}
        <h1 className="text-[18px] leading-tight font-bold tracking-tight break-words text-center">
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
