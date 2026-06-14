// src/components/RequiredMark.tsx
// 必須項目をラベル横に小さな赤「＊」で示す共通コンポーネント（表示のみ）。
// 既存のバリデーション/必須仕様は変更しない。条件付き必須は呼び出し側で `when` を渡す。

export function RequiredMark({ when = true }: { when?: boolean }) {
  if (!when) return null;
  // 一般的なフォームの必須マーク程度に控えめに（小さめ・薄い赤・非太字）。
  // 警告/エラーに見えないトーン。aria-label は維持。
  return (
    <span
      aria-label="必須"
      title="必須項目"
      style={{ color: "#f87171", marginLeft: 3, fontWeight: 400, fontSize: 10 }}
    >
      ＊
    </span>
  );
}
