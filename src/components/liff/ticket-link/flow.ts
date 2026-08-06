// src/components/liff/ticket-link/flow.ts
//
// LIFF「チケット連携」画面の **純ロジック / 文言定数**。DOM・React 非依存（vitest: environment "node" で検証する）。
//
// 位置づけ:
//   - 画面遷移そのもの（choice → manual → review → codeNames → final → done）と
//     API の呼び出し順は **既存のまま**。ここは「その状態をどう表示するか」だけを持つ。
//   - サーバー側 draft.step（TICKET_REVIEW → CODE_NAMES → FINAL_REVIEW）が正であり、
//     ここの進行表示は表示用にすぎない（不正順序はサーバーが 400 で弾く）。
//   - 予約番号の正規化・検証は @/lib/ticket-link/reservation-number をそのまま使う。
//     このファイルでは**新しい検証規則を作らない**（既存関数の呼び出し順を関数化するだけ）。

import {
  parseTicketLinkReservationNumberInput,
  ticketLinkReservationNumberErrorMessage,
} from "@/lib/ticket-link/reservation-number";

/** 既存の画面遷移。値・順序ともに変更しない。 */
export type TicketLinkStep = "choice" | "manual" | "review" | "codeNames" | "final" | "done";

/**
 * 進行表示（`n / m`）の総ステップ数。
 *
 * デザイン原案は `1 / 3`・`2 / 3` だったが、実フローには **コードネーム入力**（サーバー step
 * CODE_NAMES）が存在するため入力〜確認は 4 画面ある。番号の付かない画面を作らないよう、
 * 実フローに合わせて 4 とする（レイアウト・見た目はデザイン原案どおり）。
 */
export const TICKET_LINK_STEP_TOTAL = 4;

/** 進行表示の位置。入口(choice)と完了(done)は表示しない（null）。 */
export function ticketLinkStepPosition(step: TicketLinkStep): number | null {
  switch (step) {
    case "manual":    return 1;
    case "review":    return 2;
    case "codeNames": return 3;
    case "final":     return 4;
    default:          return null; // choice / done
  }
}

/** 進行表示の文字列（例 "2 / 4"）。表示しない画面では null。 */
export function ticketLinkStepIndicator(step: TicketLinkStep): string | null {
  const pos = ticketLinkStepPosition(step);
  return pos === null ? null : `${pos} / ${TICKET_LINK_STEP_TOTAL}`;
}

// ─── 画面文言 ────────────────────────────────────────────────────────────────
//
// CMS 側で編集できる文言（ページタイトル / ページ説明 / completionMessage / 報告ボタン）は
// ここに持たない。ここは「CMS に設定項目が無い固定文言」だけを 1 か所に集約する。

export const TICKET_LINK_COPY = {
  /** 全画面共通の見出し（CMS のページタイトルが無い場合のフォールバック）。 */
  title: "チケット連携",

  /** 画面1: 連携方法の選択。CMS のページ説明が無い場合のフォールバック。 */
  choiceDescription: "ご購入いただいたチケットをLINEアカウントと連携します。連携方法をお選びください。",
  choiceManualLabel: "手動で入力",
  choiceResumeLabel: "入力途中の情報を再開する",
  choiceRestartLabel: "最初からやり直す",
  /** 画像経路は未提供。押せて動かない導線を作らないため disabled 表示のみ。 */
  choiceImageLabel: "スクリーンショットから登録（準備中）",
  choiceUnavailable: "現在この作品では手動入力をご利用いただけません。",
  linkedSectionTitle: "連携済みのチケット",
  choiceSectionTitle: "チケットを連携する",
  choiceSectionTitleMore: "別のチケットを連携する",

  /** 画面2: チケット情報入力。 */
  manualDescription: "チケット情報をご入力ください。",
  labelWork: "対象公演",
  labelTicketType: "チケット種別",
  labelName: "お名前",
  labelReservationNumber: "予約番号",
  placeholderTicketType: "選択してください",
  placeholderName: "チケット購入時のお名前",
  placeholderReservationNumber: "123-456",
  requiredMark: "必須",

  /** 画面3: 登録内容の確認（review = チケット情報の確認 / final = 最終確認）。 */
  reviewDescription: "以下の内容をご確認ください。よろしければ「この内容で進む」を押してください。",
  finalDescription: "以下の内容で登録します。よろしければ「この内容で登録」を押してください。",
  reviewNote: "登録後は運営側の予約情報と照合されます。",
  labelDateTime: "日時",
  labelCodeNames: "コードネーム",
  labelLinkStatus: "連携状態",

  /** コードネーム入力。 */
  codeNamesDescription: "参加される方のコードネームをご入力ください。",
  codeNamesTitle: "コードネームを入力",

  /** ボタン。 */
  next: "この内容で進む",
  back: "戻る",
  backToEdit: "戻って修正する",
  submit: "この内容で登録",
  submitting: "登録しています…",
  confirmCodeNames: "登録内容を確認する",
  close: "閉じる",

  /** 画面4: 登録受付完了。 */
  doneTitle: "チケット連携を受け付けました",
  doneTitleAlready: "すでに連携済みです",
  defaultStatusLabel: "運営確認待ち",

  /** エラー。 */
  errorTicketTypeRequired: "チケット種別を選択してください。",
  errorNameRequired: "お名前を入力してください。",
  errorReservationNumberCheck: "予約番号を確認してください。",
  errorReservationNumberFormat: "予約番号の形式が正しくありません。",
  errorSubmitFailed: "チケット連携を登録できませんでした。時間をおいて再度お試しください。",
  errorInputInvalid: "入力内容を確認してください。",
  errorUnavailable: "この機能は現在ご利用いただけません。",
} as const;

