"use client";

// src/components/liff/HintSearchRenderer.tsx
//
// 検索型ヒントページ (LiffPageConfig.pageType = "hint_search") のプレイヤー画面。
//
// 既存の STEP 型ヒントサイト (pageType="hint" / HintSiteRenderer) とは別種別で、置換ではなく共存する。
// STEP 番号を持たない作品向けに「困っている内容を自由入力 → 該当ヒントだけを表示」する。
//
// ネタバレ防止（このコンポーネントの設計理由）:
//   1. 初期画面では検索フォーム以外を出さない。ヒントタイトル / 固有名詞 / カテゴリ一覧を一切描画しない。
//   2. ヒントデータはページ設定 API に含まれない（サーバー側で除去済み）。検索・詳細・答え・質問ツリーは
//      専用 API を都度叩き、必要な分だけ受け取る。CSS で隠すのではなく「そもそも持っていない」状態にする。
//   3. 「ヒント一覧」は **自分が開いたヒントだけ**。未開封のタイトルはクライアントにも届かない。
//   4. ヒント本文は段階ヒントとして 1 段ずつ開示し、結論（答え）は明示同意した後にだけ取得する。
//   5. 質問ツリーは 1 階層ずつ取得する。選ばなかった枝の内容は届かない。
//   6. 検索語は POST body で送り、URL / analytics には載せない。
//
// 画面はシェル（見出し / Powered by）を自前で持つ。LiffSinglePageRenderer 側では
// ownsPageChrome=true として二重描画を避けている。

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { HintSearchDetail, HintSearchResultItem } from "@/lib/liff/hint-search";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "./LiffPlayerContext";
import { LiffStudioFooter } from "./LiffStudioFooter";
import { LIFF_CARD_CLASS, LIFF_TEXT, actionButtonClass, cx } from "./ui/tokens";
import {
  createApiHintSearchClient,
  createLocalHintSearchClient,
  type HintSearchClient,
} from "./hint-search/client";
import { HINT_SEARCH_COPY as C } from "./hint-search/copy";
import { HintDetailBody } from "./hint-search/HintDetailBody";
import {
  loadOpenedHints,
  openedAnswerRevealed,
  openedRevealCount,
  openedStatusText,
  saveOpenedHint,
  type OpenedHintRecord,
} from "./hint-search/opened-store";

interface Props {
  /** 公開 ID でも UUID でも可（API 側でどちらも解決する）。 */
  workId: string;
  pageId: string;
  preview?: boolean;
  pageTitle?: string | null;
  pageDescription?: string | null;
  showCredit?: boolean;
  /** CMS プレビュー専用。編集中の settings_json の該当キー。実機では渡さない。 */
  previewSource?: { entries?: unknown; guideOptions?: unknown; guideQuestion?: unknown };
}

/** ヒント詳細へ来た経路。戻り導線の文言と戻り先が変わる。 */
type DetailOrigin = "search-single" | "results" | "opened" | "guide";

type Screen =
  | { kind: "search" }
  | { kind: "results"; query: string; items: HintSearchResultItem[] }
  | { kind: "detail"; detail: HintSearchDetail; origin: DetailOrigin; query: string | null; breadcrumb: string[] }
  | { kind: "answer-confirm"; detail: HintSearchDetail; origin: DetailOrigin; query: string | null; breadcrumb: string[] }
  | { kind: "opened" }
  | { kind: "guide"; path: number[]; breadcrumb: string[]; question: string; options: Array<{ label: string }> };

type SearchError = { kind: "empty" | "not_found" | "failed"; message: string };

