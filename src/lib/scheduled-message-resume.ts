// src/lib/scheduled-message-resume.ts
//
// PR-SER3 直列進行 resume アダプタ。
//   予約 push 成功＆ markSent 後に worker から **1回だけ**呼ばれ、payload.resume.next_message_id から
//   後続チェーンを「本来送られるはずだった形」で送信し、後続に予約があれば再arm する。
//
// 設計（worker 側の idempotency 前提に依存）:
//   - 呼ばれる時点で予約は status=sent（findDuePending に再 pick されない）= resume は1回のみ。
//   - resume 失敗（invalid/fetch/push 失敗）でも **予約本文 push は再実行しない**（二重送信回避優先）。
//     後続が送られないだけ。worker が resumeFailed を warning ログ＋counter に出す。
//
// IO（フェーズ取得 / push / 再arm）はすべて注入可能 = コア（妥当性検証＋drain＋再arm判定）を単体テストできる。
// 本番配線（prisma + LINE push + armScheduledMessages）は cron route で行う。
//
// 禁止: token/channelSecret/lineUserId/payload 全文をログに出さない（id と安全な分類名のみ）。

import { drainAutoSendableItemsFrom, type PhaseRow } from "@/lib/runtime";
import type { RuntimePhaseMessage } from "@/types";
import type {
  ResumeChain, ResumeChainArgs, ResumeChainOutcome, PendingScheduledRow,
} from "@/lib/scheduled-message-worker";

export interface ResumeAdapterDeps {
  /** 予約の phase（row.phaseId）から、チェーン walk 用の **active メッセージ一覧**を取得。取得不能/空は null。 */
  fetchPhaseMessages: (args: { phaseId: string | null; workId: string }) => Promise<PhaseRow["messages"] | null>;
  /** drain 済みの後続チェーンを LINE push する。token 解決は内部。ok=false は安全な reason を返す。 */
  pushChain: (args: { row: PendingScheduledRow; messages: RuntimePhaseMessage[] }) => Promise<{ ok: boolean; reason?: string }>;
  /** 後続として送った message id 群を再arm（次段の予約作成。hold ならその予約に次 resume cursor が入る）。 */
  rearm: (args: { row: PendingScheduledRow; sentMessageIds: string[]; now: Date }) => Promise<{ created: number }>;
}

/**
 * resume アダプタを組み立てる。worker.deps.resumeChain に渡す。
 * 返り値 ResumeChainOutcome.reason は PII を含まない安全な分類名:
 *   fetch_failed / invalid_next_message / no_sendable / push_failed。
 */
export function makeResumeChain(deps: ResumeAdapterDeps): ResumeChain {
  return async ({ row, nextMessageId, now }: ResumeChainArgs): Promise<ResumeChainOutcome> => {
    // 1) フェーズの active メッセージ取得（チェーン walk 用）。
    const messages = await deps.fetchPhaseMessages({ phaseId: row.phaseId, workId: row.workId });
    if (!messages || messages.length === 0) return { ok: false, reason: "fetch_failed" };

    // 2) next_message_id の妥当性: 存在・active・同 work。不正なら no-op（二重 push せず resumeFailed）。
    const start = messages.find((m) => m.id === nextMessageId);
    if (!start || !start.isActive || start.workId !== row.workId) {
      return { ok: false, reason: "invalid_next_message" };
    }

    // 3) drain: hold truncation を含む通常規則で後続チェーンを構築（次段 hold なら holdOut に resume cursor）。
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    const chain = drainAutoSendableItemsFrom(messages, nextMessageId, holdOut);
    // next が response/hint 等で送信対象が無い = 異常データ。二重 push せず resumeFailed として可視化。
    if (chain.length === 0) return { ok: false, reason: "no_sendable" };

    // 4) push（失敗時は予約本文の二重 push をせず resume 失敗扱い。予約は sent のまま）。
    const pushed = await deps.pushChain({ row, messages: chain });
    if (!pushed.ok) return { ok: false, reason: pushed.reason ?? "push_failed", sentCount: 0 };

    // 5) 再arm: 送った後続に予約があれば次予約を作成。hold ならその予約に次段 resume cursor が入り 3段以上に対応。
    //    再arm は既存 idempotency_key で dedup されるため二重作成しない。失敗しても後続送信自体は成功（ok のまま）。
    const sentMessageIds = chain.map((m) => m.id);
    let rearmed = 0;
    try {
      rearmed = (await deps.rearm({ row, sentMessageIds, now })).created;
    } catch {
      // 再arm 失敗は「次予約だけ作られない」。後続送信は成功済みなので resume 自体は ok。
    }

    return { ok: true, sentCount: chain.length, rearmed, nextResumeMessageId: holdOut.held?.resumeFromMessageId ?? null };
  };
}
