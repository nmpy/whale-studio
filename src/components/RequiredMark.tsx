// src/components/RequiredMark.tsx
// 必須項目をラベル横に小さな赤「＊」で示す共通コンポーネント（表示のみ）。
// 既存のバリデーション/必須仕様は変更しない。条件付き必須は呼び出し側で `when` を渡す。

export function RequiredMark({ when = true }: { when?: boolean }) {
  if (!when) return null;
  return (
    <span
      aria-label="必須"
      title="必須項目"
      style={{ color: "#dc2626", marginLeft: 4, fontWeight: 600, fontSize: "0.9em" }}
    >
      ＊
    </span>
  );
}