export function HintSearchRenderer({
  workId, pageId, preview = false,
  pageTitle, pageDescription, showCredit = true,
  previewSource,
}: Props) {
  const client: HintSearchClient = useMemo(
    () => (preview
      ? createLocalHintSearchClient(previewSource ?? {})
      : createApiHintSearchClient(workId, pageId, preview)),
    [preview, previewSource, workId, pageId],
  );

  const [query, setQuery]     = useState("");
  const [screen, setScreen]   = useState<Screen>({ kind: "search" });
  const [error, setError]     = useState<SearchError | null>(null);
  const [pending, setPending] = useState(false);

  /** 「検索結果に戻る」用に直前の複数件ヒットを覚えておく。 */
  const [lastResults, setLastResults] = useState<{ query: string; items: HintSearchResultItem[] } | null>(null);
  /** ヒントごとの開示済み段階数。一覧のステータスと同じ値を使うためここで一元管理する。 */
  const [revealedByHint, setRevealedByHint] = useState<Record<string, number>>({});
  /** 開示済みの答え本文（このセッション中のみ保持。localStorage には本文を残さない）。 */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** 開封履歴（= ヒント一覧の材料）。 */
  const [opened, setOpened] = useState<OpenedHintRecord[]>([]);
  const [answerAgreed, setAnswerAgreed] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  // 連打時に古いレスポンスが新しい結果を上書きしないようにするための世代番号。
  const requestSeq = useRef(0);
  const reactId = useId();
  const inputId = `hint-search-input-${reactId}`;
  const errorId = `hint-search-error-${reactId}`;

  const title       = pageTitle?.trim()       || C.pageTitle;
  const description = pageDescription?.trim() || C.pageDescription;

  // localStorage は client でしか読めないのでマウント後に読み込む。
  useEffect(() => { setOpened(loadOpenedHints(pageId)); }, [pageId]);

  // ── 計測 ──────────────────────────────────────────────
  // 検索語は送らない（プレイヤーの入力内容を analytics に残さない方針）。
  // 表示に至ったヒントの id / プレイヤー向けラベルのみを既存 hint_open として記録する。
  const playerCtx = useLiffPlayerContext();
  const trackHintOpen = useCallback((detail: HintSearchDetail) => {
    if (!playerCtx || playerCtx.preview) return;
    recordLiffEvent({
      workId:     playerCtx.workId,
      pageId:     playerCtx.pageId,
      lineUserId: playerCtx.lineUserId,
      eventType:  "hint_open",
      metadata:   { source: "hint_search", item_id: detail.id, label: detail.label },
      dedupeKey:  `hint_open:${playerCtx.workId}:${playerCtx.pageId ?? "default"}:hint_search:${detail.id}:${playerCtx.lineUserId ?? "anon"}`,
    });
  }, [playerCtx]);

  /** 開封履歴を書き戻す（開いた / さらに開示した / 答えを見た のたびに呼ぶ）。 */
  const syncOpened = useCallback((detail: HintSearchDetail, revealedHints: number, answerRevealed: boolean) => {
    setOpened(saveOpenedHint(pageId, {
      id:             detail.id,
      label:          detail.listTitle || detail.label,
      revealedHints,
      totalHints:     detail.hints.length,
      hasAnswer:      detail.hasAnswer,
      answerRevealed,
    }));
  }, [pageId]);

  /** ヒント詳細画面へ入る共通処理。開示段階は履歴から復元する。 */
  const enterDetail = useCallback((
    detail: HintSearchDetail,
    origin: DetailOrigin,
    opts: { query?: string | null; breadcrumb?: string[] } = {},
  ) => {
    const restored = Math.max(1, openedRevealCount(loadOpenedHints(pageId), detail.id));
    const revealed = Math.min(restored, Math.max(detail.hints.length, 1));
    setRevealedByHint((prev) => ({ ...prev, [detail.id]: revealed }));
    setScreen({
      kind: "detail",
      detail,
      origin,
      query:      opts.query ?? null,
      breadcrumb: opts.breadcrumb ?? [],
    });
    syncOpened(detail, revealed, openedAnswerRevealed(loadOpenedHints(pageId), detail.id));
    trackHintOpen(detail);
  }, [pageId, syncOpened, trackHintOpen]);

  // ── 検索 ──────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (pending) return; // 連打対策: 実行中は追加リクエストを出さない
    const raw = query.trim();
    if (raw === "") {
      setError({ kind: "empty", message: C.emptyQueryError });
      inputRef.current?.focus();
      return;
    }
    const seq = ++requestSeq.current;
    setPending(true);
    setError(null);
    try {
      const res = await client.search(raw);
      if (seq !== requestSeq.current) return; // 古いレスポンスは捨てる
      if (res.items.length === 0) {
        setError({ kind: "not_found", message: C.notFound });
        setScreen({ kind: "search" });
        return;
      }
      if (res.items.length === 1 && res.detail) {
        enterDetail(res.detail, "search-single", { query: raw });
        return;
      }
      setLastResults({ query: raw, items: res.items });
      setScreen({ kind: "results", query: raw, items: res.items });
    } catch {
      if (seq !== requestSeq.current) return;
      setError({ kind: "failed", message: C.failed });
      setScreen({ kind: "search" });
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }, [pending, query, client, enterDetail]);

  const openDetailById = useCallback(async (id: string, origin: DetailOrigin, fromQuery: string | null) => {
    if (pending) return;
    const seq = ++requestSeq.current;
    setPending(true);
    try {
      const detail = await client.detail(id);
      if (seq !== requestSeq.current) return;
      enterDetail(detail, origin, { query: fromQuery });
    } catch {
      if (seq !== requestSeq.current) return;
      setError({ kind: "failed", message: C.failed });
      setScreen({ kind: "search" });
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }, [pending, client, enterDetail]);

  // ── 質問ツリー ────────────────────────────────────────
  const gotoGuide = useCallback(async (path: number[]) => {
    const seq = ++requestSeq.current;
    setPending(true);
    setError(null);
    try {
      const step = await client.guide(path);
      if (seq !== requestSeq.current) return;
      if (step.detail) {
        enterDetail(step.detail, "guide", { breadcrumb: step.breadcrumb });
        return;
      }
      setScreen({
        kind: "guide",
        path,
        breadcrumb: step.breadcrumb,
        question:   step.question ?? "",
        options:    step.options,
      });
    } catch {
      if (seq !== requestSeq.current) return;
      setError({ kind: "failed", message: C.failed });
      setScreen({ kind: "search" });
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }, [client, enterDetail]);

  // ── 段階ヒント / 答え ─────────────────────────────────
  const revealNext = useCallback((detail: HintSearchDetail) => {
    setRevealedByHint((prev) => {
      const next = Math.min((prev[detail.id] ?? 1) + 1, detail.hints.length);
      syncOpened(detail, next, answers[detail.id] !== undefined);
      return { ...prev, [detail.id]: next };
    });
  }, [syncOpened, answers]);

  const confirmAnswer = useCallback(async (
    detail: HintSearchDetail, origin: DetailOrigin, query: string | null, breadcrumb: string[],
  ) => {
    if (pending) return;
    const seq = ++requestSeq.current;
    setPending(true);
    try {
      const answer = await client.answer(detail.id);
      if (seq !== requestSeq.current) return;
      setAnswers((prev) => ({ ...prev, [detail.id]: answer }));
      syncOpened(detail, revealedByHint[detail.id] ?? 1, true);
      setAnswerAgreed(false);
      setScreen({ kind: "detail", detail, origin, query, breadcrumb });
    } catch {
      if (seq !== requestSeq.current) return;
      setError({ kind: "failed", message: C.failed });
      setScreen({ kind: "search" });
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }, [pending, client, syncOpened, revealedByHint]);

  // ── 画面遷移 ──────────────────────────────────────────
  const backToSearch = useCallback(() => {
    requestSeq.current += 1; // 進行中のリクエストの結果を無効化する
    setPending(false);
    setError(null);
    setAnswerAgreed(false);
    setScreen({ kind: "search" });
  }, []);

  const backFromDetail = useCallback((origin: DetailOrigin) => {
    if (origin === "results" && lastResults) {
      setScreen({ kind: "results", query: lastResults.query, items: lastResults.items });
      return;
    }
    if (origin === "opened") { setScreen({ kind: "opened" }); return; }
    if (origin === "guide")  { void gotoGuide([]); return; }
    backToSearch();
  }, [lastResults, gotoGuide, backToSearch]);

  // 画面が切り替わったらページ先頭へ戻す（結果 → 詳細 → 一覧の遷移で読み始めがズレないように）。
  useEffect(() => {
    // scrollTo が無い環境（jsdom / 一部 WebView）でも落とさない。
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    try { window.scrollTo({ top: 0 }); } catch { /* スクロール位置は表示の本質ではないので黙って諦める */ }
  }, [screen.kind]);

  return (
    <>
      <main className="liff-player-main flex flex-col gap-5 pt-4 pb-10">
        {screen.kind === "search" && (
          <SearchScreen
            title={title}
            description={description}
            inputId={inputId}
            errorId={errorId}
            inputRef={inputRef}
            query={query}
            onQueryChange={(v) => { setQuery(v); if (error) setError(null); }}
            onSubmit={() => { void runSearch(); }}
            pending={pending}
            error={error}
            onOpenedList={() => setScreen({ kind: "opened" })}
            onGuide={() => { void gotoGuide([]); }}
          />
        )}

        {screen.kind === "results" && (
          <ResultsScreen
            query={screen.query}
            items={screen.items}
            pending={pending}
            onSelect={(id) => { void openDetailById(id, "results", screen.query); }}
            onBack={backToSearch}
          />
        )}

        {screen.kind === "detail" && (
          <DetailScreen
            detail={screen.detail}
            origin={screen.origin}
            query={screen.query}
            breadcrumb={screen.breadcrumb}
            revealed={revealedByHint[screen.detail.id] ?? 1}
            answer={answers[screen.detail.id] ?? null}
            onReveal={() => revealNext(screen.detail)}
            onRequestAnswer={() => {
              setAnswerAgreed(false);
              setScreen({ kind: "answer-confirm", detail: screen.detail, origin: screen.origin, query: screen.query, breadcrumb: screen.breadcrumb });
            }}
            onBack={() => backFromDetail(screen.origin)}
          />
        )}

        {screen.kind === "answer-confirm" && (
          <AnswerConfirmScreen
            detail={screen.detail}
            agreed={answerAgreed}
            onAgreedChange={setAnswerAgreed}
            pending={pending}
            onConfirm={() => { void confirmAnswer(screen.detail, screen.origin, screen.query, screen.breadcrumb); }}
            onCancel={() => setScreen({ kind: "detail", detail: screen.detail, origin: screen.origin, query: screen.query, breadcrumb: screen.breadcrumb })}
          />
        )}

        {screen.kind === "opened" && (
          <OpenedListScreen
            records={opened}
            pending={pending}
            onSelect={(id) => { void openDetailById(id, "opened", null); }}
            onBack={backToSearch}
          />
        )}

        {screen.kind === "guide" && (
          <GuideScreen
            path={screen.path}
            breadcrumb={screen.breadcrumb}
            question={screen.question}
            options={screen.options}
            pending={pending}
            onSelect={(idx) => { void gotoGuide([...screen.path, idx]); }}
            onBackStep={() => {
              if (screen.path.length === 0) backToSearch();
              else void gotoGuide(screen.path.slice(0, -1));
            }}
          />
        )}
      </main>

      {showCredit && <LiffStudioFooter />}
    </>
  );
}

// ── A / B / C / F: 検索画面 ───────────────────────────────────────
function SearchScreen({
  title, description, inputId, errorId, inputRef, query, onQueryChange, onSubmit,
  pending, error, onOpenedList, onGuide,
}: {
  title: string;
  description: string;
  inputId: string;
  errorId: string;
  inputRef: React.RefObject<HTMLInputElement>;
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
  error: SearchError | null;
  onOpenedList: () => void;
  onGuide: () => void;
}) {
  const hasError  = error !== null;
  const notFound  = error?.kind === "not_found";
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={LIFF_TEXT.pageTitle}>{title}</h1>
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85] break-words whitespace-pre-wrap")}>
          {description}
        </p>
      </div>

      {/* form にすることで Enter でも検索できる。 */}
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="liff-hs-label">
            {C.inputLabel}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={C.inputPlaceholder}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? errorId : undefined}
            className={cx("liff-box-input", hasError && "liff-box-input--error")}
          />
          {/* エラーは色だけに頼らず必ず文言を出し、支援技術にも通知する。 */}
          <p
            id={errorId}
            role="alert"
            aria-live="assertive"
            className="empty:hidden text-[13px] leading-[1.7] text-[color:var(--liff-danger,#E22B2B)] break-words"
          >
            {error?.message ?? ""}
          </p>
          {!hasError && <p className={LIFF_TEXT.caption}>{C.inputNote}</p>}
        </div>

        {/* 0 件のときだけ「入力のヒント」カードを出す。 */}
        {notFound && (
          <section className={cx(LIFF_CARD_CLASS, "px-4 py-4 bg-[color:var(--liff-surface-subtle,#FAFAFA)]")}>
            <h2 className="text-[13px] font-bold text-[color:var(--liff-primary-text)]">{C.supportTitle}</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {C.supportItems.map((item) => (
                <li key={item} className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.7] flex gap-1.5 break-words")}>
                  <span aria-hidden="true" className="shrink-0">・</span>
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button type="submit" disabled={pending} className={actionButtonClass("filled")}>
          {pending ? C.searching : (notFound ? C.retry : C.submit)}
        </button>
      </form>

      {/* 開封済みヒントへの導線。0 件のときは出さない（見せるものが無いため）。 */}
      {!notFound && (
        <button
          type="button"
          onClick={onOpenedList}
          className="min-h-[44px] text-center text-[14px] font-bold text-[color:var(--liff-line-green,#06C755)] active:opacity-70"
        >
          {C.openedListLink}
        </button>
      )}

      {/* キーワードが思いつかない人の救済導線。Primary より弱いトーンで最下部に置く。 */}
      <div className="pt-6">
        <button
          type="button"
          onClick={onGuide}
          className="w-full min-h-[44px] text-center text-[14px] text-[color:var(--liff-secondary-text,#666)] active:opacity-70"
        >
          {C.guideEntryLink}
        </button>
      </div>
    </>
  );
}

// ── E: 複数件一致 ────────────────────────────────────────────────
function ResultsScreen({
  query, items, pending, onSelect, onBack,
}: {
  query: string;
  items: HintSearchResultItem[];
  pending: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={cx(LIFF_TEXT.pageTitle, "text-[18px]")}>{C.multiHeading}</h1>
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85] break-words")}>
          {C.multiDescription}
        </p>
      </div>

      <EnteredQuery query={query} />

      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.id}>
            <ChoiceButton label={item.label} disabled={pending} onClick={() => onSelect(item.id)} />
          </li>
        ))}
      </ul>

      <FooterLink label={C.backToSearch} onClick={onBack} />
    </>
  );
}

