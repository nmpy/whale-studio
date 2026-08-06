// src/components/liff/ticket-link/TicketLinkField.tsx
//
// 入力欄 1 件分のラベル + 必須表示 + エラー文言。
//
// アクセシビリティ:
//   - `htmlFor` で入力欄と必ず紐付ける（入力欄側の id は呼び出し側が渡す）。
//   - 必須は「必須」バッジ（視覚）と入力欄の `required` / `aria-required`（属性）の両方で示す。
//   - エラーは入力欄直下に文言で出し、`aria-describedby` で読み上げに繋ぐ。
//     文言はレイアウトが大きくずれないよう常に 1 行分の領域を持たせず、出たときだけ挿入する。

import type { ReactNode } from "react";
import { TL_LABEL, TL_REQUIRED_BADGE, TL_FIELD_ERROR } from "./styles";

interface Props {
  /** 紐付ける入力欄の id。 */
  htmlFor: string;
  label: string;
  required?: boolean;
  /** エラー文言。null / undefined なら非表示。 */
  error?: string | null;
  /** エラー要素の id（入力欄の aria-describedby に渡す値と一致させる）。 */
  errorId?: string;
  children: ReactNode;
}

export function TicketLinkField({ htmlFor, label, required, error, errorId, children }: Props) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={TL_LABEL}>
        <span>{label}</span>
        {required && <span className={`ml-1.5 ${TL_REQUIRED_BADGE}`}>必須</span>}
      </label>
      {children}
      {error && (
        <p id={errorId} className={TL_FIELD_ERROR} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
