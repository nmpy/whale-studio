// src/components/shared/PlanTag.tsx
// プラン制限タグ。デザインガイド §1.4 + §4 「PlanTag」 に準拠。
//
// 守ること:
// - 赤 / 黄 / CTA で煽らない (= §1.4)
// - 文言は「Standardプラン」など「以上」を付けない (= §4)
// - 凡例として使うときは「🔒 は対応プランの機能です」
// - 専用グレー: text-[#8a958f] bg-[#f0f2f1] (= ガイドが直書きを許す例外色)
//
// 「制限」ではなく「機能紹介としてのラベル」という位置付け。

interface Props {
  /** 表示するプラン名 (例: "Standard" / "Plus" / "Pro")。"プラン" は内部で付与。 */
  plan:       string;
  className?: string;
}

// インライン SVG (= 依存ライブラリを増やさない)。
// 将来 lucide-react を導入したら差し替える。
function LockIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PlanTag({ plan, className = "" }: Props) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 " +
        "text-[10px] font-bold leading-tight " +
        "text-[#8a958f] bg-[#f0f2f1] " + className
      }
    >
      <LockIcon size={10} />
      {plan}プラン
    </span>
  );
}
