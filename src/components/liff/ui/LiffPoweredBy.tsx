// src/components/liff/ui/LiffPoweredBy.tsx
//
// LIFF 新UI: "Powered by Whale Studio" フッター。
//   役割重複を避けるため、独自実装はせず既存 LiffStudioFooter / shouldShowWhaleStudioCredit を
//   そのまま再 export する（単一の真実源）。新UI側からは ui バレル経由で参照できるようにするのが目的。

export { LiffStudioFooter as LiffPoweredBy, shouldShowWhaleStudioCredit } from "../LiffStudioFooter";
