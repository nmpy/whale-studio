// src/components/TesterBanner.tsx
//
// テスターモード表示バナー。
// tester 配下の各ページで共用。
//
// Props:
//   compact — true: 1行コンパクト表示（作品リストなど）
//             false（省略）: 標準2行表示（トップページ）

interface TesterBannerProps {
  compact?: boolean;
}

export function TesterBanner({ compact = false }: TesterBannerProps) {
  if (compact) {
    return (
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        padding:      "8px 14px",
        background:   "#fffbeb",
        border:       "1px solid #fde68a",
        borderRadius: "var(--radius-md)",
        marginBottom: 16,
        fontSize:     12,
        color:        "#b45309",
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
        <span>
          テスターモードでは、アカウントや作品を自由に作成・編集してお試しいただけます。プレビュー機能で実際の LINE 体験も確認できます。
        </span>
      </div>
    );
  }

  return (
    <div style={{
      padding:      "12px 16px",
      background:   "#fffbeb",
      border:       "1px solid #fde68a",
      borderRadius: "var(--radius-md)",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 15 }}>🔍</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>テスターモード</span>
        <span style={{ fontSize: 13, color: "#92400e" }}>—</span>
        <span style={{ fontSize: 13, color: "#92400e" }}>
          アカウントや作品を自由に作成・編集してお試しいただけます。
        </span>
      </div>
      <div style={{
        display:       "flex",
        flexDirection: "column",
        gap:           2,
        paddingLeft:   23,
        fontSize:      12,
        color:         "#b45309",
        lineHeight:    1.6,
      }}>
        <span>※ プレビュー機能で実際の LINE 体験をシミュレーションできます。</span>
        <span>本番環境とは独立した確認用の環境です。</span>
      </div>
    </div>
  );
}
