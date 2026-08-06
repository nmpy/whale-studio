// src/components/liff/ticket-link/TicketLinkSummaryCard.tsx
//
// 確認 / 完了画面の内容カード。左に項目名、右に値。項目間は薄い区切り線。
// 値は折り返す（長いチケット種別名でも横スクロールを発生させない）。
//
// `node` を渡した行は値の代わりに任意の要素（ステータスバッジ等）を描画する。

import type { ReactNode } from "react";
import { cx } from "../ui/tokens";
import { TL_CARD, TL_CARD_ROW, TL_CARD_ROW_LABEL, TL_CARD_ROW_VALUE } from "./styles";
import type { SummaryRow } from "./flow";

export interface TicketLinkSummaryItem extends Partial<SummaryRow> {
  label: string;
  value?: string;
  node?: ReactNode;
}

interface Props {
  items: TicketLinkSummaryItem[];
  className?: string;
}

export function TicketLinkSummaryCard({ items, className }: Props) {
  return (
    <dl className={cx(TL_CARD, className)}>
      {items.map((item) => (
        <div key={item.label} className={TL_CARD_ROW}>
          <dt className={TL_CARD_ROW_LABEL}>{item.label}</dt>
          <dd className={cx(TL_CARD_ROW_VALUE, item.node ? "flex justify-end" : null)}>
            {item.node ?? item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
