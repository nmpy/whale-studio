"use client";

// src/components/liff/TicketLinkRenderer.tsx
//
// LIFF「チケット連携」タブ（PR2: 手動登録のみ）。
//
// 画面遷移:
//   choice → manual → review → codeNames → final → done
//
// サーバー側の draft.step が正であり、この画面の state は表示用にすぎない。
// 不正な順序で API を呼んでも 400 になる（サーバーが順序を強制する）。
//
// PR2 では画像登録を **公開しない**（押せて動かない導線を作らない）。「準備中」表示のみ。

import { useCallback, useEffect, useState } from "react";
import { LiffActionButton, LiffTextInput, LiffLoadingState, LiffErrorState } from "./ui";
import { TicketLinkReportButton } from "./TicketLinkReportButton";
import { normalizeReservationNumber } from "@/lib/ticket-link/reservation-number";

type Step = "choice" | "manual" | "review" | "codeNames" | "final" | "done";

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
  report: { enabled: boolean; label: string };
  completionMessage: string;
  performanceDateTimeText: string;
  draft: { id: string; step: string | null; ticketTypeKey: string | null } | null;
  links: ExistingLink[];
}

interface Props {
  /** 作品識別子（UUID / publicId）。 */
  workId: string;
  /** 作品名（対象公演の固定表示に使う）。 */
  workTitle: string;
  /** CMS プレビュー時は API を叩かず、実送信もしない。 */
  preview?: boolean;
  /** テスト用: LIFF アクセストークン取得の差し替え。 */
  getAccessToken?: () => Promise<string | null>;
  /** テスト用: fetch 差し替え。 */
  fetchImpl?: typeof fetch;
  /** LINE へ送る報告本文（設定値）。label とは別物。 */
  reportMessage?: string | null;
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

export function TicketLinkRenderer({
  workId, workTitle, preview, getAccessToken, fetchImpl, reportMessage,
}: Props) {
  const doFetch = fetchImpl ?? fetch;
  const tokenFn = getAccessToken ?? defaultGetAccessToken;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [step, setStep] = useState<Step>("choice");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 入力状態（戻る操作で失わないよう保持する）
  const [ticketTypeKey, setTicketTypeKey] = useState("");
  const [purchaserName, setPurchaserName] = useState("");
  const [reservationNumber, setReservationNumber] = useState("");
  const [codeNames, setCodeNames] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [doneState, setDoneState] = useState<{ statusLabel: string; alreadyRegistered: boolean } | null>(null);

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
      setLoadError(r.json.error?.message ?? "この機能は現在ご利用いただけません。");
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

  if (loading) return <LiffLoadingState />;
  if (loadError) return <LiffErrorState message={loadError} />;
  if (!config) return <LiffErrorState message="この機能は現在ご利用いただけません。" />;

  // ── 登録完了 ───────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">
          {doneState?.alreadyRegistered ? "すでに連携済みです" : "チケット連携を受け付けました"}
        </h2>
        <p className="whitespace-pre-line text-sm">{config.completionMessage}</p>
        <p className="text-sm">連携状態：{doneState?.statusLabel ?? "運営確認待ち"}</p>
        {config.report.enabled && (
          <TicketLinkReportButton
            label={config.report.label}
            message={reportMessage ?? config.report.label}
            preview={preview}
          />
        )}
      </div>
    );
  }

  // ── 入口（未登録 / 登録途中 / 登録完了済み） ───────────────────────────────
  if (step === "choice") {
    return (
      <div className="space-y-5">
        {config.links.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-base font-bold">連携済みのチケット</h3>
            {config.links.map((l) => (
              <div key={l.id} className="rounded-[10px] border p-3 text-sm">
                <p>対象公演：{workTitle}</p>
                <p>日時：{config.performanceDateTimeText}</p>
                <p>チケット種別：{l.ticketTypeLabel ?? "—"}</p>
                <p>予約番号：{l.reservationNumberMasked}</p>
                <p>コードネーム：{l.codeNames.join("、") || "—"}</p>
                <p>連携状態：{l.statusLabel}</p>
                <p>確認日時：{new Date(l.confirmedAt).toLocaleString("ja-JP")}</p>
              </div>
            ))}
          </section>
        )}

        {/* 既存登録があっても、複数予約のため「手動で入力」は消さない。 */}
        {config.manualInputAvailable ? (
          <section className="space-y-3">
            <h3 className="text-base font-bold">
              {config.links.length > 0 ? "別のチケットを連携する" : "チケットを連携する"}
            </h3>

            {draftId && (
              <div className="space-y-2">
                <LiffActionButton type="button" onClick={() => setStep("manual")}>
                  入力途中の情報を再開する
                </LiffActionButton>
                <button
                  type="button"
                  className="w-full text-sm underline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await post("/draft", {}, "DELETE");
                    setDraftId(null); setTicketTypeKey(""); setPurchaserName("");
                    setReservationNumber(""); setCodeNames([]);
                    setBusy(false);
                    await loadConfig();
                  }}
                >
                  最初からやり直す
                </button>
              </div>
            )}

            {!draftId && (
              <LiffActionButton type="button" onClick={() => setStep("manual")}>
                手動で入力
              </LiffActionButton>
            )}

            {/* PR4 まで動作しないため disabled + 準備中を明示する。 */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full cursor-not-allowed rounded-[12px] border px-4 py-3 text-sm opacity-50"
            >
              スクリーンショットから登録（準備中）
            </button>
          </section>
        ) : (
          <p className="text-sm">現在この作品では手動入力をご利用いただけません。</p>
        )}
      </div>
    );
  }

  // ── 手動入力 ───────────────────────────────────────────────────────────────
  if (step === "manual") {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-bold">チケット情報を入力</h3>

        <div>
          <p className="mb-1 text-sm font-medium">対象公演</p>
          {/* 全作品検索はさせない。対象は現在の作品に固定。 */}
          <p className="text-sm">{workTitle}</p>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">チケット種別</p>
          {config.ticketTypes.length === 1 ? (
            <p className="text-sm">{config.ticketTypes[0].ticketTypeLabel}</p>
          ) : (
            <select
              className="w-full rounded-[10px] border p-2 text-sm"
              value={ticketTypeKey}
              onChange={(e) => setTicketTypeKey(e.target.value)}
            >
              <option value="">選択してください</option>
              {config.ticketTypes.map((t) => (
                // value は表示名ではなく安定キー。
                <option key={t.ticketTypeKey} value={t.ticketTypeKey}>{t.ticketTypeLabel}</option>
              ))}
            </select>
          )}
        </div>

        <p className="mb-1 text-sm font-medium">名前</p>
        <LiffTextInput
          value={purchaserName}
          onChange={(e) => setPurchaserName(e.target.value)}
          placeholder="チケット購入時のお名前"
        />

        <p className="mb-1 text-sm font-medium">予約番号</p>
        <LiffTextInput
          value={reservationNumber}
          onChange={(e) => setReservationNumber(e.target.value)}
          placeholder="123-456"
          inputMode="numeric"
        />

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="space-y-2">
          <LiffActionButton
            type="button"
            disabled={busy}
            onClick={async () => {
              setFormError(null);
              // クライアント側でも正規化・形式検証する（サーバーでも再検証される）。
              if (!ticketTypeKey) { setFormError("チケット種別を選択してください。"); return; }
              if (!normalizeReservationNumber(reservationNumber)) {
                setFormError("予約番号の形式が正しくありません。"); return;
              }
              setBusy(true);
              const r = await post("/draft", { ticketTypeKey, purchaserName, reservationNumber });
              setBusy(false);
              if (!r.ok) { setFormError(r.json.error?.message ?? "入力内容を確認してください。"); return; }
              const d = r.json.data as { draftId: string; participantCount: number };
              setDraftId(d.draftId);
              setCodeNames((prev) =>
                prev.length === d.participantCount ? prev : Array.from({ length: d.participantCount }, () => ""),
              );
              setStep("review");
            }}
          >
            この内容で進む
          </LiffActionButton>
          <button type="button" className="w-full text-sm underline" onClick={() => setStep("choice")}>
            戻る
          </button>
        </div>
      </div>
    );
  }

  // ── チケット情報確認 ───────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <div className="space-y-4">
        <p className="text-sm">以下のチケット情報を確認してください。</p>
        <div className="rounded-[10px] border p-3 text-sm">
          <p>公演：{workTitle}</p>
          <p>日時：{config.performanceDateTimeText}</p>
          <p>チケット種別：{selectedType?.ticketTypeLabel ?? "—"}</p>
          <p>名前：{purchaserName || "—"}</p>
          {/* 入力者本人向けの確認画面のため、ここだけは全桁表示する。 */}
          <p>予約番号：{normalizeReservationNumber(reservationNumber) ?? reservationNumber}</p>
        </div>
        <div className="space-y-2">
          <LiffActionButton type="button" onClick={() => setStep("codeNames")}>この内容で進む</LiffActionButton>
          <button type="button" className="w-full text-sm underline" onClick={() => setStep("manual")}>
            戻って修正する
          </button>
        </div>
      </div>
    );
  }

  // ── コードネーム入力 ───────────────────────────────────────────────────────
  if (step === "codeNames") {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-bold">コードネームを入力</h3>
        {codeNames.map((v, i) => (
          <div key={i}>
            <p className="mb-1 text-sm font-medium">プレイヤー{i + 1}</p>
            <LiffTextInput
              aria-label={`プレイヤー${i + 1}のコードネーム`}
              value={v}
              onChange={(e) => {
                const next = [...codeNames];
                next[i] = e.target.value;
                setCodeNames(next);
              }}
            />
          </div>
        ))}
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <div className="space-y-2">
          <LiffActionButton
            type="button"
            disabled={busy}
            onClick={async () => {
              setFormError(null);
              setBusy(true);
              const r = await post("/draft/code-names", { draftId, codeNames });
              setBusy(false);
              if (!r.ok) { setFormError(r.json.error?.message ?? "入力内容を確認してください。"); return; }
              setStep("final");
            }}
          >
            登録内容を確認する
          </LiffActionButton>
          <button type="button" className="w-full text-sm underline" onClick={() => setStep("review")}>戻る</button>
        </div>
      </div>
    );
  }

  // ── 最終確認 ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <p className="whitespace-pre-line text-sm">
        {"この内容で登録しますか？\n\n登録後は運営側の予約情報と連携されます。"}
      </p>
      <div className="rounded-[10px] border p-3 text-sm">
        <p>対象公演：{workTitle}</p>
        <p>日時：{config.performanceDateTimeText}</p>
        <p>チケット種別：{selectedType?.ticketTypeLabel ?? "—"}</p>
        <p>予約番号：{normalizeReservationNumber(reservationNumber) ?? reservationNumber}</p>
        <p>コードネーム：{codeNames.filter(Boolean).join("、") || "—"}</p>
      </div>
      {formError && <p className="whitespace-pre-line text-sm text-red-600">{formError}</p>}
      <div className="space-y-2">
        <LiffActionButton
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            // 多重タップ防止。busy 中は API を再送しない。
            if (busy) return;
            setFormError(null);
            setBusy(true);
            const r = await post("/confirm", { draftId });
            setBusy(false);
            if (!r.ok) { setFormError(r.json.error?.message ?? "登録できませんでした。"); return; }
            const d = r.json.data as { statusLabel: string; alreadyRegistered: boolean };
            setDoneState({ statusLabel: d.statusLabel, alreadyRegistered: d.alreadyRegistered });
            setStep("done");
          }}
        >
          {busy ? "登録中…" : "この内容で登録"}
        </LiffActionButton>
        <button type="button" className="w-full text-sm underline" onClick={() => setStep("codeNames")}>
          戻って修正
        </button>
      </div>
    </div>
  );
}