// ── D / G / H: ヒント詳細 ────────────────────────────────────────
function DetailScreen({
  detail, origin, query, breadcrumb, revealed, answer, onReveal, onRequestAnswer, onBack,
}: {
  detail: HintSearchDetail;
  origin: DetailOrigin;
  query: string | null;
  breadcrumb: string[];
  revealed: number;
  answer: string | null;
  onReveal: () => void;
  onRequestAnswer: () => void;
  onBack: () => void;
}) {
  const backLabel =
    origin === "results" ? C.backToResults
    : origin === "opened" ? C.backToList
    : origin === "guide"  ? C.guideBackRoot
    : C.searchAgain;

  return (
    <>
      {/* 1 件だけヒットしたときは「キーワードを確認しました」+ 入力内容を出す。
          複数候補 / 一覧 / 質問ツリーから来た場合は自分で選んだ結果なので、この確認は出さない。 */}
      {origin === "search-single" && (
        <p className="flex items-center gap-2 text-[15px] font-bold text-[color:var(--liff-ui-green-pressed,#06A047)]">
          <CheckIcon />
          {C.confirmed}
        </p>
      )}

      {origin === "search-single" && query && <EnteredQuery query={query} />}

      <div className="flex flex-col gap-1">
        {breadcrumb.length > 0 ? (
          <p className={LIFF_TEXT.caption}>{breadcrumb.join(" › ")}</p>
        ) : detail.categoryLabel ? (
          <p className={LIFF_TEXT.caption}>{detail.categoryLabel}</p>
        ) : null}
        {origin !== "search-single" && (
          <h1 className={cx(LIFF_TEXT.pageTitle, "text-[18px] break-words")}>{detail.label}</h1>
        )}
      </div>

      <HintDetailBody
        detail={detail}
        revealed={revealed}
        onReveal={onReveal}
        answer={answer}
        onRequestAnswer={onRequestAnswer}
      />

      <FooterLink label={backLabel} onClick={onBack} />
    </>
  );
}

