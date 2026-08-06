// src/components/liff/ticket-link/TicketLinkStatusBadge.tsx
//
// 連携状態バッジ（「運営確認待ち」等）。文言はサーバーの playerFacingStatusLabel が正であり、
// ここでは配色を変えるだけ。文字そのものが状態を示すため、色だけに依存しない。

import { TL_STATUS_BADGE } from "./styles";

interface Props {
  label: string;
}

export function TicketLinkStatusBadge({ label }: Props) {
  return <span className={TL_STATUS_BADGE}>{label}</span>;
}