// ─── 手動入力ステップの検証 ─────────────────────────────────────────────────

export interface ManualStepInput {
  ticketTypeKey: string;
  purchaserName: string;
  /** 入力欄の表示値（整形済み）。 */
  reservationNumber: string;
  /** 入力中に既に立っている予約番号エラー（不正文字など）。 */
  reservationNumberError: string | null;
}

export type ManualStepValidation =
  | { ok: true; normalizedReservationNumber: string }
  | {
      ok: false;
      /** フォーム全体のエラー文言。 */
      formError: string;
      /** 最初に直すべき項目（フォーカス移動用）。 */
      field: "ticketType" | "purchaserName" | "reservationNumber";
      /** 予約番号欄の直下に出す文言（更新が必要なときのみ）。 */
      reservationNumberError?: string;
    };

/**
 * 「この内容で進む」を押したときのクライアント側検証。
 *
 * 既存挙動との差分:
 *   - お名前の未入力チェックのみ **追加**（デザイン上 必須 のため）。サーバー側スキーマは
 *     従来どおり optional で、API 仕様は変更していない。
 *   - チケット種別 / 予約番号の判定順・文言・正規化は既存実装のまま。
 */
export function validateManualStep(input: ManualStepInput): ManualStepValidation {
  if (!input.ticketTypeKey) {
    return { ok: false, formError: TICKET_LINK_COPY.errorTicketTypeRequired, field: "ticketType" };
  }
  if (input.purchaserName.trim().length === 0) {
    return { ok: false, formError: TICKET_LINK_COPY.errorNameRequired, field: "purchaserName" };
  }
  // 不正文字エラーが残っている間は送信しない（黙って正常値として確定させない）。
  if (input.reservationNumberError) {
    return { ok: false, formError: TICKET_LINK_COPY.errorReservationNumberCheck, field: "reservationNumber" };
  }
  const parsed = parseTicketLinkReservationNumberInput(input.reservationNumber);
  if (!parsed.ok) {
    return {
      ok: false,
      formError: TICKET_LINK_COPY.errorReservationNumberFormat,
      field: "reservationNumber",
      reservationNumberError: ticketLinkReservationNumberErrorMessage(parsed.reason),
    };
  }
  return { ok: true, normalizedReservationNumber: parsed.normalized };
}

// ─── 確認カードの行 ──────────────────────────────────────────────────────────

export interface SummaryRow {
  label: string;
  value: string;
}

/** 未入力・未確定は "—"（空文字を素通しさせない）。 */
function display(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : "—";
}

export interface SummarySource {
  workTitle: string;
  /** 公演日時（現状は「運営確認後に反映されます」固定文言がサーバーから来る）。 */
  performanceDateTimeText: string;
  ticketTypeLabel: string | null;
  purchaserName: string;
  /** 正規化済み予約番号（確認画面は入力者本人向けのため全桁表示する）。 */
  reservationNumber: string;
  codeNames?: string[];
}

/** 画面3-a: チケット情報の確認（review）。コードネーム入力前なので名前まで。 */
export function ticketReviewRows(s: SummarySource): SummaryRow[] {
  return [
    { label: TICKET_LINK_COPY.labelWork,              value: display(s.workTitle) },
    { label: TICKET_LINK_COPY.labelDateTime,          value: display(s.performanceDateTimeText) },
    { label: TICKET_LINK_COPY.labelTicketType,        value: display(s.ticketTypeLabel) },
    { label: TICKET_LINK_COPY.labelName,              value: display(s.purchaserName) },
    { label: TICKET_LINK_COPY.labelReservationNumber, value: display(s.reservationNumber) },
  ];
}

/** 画面3-b: 最終確認（final）。登録される内容そのもの。 */
export function finalReviewRows(s: SummarySource): SummaryRow[] {
  return [
    ...ticketReviewRows(s),
    { label: TICKET_LINK_COPY.labelCodeNames, value: display((s.codeNames ?? []).filter(Boolean).join("、")) },
  ];
}

/** 画面4: 完了。個人名は再表示しない（プライバシー配慮 / 既存の完了画面も名前を出していない）。 */
export function completionRows(s: { workTitle: string; reservationNumber: string }): SummaryRow[] {
  return [
    { label: TICKET_LINK_COPY.labelWork,              value: display(s.workTitle) },
    { label: TICKET_LINK_COPY.labelReservationNumber, value: display(s.reservationNumber) },
  ];
}