// ── 答えの確認画面（1 画面まるごとの確認ステップ）────────────────
function AnswerConfirmScreen({
  detail, agreed, onAgreedChange, pending, onConfirm, onCancel,
}: {
  detail: HintSearchDetail;
  agreed: boolean;
  onAgreedChange: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const checkboxId = `hint-answer-agree-${detail.id}`;
  return (
    <>
      <div className="flex flex-col items-center gap-3 pt-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--liff-danger,#E22B2B)] text-[26px] font-bold text-[color:var(--liff-danger,#E22B2B)]"
        >
          !
        </span>
        <h1 className={cx(LIFF_TEXT.pageTitle, "text-center")}>{C.answerConfirmTitle}</h1>
        <p className={cx(LIFF_TEXT.secondary, "text-center text-[13px] leading-[1.85] break-words")}>
          {C.answerConfirmBody}
        </p>
      </div>

      <section className={cx(LIFF_CARD_CLASS, "px-4 py-3 bg-[color:var(--liff-surface-subtle,#FAFAFA)]")}>
        <h2 className={LIFF_TEXT.caption}>{C.answerTargetLabel}</h2>
        <p className={cx(LIFF_TEXT.body, "mt-0.5 break-words")}>{detail.label}</p>
      </section>

      <div className="flex items-center gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={agreed}
          onChange={(e) => onAgreedChange(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-[color:var(--liff-line-green,#06C755)]"
        />
        <label htmlFor={checkboxId} className="liff-hs-label liff-hs-label--body break-words">
          {C.answerAgree}
        </label>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <button
          type="button"
          disabled={!agreed || pending}
          onClick={onConfirm}
          className={actionButtonClass("danger")}
        >
          {C.answerConfirm}
        </button>
        <FooterLink label={C.answerCancel} onClick={onCancel} />
      </div>
    </>
  );
}

// ── ヒント一覧（開封済みのみ）─────────────────────────────────────
function OpenedListScreen({
  records, pending, onSelect, onBack,
}: {
  records: OpenedHintRecord[];
  pending: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className={LIFF_TEXT.pageTitle}>{C.listTitle}</h1>
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85]")}>{C.listDescription}</p>
      </div>

      {records.length === 0 ? (
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85] py-4 break-words")}>
          {C.listEmpty}
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between border-b border-[color:var(--liff-border)] pb-2">
            <h2 className={LIFF_TEXT.caption}>{C.listSectionLabel}</h2>
            <p className={LIFF_TEXT.caption}>{C.listCount(records.length)}</p>
          </div>
          <ul className="flex flex-col">
            {records.map((r) => (
              <li key={r.id} className="border-b border-[color:var(--liff-border)]">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onSelect(r.id)}
                  className="w-full min-h-[64px] py-3 flex items-center gap-3 text-left active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cx(LIFF_TEXT.headerTitle, "block break-words")}>{r.label}</span>
                    <span className={cx(LIFF_TEXT.caption, "mt-0.5 block")}>{openedStatusText(r)}</span>
                  </span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className={cx(LIFF_CARD_CLASS, "px-4 py-3 bg-[color:var(--liff-surface-subtle,#FAFAFA)]")}>
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.75] break-words")}>{C.listNotice}</p>
      </section>

      <button type="button" onClick={onBack} className={actionButtonClass("outline")}>
        {C.listSearchCta}
      </button>
    </>
  );
}

// ── 質問ツリー（キーワードがわからない場合）──────────────────────
function GuideScreen({
  path, breadcrumb, question, options, pending, onSelect, onBackStep,
}: {
  path: number[];
  breadcrumb: string[];
  question: string;
  options: Array<{ label: string }>;
  pending: boolean;
  onSelect: (idx: number) => void;
  onBackStep: () => void;
}) {
  const step = path.length + 1;
  const eyebrow = breadcrumb.length > 0
    ? `${breadcrumb.join(" › ")} › 質問${step}`
    : C.guideEyebrow(step);

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className={LIFF_TEXT.caption}>{eyebrow}</p>
        <h1 className={cx(LIFF_TEXT.pageTitle, "font-bold break-words")}>{question}</h1>
        {path.length === 0 && (
          <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85] break-words")}>
            {C.guideDescription}
          </p>
        )}
      </div>

      {options.length === 0 ? (
        <p className={cx(LIFF_TEXT.secondary, "text-[13px] leading-[1.85] py-4")}>{C.guideEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {options.map((o, idx) => (
            <li key={`${o.label}-${idx}`}>
              <ChoiceButton label={o.label} disabled={pending} onClick={() => onSelect(idx)} />
            </li>
          ))}
        </ul>
      )}

      {/* 選ばなかった枝の内容は取得すらしていないことを明示する。 */}
      <div className="border-t border-[color:var(--liff-border)] pt-4">
        <p className={cx(LIFF_TEXT.caption, "leading-[1.75] break-words")}>{C.guideNotice}</p>
      </div>

      <FooterLink label={path.length === 0 ? C.backToSearch : C.guideBackStep} onClick={onBackStep} />
    </>
  );
}

// ── 共通パーツ ───────────────────────────────────────────────────

function ChoiceButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        LIFF_CARD_CLASS,
        "w-full min-h-[56px] px-4 py-3.5 flex items-center gap-3 text-left",
        "active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] disabled:opacity-50",
      )}
    >
      <span className={cx(LIFF_TEXT.body, "min-w-0 flex-1 break-words")}>{label}</span>
      <Chevron />
    </button>
  );
}

function EnteredQuery({ query }: { query: string }) {
  return (
    <section className={cx(LIFF_CARD_CLASS, "px-4 py-3")}>
      <h2 className={LIFF_TEXT.caption}>{C.enteredLabel}</h2>
      <p className={cx(LIFF_TEXT.body, "mt-0.5 font-bold break-words")}>{query}</p>
    </section>
  );
}

function FooterLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[44px] text-center text-[14px] text-[color:var(--liff-secondary-text,#666)] active:opacity-70"
    >
      {label}
    </button>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 text-[color:var(--liff-tertiary-text,#8C8C8C)]"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--liff-line-green,#06C755)]"
    >
      <svg
        viewBox="0 0 24 24" width="14" height="14" fill="none"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      >
        <polyline points="4 12 10 18 20 6" />
      </svg>
    </span>
  );
}
