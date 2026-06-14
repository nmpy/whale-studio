// src/lib/puzzle-history.ts
//
// プレイヤーに「実際に送信された」謎・問題の出題履歴を記録する。
// LINE 送信関数（line.ts の replyWithLagToLine / pushToLine）から fire-and-forget で呼ぶ。
//
// 設計:
//   - 入力は「送信した LineMessage の _sourceMessageId 群」と lineUserId。
//   - そのうち Message.kind="puzzle" のものだけを PuzzleDelivery に記録する（未送信は記録しない）。
//   - workId は Message 行から導出（呼出側で渡さない）。
//   - @@unique([lineUserId, workId, messageId]) + createMany(skipDuplicates) のため、
//     再出題でも 1 行に集約され deliveredAt は初回出題日時を保持する。
//   - 例外は握りつぶす（履歴記録の失敗が LINE 送信・応答を絶対に壊さない）。

import { prisma } from "@/lib/prisma";

export async function recordPuzzleDeliveries(args: {
  lineUserId: string | null | undefined;
  /** 送信した LineMessage の _sourceMessageId 群（null/undefined・非puzzle は内部で除外）。 */
  sourceMessageIds: (string | null | undefined)[];
}): Promise<void> {
  try {
    const lineUserId = args.lineUserId?.trim();
    if (!lineUserId) return;
    const ids = Array.from(new Set(args.sourceMessageIds.filter((x): x is string => typeof x === "string" && x.length > 0)));
    if (ids.length === 0) return;

    // 送信された id のうち puzzle のみ抽出（workId も取得）。
    const puzzles = await prisma.message.findMany({
      where:  { id: { in: ids }, kind: "puzzle" },
      select: { id: true, workId: true },
    });
    if (puzzles.length === 0) return;

    await prisma.puzzleDelivery.createMany({
      data: puzzles.map((p) => ({ lineUserId, workId: p.workId, messageId: p.id })),
      skipDuplicates: true, // 再出題は初回行を保持（deliveredAt 更新しない）
    });
  } catch (err) {
    // 履歴記録は best-effort。失敗してもユーザー体験（送信/応答）を阻害しない。
    console.warn("[puzzle-history] recordPuzzleDeliveries skipped:", err);
  }
}
