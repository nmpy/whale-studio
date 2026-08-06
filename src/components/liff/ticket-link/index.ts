// src/components/liff/ticket-link/index.ts
//
// チケット連携 LIFF 画面の部品バレル。TicketLinkRenderer からのみ参照する想定。

export { TicketLinkShell } from "./TicketLinkShell";
export { TicketLinkStepHeading } from "./TicketLinkStepHeading";
export { TicketLinkSummaryCard } from "./TicketLinkSummaryCard";
export type { TicketLinkSummaryItem } from "./TicketLinkSummaryCard";
export { TicketLinkStatusBadge } from "./TicketLinkStatusBadge";
export { TicketLinkSuccessIcon } from "./TicketLinkSuccessIcon";
export { TicketLinkField } from "./TicketLinkField";
export { TicketLinkActions, TicketLinkPrimaryButton, TicketLinkTextButton } from "./TicketLinkActions";

export {
  TICKET_LINK_COPY,
  TICKET_LINK_STEP_TOTAL,
  ticketLinkStepPosition,
  ticketLinkStepIndicator,
  validateManualStep,
  ticketReviewRows,
  finalReviewRows,
  completionRows,
} from "./flow";
export type { TicketLinkStep, SummaryRow, SummarySource, ManualStepValidation } from "./flow";

export {
  TL_INPUT, TL_INPUT_NORMAL, TL_INPUT_ERROR, TL_SELECT, TL_SELECT_PLACEHOLDER, TL_READONLY_FIELD, TL_LABEL,
  TL_REQUIRED_BADGE, TL_FIELD_ERROR, TL_CTA_PRIMARY, TL_CTA_NEUTRAL,
  TL_CTA_DISABLED, TL_TEXT_BUTTON, TL_CARD, TL_CARD_ROW,
  TL_CARD_ROW_LABEL, TL_CARD_ROW_VALUE, TL_STATUS_BADGE,
} from "./styles";
