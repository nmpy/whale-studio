// src/components/liff/image-aspect.ts
// PR-BLK4b: 画像ブロックの表示比率（aspect_ratio）解決（純関数・no JSX → node テスト可）。
//
// 未設定 / 不明値 → "original"（元画像の比率＝既存挙動）に安全フォールバック。
// "1:1" | "4:3" | "16:9" はそのまま。size とは別軸（size は最大高さ、これは枠の比率）。

export type ImageAspectRatio = "original" | "1:1" | "4:3" | "16:9";

/** CSS の aspect-ratio 値（"original" は枠比率を適用しないので含めない）。 */
export const ASPECT_RATIO_CSS: Record<Exclude<ImageAspectRatio, "original">, string> = {
  "1:1":  "1 / 1",
  "4:3":  "4 / 3",
  "16:9": "16 / 9",
};

/** settings.aspect_ratio を安全に正規化（未設定/不明値→"original"）。 */
export function resolveImageAspectRatio(value: string | undefined): ImageAspectRatio {
  if (value === "1:1" || value === "4:3" || value === "16:9") return value;
  return "original";
}
