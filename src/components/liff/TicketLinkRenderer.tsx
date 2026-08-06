"use client";

// src/components/liff/TicketLinkRenderer.tsx
//
// LIFF「チケット連携」タブ（手動登録のみ）。
//
// 画面遷移（**変更していない**）:
//   choice → manual → review → codeNames → final → done
//
// サーバー側の draft.step（TICKET_REVIEW → CODE_NAMES → FINAL_REVIEW）が正であり、
// この画面の state は表示用にすぎない。不正な順序で API を呼んでも 400 になる。
//
// 画像登録は **公開しない**（押せて動かない導線を作らない）。「準備中」表示のみ。
//
// このファイルは「状態と API 呼び出し」を持ち、見た目は ./ticket-link/ の部品に委ねる。
// デザイン更新（#: LIFF チケット連携 UI）での変更点は表示のみ:
//   - API 仕様 / 呼び出し順 / 予約番号の正規化・検証 / チケット種別の内部値は一切変えていない。
//   - お名前の未入力チェックのみクライアント側に追加（サーバー側スキーマは従来どおり optional）。

import { useCallback, useEffect, useRef, useState } from "react";
import { LiffLoadingState, LiffErrorState } from "./ui";
import { TicketLinkReportButton } from "./TicketLinkReportButton";
import {
  TicketLinkShell,
  TicketLinkStepHeading,
  TicketLinkSummaryCard,
  TicketLinkStatusBadge,
  TicketLinkSuccessIcon,
  TicketLinkField,
  TicketLinkActions,
  TicketLinkPrimaryButton,
  TicketLinkTextButton,
  TICKET_LINK_COPY,
  ticketLinkStepIndicator,
  validateManualStep,
  ticketReviewRows,
  finalReviewRows,
  completionRows,
  type TicketLinkStep,
  type TicketLinkSummaryItem,
} from "./ticket-link";
import {
  TL_INPUT, TL_INPUT_NORMAL, TL_INPUT_ERROR, TL_SELECT, TL_SELECT_PLACEHOLDER, TL_READONLY_FIELD,
  TL_CTA_DISABLED, TL_CARD,
} from "./ticket-link/styles";
import { cx } from "./ui/tokens";
import {
  normalizeReservationNumber,
  formatReservationNumberInput,
  parseTicketLinkReservationNumberInput,
  ticketLinkReservationNumberErrorMessage,
  RESERVATION_NUMBER_MAX_LENGTH,
} from "@/lib/ticket-link/reservation-number";

interface TicketTypeOption {
  ticketTypeKey: string;
  ticketTypeLabel: string;
  participantCount: number;
}

interface ExistingLink {
  id: string;
  statusLabel: string;
  ticketTypeLabel: string | null;
  participantCount: number;
  reservationNumberMasked: string;
  codeNames: string[];
  confirmedAt: string;
}

interface Config {
  manualInputAvailable: boolean;
  imageInputAvailable: boolean;
  ticketTypes: TicketTypeOption[];
  workTitle: string | null;
  report: { enabled: boolean; label: string; message: string };
  completionMessage: string;
  performanceDateTimeText: string;
  draft: { id: string; step: string | null; ticketTypeKey: string | null } | null;
  links: ExistingLink[];
}

interface Props {
  /** 作品識別子（UUID / publicId）。 */
  workId: string;
  /** 作品名（config API から取得できないときのフォールバック）。 */
  workTitle?: string;
  /** CMS プレビュー時は API を叩かず、実送信もしない。 */
  preview?: boolean;
  /** CMS のページタイトル（未設定なら「チケット連携」）。 */
  pageTitle?: string | null;
  /** CMS のページ説明（画面1の説明文。未設定なら既定文言）。 */
  pageDescription?: string | null;
  /** "Powered by Whale Studio" を出すか（ページ設定に従う）。 */
  showCredit?: boolean;
  /** テスト用: LIFF アクセストークン取得の差し替え。 */
  getAccessToken?: () => Promise<string | null>;
  /** テスト用: fetch 差し替え。 */
  fetchImpl?: typeof fetch;
}

