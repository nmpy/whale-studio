"use client";

// src/components/liff/LineRegisterReportButton.tsx
//
// アンケート回答保存の成功後（SurveyRenderer の完了画面）にだけ表示するボタン。
// 押下で LINE トークへ固定メッセージ（register-report）を送信し、成功後 LIFF を閉じる。
// - 送信処理中は disabled + 「報告中…」（二重送信防止）
// - 連打されても同時に複数回実行しない（in-flight ref ガード）
// - 送信失敗 / LIFF 外は再操作可能に戻し、手動送信の案内を表示する
// - 技術的エラーは画面に出さず console のみ

import { useRef, useState } from "react";
import { LiffActionButton } from "./ui";
import { sendRegisterReport } from "./register-report";

const MANUAL_GUIDE =
  "送信できませんでした。\nLINE公式アカウントのトーク画面に戻り、\n「エージェント登録を完了しました。」\nと送信してください。";

type Phase = "idle" | "sending" | "done" | "failed";

export function LineRegisterReportButton({ preview = false }: { preview?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const inFlight = useRef(false);

  async function handleReport() {
    // 連打・多重実行防止（state 反映前の同期連打も ref で確実に弾く）。成功後(done)は再送しない。
    if (inFlight.current || phase === "done") return;
    inFlight.current = true;
    setPhase("sending");
    const result = await sendRegisterReport({ preview });
    inFlight.current = false;
    // "sent" → 完了。closeWindow が no-op でも done で再送を防ぐ。それ以外は再操作可に戻す。
    setPhase(result === "sent" ? "done" : "failed");
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <LiffActionButton
        type="button"
        variant="filled"
        fullWidth
        onClick={handleReport}
        disabled={phase === "done"}
        loading={phase === "sending"}
        loadingLabel="報告中…"
      >
        {phase === "done" ? "報告しました" : "登録完了を報告する"}
      </LiffActionButton>
      {phase === "failed" && (
        <p role="alert" className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)] whitespace-pre-line text-center">
          {MANUAL_GUIDE}
        </p>
      )}
    </div>
  );
}