async function defaultGetAccessToken(): Promise<string | null> {
  try {
    const mod = await import("@line/liff");
    const liff = mod.default as unknown as { getAccessToken?: () => string | null };
    return liff.getAccessToken?.() ?? null;
  } catch {
    return null;
  }
}

/** 既存の LIFF 終了処理と同じ手順（実機は closeWindow / それ以外は window.close）。 */
async function closeLiffWindow(): Promise<void> {
  try {
    const liff = (await import("@line/liff")).default;
    if (liff.isInClient()) {
      liff.closeWindow();
      return;
    }
  } catch {
    /* noop */
  }
  if (typeof window !== "undefined") window.close();
}

/** API のエラー文言があればそれを優先。空文字・欠落なら画面側の既定文言へ倒す。 */
function errorMessage(r: { json: { error?: { message?: string } } }, fallback: string): string {
  return r.json.error?.message?.trim() || fallback;
}

type FieldKey = "ticketType" | "purchaserName" | "reservationNumber";

export function TicketLinkRenderer({
  workId, workTitle: workTitleProp, preview,
  pageTitle, pageDescription, showCredit = true,
  getAccessToken, fetchImpl,
}: Props) {
  const doFetch = fetchImpl ?? fetch;
  const tokenFn = getAccessToken ?? defaultGetAccessToken;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [step, setStep] = useState<TicketLinkStep>("choice");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 入力状態（戻る操作で失わないよう保持する）
  const [ticketTypeKey, setTicketTypeKey] = useState("");
  const [purchaserName, setPurchaserName] = useState("");
  const [reservationNumber, setReservationNumber] = useState("");
  // 予約番号のエラーは「入力途中」では出さない。blur / 送信時にだけ立てる。
  const [reservationNumberError, setReservationNumberError] = useState<string | null>(null);
  const [ticketTypeError, setTicketTypeError] = useState<string | null>(null);
  const [purchaserNameError, setPurchaserNameError] = useState<string | null>(null);
  const [codeNames, setCodeNames] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [doneState, setDoneState] = useState<{ statusLabel: string; alreadyRegistered: boolean } | null>(null);

  const ticketTypeRef = useRef<HTMLSelectElement | null>(null);
  const purchaserNameRef = useRef<HTMLInputElement | null>(null);
  const reservationNumberRef = useRef<HTMLInputElement | null>(null);

  const focusField = useCallback((field: FieldKey) => {
    const el =
      field === "ticketType" ? ticketTypeRef.current
      : field === "purchaserName" ? purchaserNameRef.current
      : reservationNumberRef.current;
    el?.focus();
    el?.scrollIntoView?.({ block: "center" });
  }, []);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>, method: "POST" | "DELETE" = "POST") => {
      const accessToken = await tokenFn();
      const res = await doFetch(`/api/liff/works/${encodeURIComponent(workId)}/ticket-link${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, accessToken }),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json } as {
        ok: boolean; status: number; json: { data?: unknown; error?: { message?: string } };
      };
    },
    [doFetch, tokenFn, workId],
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await post("/config", {});
    if (!r.ok) {
      setLoadError(errorMessage(r, TICKET_LINK_COPY.errorUnavailable));
      setLoading(false);
      return;
    }
    const cfg = r.json.data as Config;
    setConfig(cfg);
    if (cfg.draft) {
      setDraftId(cfg.draft.id);
      if (cfg.draft.ticketTypeKey) setTicketTypeKey(cfg.draft.ticketTypeKey);
    }
    // 対象が 1 種別しか無いときは初期選択しておく（選択式にしない運用に合わせる）。
    if (cfg.ticketTypes.length === 1) setTicketTypeKey(cfg.ticketTypes[0].ticketTypeKey);
    setLoading(false);
  }, [post]);

  useEffect(() => {
    if (preview) { setLoading(false); return; }
    void loadConfig();
  }, [preview, loadConfig]);

  const selectedType = config?.ticketTypes.find((t) => t.ticketTypeKey === ticketTypeKey) ?? null;
  const workTitle = config?.workTitle ?? workTitleProp ?? "この作品";
  const heading = (pageTitle ?? "").trim() || TICKET_LINK_COPY.title;
  const indicator = ticketLinkStepIndicator(step);
  const normalizedReservationNumberForDisplay =
    normalizeReservationNumber(reservationNumber) ?? reservationNumber;

  // ── 読み込み / 読み込み失敗 ────────────────────────────────────────────────
  // レイアウトが大きくジャンプしないよう、通常画面と同じシェルの中に出す。
  if (loading) {
    return (
      <TicketLinkShell preview={preview} showCredit={showCredit}>
        <TicketLinkStepHeading title={heading} />
        <LiffLoadingState />
      </TicketLinkShell>
    );
  }
  if (loadError || !config) {
    return (
      <TicketLinkShell preview={preview} showCredit={showCredit}>
        <TicketLinkStepHeading title={heading} />
        <LiffErrorState message={loadError ?? TICKET_LINK_COPY.errorUnavailable} />
      </TicketLinkShell>
    );
  }

  // ── 画面4: 登録受付完了 ───────────────────────────────────────────────────
  if (step === "done") {
    const statusLabel = doneState?.statusLabel ?? TICKET_LINK_COPY.defaultStatusLabel;
    const items: TicketLinkSummaryItem[] = [
      { label: TICKET_LINK_COPY.labelLinkStatus, node: <TicketLinkStatusBadge label={statusLabel} /> },
      // 個人名は完了画面に再表示しない（登録内容の確認は前画面で済んでいる）。
      ...completionRows({ workTitle, reservationNumber: normalizedReservationNumberForDisplay }),
    ];
    return (
      <TicketLinkShell
        preview={preview}
        showCredit={showCredit}
        footer={
          <TicketLinkActions>
            {/* 登録済みデータを再送しない。LIFF を閉じるだけ。 */}
            <TicketLinkPrimaryButton tone="neutral" onClick={() => { void closeLiffWindow(); }}>
              {TICKET_LINK_COPY.close}
            </TicketLinkPrimaryButton>
          </TicketLinkActions>
        }
      >
        <div className="pt-6 text-center" role="status" aria-live="polite">
          <div className="flex justify-center">
            <TicketLinkSuccessIcon />
          </div>
          <h2 className="mt-5 text-[20px] font-bold leading-[1.4] text-[color:var(--liff-primary-text,#1F2329)]">
            {doneState?.alreadyRegistered ? TICKET_LINK_COPY.doneTitleAlready : TICKET_LINK_COPY.doneTitle}
          </h2>
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-[1.7] text-[color:var(--liff-secondary-text,#5B6168)]">
            {config.completionMessage}
          </p>
        </div>

        <TicketLinkSummaryCard className="mt-7" items={items} />

        {config.report.enabled && (
          <TicketLinkReportButton
            label={config.report.label}
            message={config.report.message}
            preview={preview}
          />
        )}
      </TicketLinkShell>
    );
  }

  // ── 画面1: 連携方法の選択（未登録 / 登録途中 / 登録完了済み） ──────────────
  if (step === "choice") {
    const description = (pageDescription ?? "").trim() || TICKET_LINK_COPY.choiceDescription;
    return (
      <TicketLinkShell preview={preview} showCredit={showCredit}>
        <TicketLinkStepHeading title={heading} description={description} />

        {config.links.length > 0 && (
          <section className="mb-7">
            <h3 className="mb-2.5 text-[14px] font-bold leading-[1.5] text-[color:var(--liff-primary-text,#1F2329)]">
              {TICKET_LINK_COPY.linkedSectionTitle}
            </h3>
            <div className="space-y-3">
              {config.links.map((l) => (
                <TicketLinkSummaryCard
                  key={l.id}
                  items={[
                    { label: TICKET_LINK_COPY.labelLinkStatus, node: <TicketLinkStatusBadge label={l.statusLabel} /> },
                    { label: TICKET_LINK_COPY.labelWork, value: workTitle },
                    { label: TICKET_LINK_COPY.labelDateTime, value: config.performanceDateTimeText },
                    { label: TICKET_LINK_COPY.labelTicketType, value: l.ticketTypeLabel ?? "—" },
                    { label: TICKET_LINK_COPY.labelReservationNumber, value: l.reservationNumberMasked },
                    { label: TICKET_LINK_COPY.labelCodeNames, value: l.codeNames.join("、") || "—" },
                  ]}
                />
              ))}
            </div>
          </section>
        )}

        {/* 既存登録があっても、複数予約のため「手動で入力」は消さない。 */}
        {config.manualInputAvailable ? (
          <section>
            {config.links.length > 0 && (
              <h3 className="mb-2.5 text-[14px] font-bold leading-[1.5] text-[color:var(--liff-primary-text,#1F2329)]">
                {TICKET_LINK_COPY.choiceSectionTitleMore}
              </h3>
            )}

            <div className="space-y-2.5">
              {draftId ? (
                <>
                  <TicketLinkPrimaryButton onClick={() => { setFormError(null); setStep("manual"); }}>
                    {TICKET_LINK_COPY.choiceResumeLabel}
                  </TicketLinkPrimaryButton>
                  <TicketLinkTextButton
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        await post("/draft", {}, "DELETE");
                        setDraftId(null); setTicketTypeKey(""); setPurchaserName("");
                        setReservationNumber(""); setCodeNames([]);
                        setReservationNumberError(null); setTicketTypeError(null); setPurchaserNameError(null);
                        setBusy(false);
                        await loadConfig();
                      })();
                    }}
                  >
                    {TICKET_LINK_COPY.choiceRestartLabel}
                  </TicketLinkTextButton>
                </>
              ) : (
                <TicketLinkPrimaryButton onClick={() => { setFormError(null); setStep("manual"); }}>
                  {TICKET_LINK_COPY.choiceManualLabel}
                </TicketLinkPrimaryButton>
              )}

              {/* 画像経路は未提供のため disabled + 「準備中」を明示する。 */}
              <button type="button" disabled aria-disabled="true" className={TL_CTA_DISABLED}>
                {TICKET_LINK_COPY.choiceImageLabel}
              </button>
            </div>
          </section>
        ) : (
          <p className="text-[13.5px] leading-[1.7] text-[color:var(--liff-secondary-text,#5B6168)]">
            {TICKET_LINK_COPY.choiceUnavailable}
          </p>
        )}
      </TicketLinkShell>
    );
  }

  // ── 画面2: チケット情報入力 ───────────────────────────────────────────────
  if (step === "manual") {
    const singleType = config.ticketTypes.length === 1 ? config.ticketTypes[0] : null;

    const submitManual = () => {
      setFormError(null);
      setTicketTypeError(null);
      setPurchaserNameError(null);

      // クライアント側でも正規化・形式検証する（サーバーでも再検証される）。
      const v = validateManualStep({
        ticketTypeKey, purchaserName, reservationNumber, reservationNumberError,
      });
      if (!v.ok) {
        if (v.field === "ticketType") setTicketTypeError(v.formError);
        if (v.field === "purchaserName") setPurchaserNameError(v.formError);
        if (v.reservationNumberError) setReservationNumberError(v.reservationNumberError);
        focusField(v.field);
        return;
      }

      void (async () => {
        setBusy(true);
        // 送信値は必ず厳格な正規形（例 "123-456"）。表示だけ整形して生値を送らない。
        const r = await post("/draft", {
          ticketTypeKey,
          purchaserName,
          reservationNumber: v.normalizedReservationNumber,
        });
        setBusy(false);
        if (!r.ok) { setFormError(errorMessage(r, TICKET_LINK_COPY.errorInputInvalid)); return; }
        const d = r.json.data as { draftId: string; participantCount: number };
        setDraftId(d.draftId);
        setCodeNames((prev) =>
          prev.length === d.participantCount ? prev : Array.from({ length: d.participantCount }, () => ""),
        );
        setStep("review");
      })();
    };

    return (
      <TicketLinkShell
        preview={preview}
        showCredit={showCredit}
        footer={
          <TicketLinkActions>
            {formError && (
              <p className="pb-2 text-[12.5px] leading-[1.6] text-[color:var(--liff-danger,#E22B2B)]" role="alert">
                {formError}
              </p>
            )}
            <TicketLinkPrimaryButton onClick={submitManual} busy={busy}>
              {TICKET_LINK_COPY.next}
            </TicketLinkPrimaryButton>
            {/* 戻る操作だけでは API を呼ばない。入力値も保持する。 */}
            <TicketLinkTextButton disabled={busy} onClick={() => { setFormError(null); setStep("choice"); }}>
              {TICKET_LINK_COPY.back}
            </TicketLinkTextButton>
          </TicketLinkActions>
        }
      >
        <TicketLinkStepHeading
          title={heading}
          indicator={indicator}
          description={TICKET_LINK_COPY.manualDescription}
        />

        <div className="space-y-4">
          {/* 対象公演 — 全作品検索はさせない。対象は現在の作品に固定。 */}
          <div className="space-y-1.5">
            <p className="text-[13.5px] font-medium leading-[1.6] text-[color:var(--liff-primary-text,#1F2329)]">
              {TICKET_LINK_COPY.labelWork}
            </p>
            <p className={TL_READONLY_FIELD}>{workTitle}</p>
          </div>

          {/* チケット種別 — value は表示名ではなく安定キー。 */}
          {singleType ? (
            <div className="space-y-1.5">
              <p className="text-[13.5px] font-medium leading-[1.6] text-[color:var(--liff-primary-text,#1F2329)]">
                {TICKET_LINK_COPY.labelTicketType}
              </p>
              <p className={TL_READONLY_FIELD}>{singleType.ticketTypeLabel}</p>
            </div>
          ) : (
            <TicketLinkField
              htmlFor="ticket-link-type"
              label={TICKET_LINK_COPY.labelTicketType}
              required
              error={ticketTypeError}
              errorId="ticket-link-type-error"
            >
              <div className="relative">
              <select
                id="ticket-link-type"
                ref={ticketTypeRef}
                className={cx(
                  TL_SELECT,
                  ticketTypeKey ? null : TL_SELECT_PLACEHOLDER,
                  ticketTypeError ? TL_INPUT_ERROR : TL_INPUT_NORMAL,
                )}
                value={ticketTypeKey}
                required
                aria-required="true"
                aria-invalid={ticketTypeError ? true : undefined}
                aria-describedby={ticketTypeError ? "ticket-link-type-error" : undefined}
                onChange={(e) => { setTicketTypeKey(e.target.value); setTicketTypeError(null); }}
              >
                <option value="">{TICKET_LINK_COPY.placeholderTicketType}</option>
                {config.ticketTypes.map((t) => (
                  <option key={t.ticketTypeKey} value={t.ticketTypeKey}>{t.ticketTypeLabel}</option>
                ))}
              </select>
              {/* ネイティブ矢印は appearance-none で消しているため自前で描く（装飾）。 */}
              <svg
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2"
                width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden="true"
              >
                <path d="M1 1L5.5 5.5L10 1" stroke="var(--liff-secondary-text, #5B6168)"
                  strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              </div>
            </TicketLinkField>
          )}

          <TicketLinkField
            htmlFor="ticket-link-name"
            label={TICKET_LINK_COPY.labelName}
            required
            error={purchaserNameError}
            errorId="ticket-link-name-error"
          >
            <input
              id="ticket-link-name"
              ref={purchaserNameRef}
              type="text"
              className={cx(TL_INPUT, purchaserNameError ? TL_INPUT_ERROR : TL_INPUT_NORMAL)}
              value={purchaserName}
              required
              aria-required="true"
              aria-invalid={purchaserNameError ? true : undefined}
              aria-describedby={purchaserNameError ? "ticket-link-name-error" : undefined}
              placeholder={TICKET_LINK_COPY.placeholderName}
              autoComplete="name"
              onChange={(e) => { setPurchaserName(e.target.value); setPurchaserNameError(null); }}
            />
          </TicketLinkField>

          <TicketLinkField
            htmlFor="ticket-link-reservation-number"
            label={TICKET_LINK_COPY.labelReservationNumber}
            required
            error={reservationNumberError}
            errorId="ticket-link-reservation-number-error"
          >
            <input
              id="ticket-link-reservation-number"
              ref={reservationNumberRef}
              type="text"
              className={cx(TL_INPUT, reservationNumberError ? TL_INPUT_ERROR : TL_INPUT_NORMAL)}
              value={reservationNumber}
              required
              aria-required="true"
              aria-invalid={reservationNumberError ? true : undefined}
              aria-describedby={reservationNumberError ? "ticket-link-reservation-number-error" : undefined}
              placeholder={TICKET_LINK_COPY.placeholderReservationNumber}
              inputMode="numeric"
              autoComplete="off"
              maxLength={RESERVATION_NUMBER_MAX_LENGTH}
              // 数字だけを表示へ残し、4 桁目からハイフンを自動挿入する。
              // ただし**不正文字を黙って捨てない**: 生値に許可外の文字が含まれていたら
              // エラー状態を立て、次に正しい入力を行うまで送信できないようにする。
              onChange={(e) => {
                const rawValue = e.target.value;
                setReservationNumber(formatReservationNumberInput(rawValue));
                const parsed = parseTicketLinkReservationNumberInput(rawValue);
                setReservationNumberError(
                  !parsed.ok && parsed.reason === "invalid_character"
                    ? ticketLinkReservationNumberErrorMessage("invalid_character")
                    : null, // 入力途中（incomplete/invalid_format）は blur / 送信まで出さない
                );
              }}
              // 入力が終わった時点でだけ形式エラーを出す（入力途中の "1" や "123-4" では出さない）。
              onBlur={() => {
                // 不正文字エラーは表示値からは復元できないため、既に立っていれば維持する。
                if (reservationNumberError) return;
                if (reservationNumber.length === 0) { setReservationNumberError(null); return; }
                const parsed = parseTicketLinkReservationNumberInput(reservationNumber);
                setReservationNumberError(parsed.ok ? null : ticketLinkReservationNumberErrorMessage(parsed.reason));
              }}
            />
          </TicketLinkField>
        </div>
      </TicketLinkShell>
    );
  }

  // ── 画面3-a: チケット情報の確認（API は呼ばない） ─────────────────────────
  if (step === "review") {
    return (
      <TicketLinkShell
        preview={preview}
        showCredit={showCredit}
        footer={
          <TicketLinkActions>
            <TicketLinkPrimaryButton onClick={() => { setFormError(null); setStep("codeNames"); }}>
              {TICKET_LINK_COPY.next}
            </TicketLinkPrimaryButton>
            <TicketLinkTextButton onClick={() => { setFormError(null); setStep("manual"); }}>
              {TICKET_LINK_COPY.backToEdit}
            </TicketLinkTextButton>
          </TicketLinkActions>
        }
      >
        <TicketLinkStepHeading
          title={heading}
          indicator={indicator}
          description={TICKET_LINK_COPY.reviewDescription}
        />
        <TicketLinkSummaryCard
          items={ticketReviewRows({
            workTitle,
            performanceDateTimeText: config.performanceDateTimeText,
            ticketTypeLabel: selectedType?.ticketTypeLabel ?? null,
            purchaserName,
            // 入力者本人向けの確認画面のため、ここだけは全桁表示する。
            reservationNumber: normalizedReservationNumberForDisplay,
          })}
        />
        <p className="mt-3 text-[12.5px] leading-[1.7] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
          {TICKET_LINK_COPY.reviewNote}
        </p>
      </TicketLinkShell>
    );
  }

  // ── 画面3-b: コードネーム入力 ─────────────────────────────────────────────
  if (step === "codeNames") {
    const submitCodeNames = () => {
      setFormError(null);
      void (async () => {
        setBusy(true);
        const r = await post("/draft/code-names", { draftId, codeNames });
        setBusy(false);
        if (!r.ok) { setFormError(errorMessage(r, TICKET_LINK_COPY.errorInputInvalid)); return; }
        setStep("final");
      })();
    };

    return (
      <TicketLinkShell
        preview={preview}
        showCredit={showCredit}
        footer={
          <TicketLinkActions>
            {formError && (
              <p className="pb-2 text-[12.5px] leading-[1.6] text-[color:var(--liff-danger,#E22B2B)]" role="alert">
                {formError}
              </p>
            )}
            <TicketLinkPrimaryButton onClick={submitCodeNames} busy={busy}>
              {TICKET_LINK_COPY.confirmCodeNames}
            </TicketLinkPrimaryButton>
            <TicketLinkTextButton disabled={busy} onClick={() => { setFormError(null); setStep("review"); }}>
              {TICKET_LINK_COPY.back}
            </TicketLinkTextButton>
          </TicketLinkActions>
        }
      >
        <TicketLinkStepHeading
          title={heading}
          indicator={indicator}
          description={TICKET_LINK_COPY.codeNamesDescription}
        />
        <div className="space-y-4">
          {codeNames.map((v, i) => (
            <TicketLinkField key={i} htmlFor={`ticket-link-code-name-${i}`} label={`プレイヤー${i + 1}`}>
              <input
                id={`ticket-link-code-name-${i}`}
                type="text"
                className={cx(TL_INPUT, TL_INPUT_NORMAL)}
                value={v}
                autoComplete="off"
                onChange={(e) => {
                  const next = [...codeNames];
                  next[i] = e.target.value;
                  setCodeNames(next);
                }}
              />
            </TicketLinkField>
          ))}
        </div>
      </TicketLinkShell>
    );
  }

  // ── 画面3-c: 最終確認（ここでだけ登録 API を呼ぶ） ───────────────────────
  const submitFinal = () => {
    // 多重タップ防止。busy 中は API を再送しない。
    if (busy) return;
    setFormError(null);
    void (async () => {
      setBusy(true);
      const r = await post("/confirm", { draftId });
      setBusy(false);
      // 通信エラー / API エラー時は完了画面へ進めない。
      if (!r.ok) { setFormError(errorMessage(r, TICKET_LINK_COPY.errorSubmitFailed)); return; }
      const d = r.json.data as { statusLabel: string; alreadyRegistered: boolean };
      setDoneState({ statusLabel: d.statusLabel, alreadyRegistered: d.alreadyRegistered });
      setStep("done");
    })();
  };

  return (
    <TicketLinkShell
      preview={preview}
      showCredit={showCredit}
      footer={
        <TicketLinkActions>
          {formError && (
            <p
              className={cx(TL_CARD, "mb-3 whitespace-pre-line px-4 py-3 text-[12.5px] leading-[1.7]",
                "border-[color:var(--liff-danger,#E22B2B)] text-[color:var(--liff-danger,#E22B2B)]")}
              role="alert"
              aria-live="assertive"
            >
              {formError}
            </p>
          )}
          <TicketLinkPrimaryButton onClick={submitFinal} busy={busy}>
            {busy ? TICKET_LINK_COPY.submitting : TICKET_LINK_COPY.submit}
          </TicketLinkPrimaryButton>
          {/* 入力画面へ戻る。入力値は保持し、API は呼ばない。 */}
          <TicketLinkTextButton disabled={busy} onClick={() => { setFormError(null); setStep("codeNames"); }}>
            {TICKET_LINK_COPY.backToEdit}
          </TicketLinkTextButton>
        </TicketLinkActions>
      }
    >
      <TicketLinkStepHeading
        title={heading}
        indicator={indicator}
        description={TICKET_LINK_COPY.finalDescription}
      />
      <TicketLinkSummaryCard
        items={finalReviewRows({
          workTitle,
          performanceDateTimeText: config.performanceDateTimeText,
          ticketTypeLabel: selectedType?.ticketTypeLabel ?? null,
          purchaserName,
          reservationNumber: normalizedReservationNumberForDisplay,
          codeNames,
        })}
      />
      <p className="mt-3 text-[12.5px] leading-[1.7] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
        {TICKET_LINK_COPY.reviewNote}
      </p>
    </TicketLinkShell>
  );
}
