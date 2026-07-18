// src/lib/owner-error-log/audit.ts
// エラーログの解決 / 再オープン / 一括解決の監査記録（AdminAuditLog）。
//   - best-effort: 監査書き込みが失敗しても本処理（resolve/reopen/bulk）は失敗させない。
//   - ただし従来の `.catch(() => {})` による**完全な握りつぶし**を廃止し、失敗は構造化ログに残す
//     （console.error）。これにより「監査が残らない」事象の原因追跡が可能になる。
//   - ログには秘密情報・生 LINE userId・生 sourceId・actorId を出さない（operation / action /
//     Prisma エラー概要のみ）。監査レコード自体（AdminAuditLog）は内部監査用途のため、既存規約どおり
//     resourceId / detail に内部識別子（source:sourceId・oaId 等）を保持する（announcement.id 等と同運用）。
//   - action は既存 AdminAuditLog の命名規則（flat verb: create/update/delete/...）に合わせる。
//     具体的な操作種別は detail.op（resolve/reopen/bulk_resolve）で区別し、独自の dotted action は増やさない。

import { prisma } from "@/lib/prisma";

export type ErrorLogAuditOperation = "resolve" | "reopen" | "bulk_resolve";

/** operation → 既存 AdminAuditLog の action（reopen=削除=delete、それ以外=update）。 */
function actionFor(op: ErrorLogAuditOperation): "update" | "delete" {
  return op === "reopen" ? "delete" : "update";
}

export interface ErrorLogAuditInput {
  actorId: string;
  operation: ErrorLogAuditOperation;
  /** 単一操作の対象。bulk では省略。 */
  source?: string;
  sourceId?: string;
  /** detail に含める追加情報（oaId / requested / resolved / skipped / oaIds 等・JSON 化可能な値のみ）。 */
  detail?: Record<string, unknown>;
}

/**
 * エラーログ操作を AdminAuditLog へ記録する（best-effort・**await 必須**）。
 * create が失敗しても throw しない（呼び出し側の resolve/reopen は成功のまま）が、握りつぶさず構造化ログに残す。
 */
export async function writeErrorLogAudit(input: ErrorLogAuditInput): Promise<void> {
  const action = actionFor(input.operation);
  const resourceId = input.source && input.sourceId ? `${input.source}:${input.sourceId}` : "bulk";
  const detail = JSON.stringify({ op: input.operation, source: input.source, ...input.detail });
  try {
    await prisma.adminAuditLog.create({
      data: { actorId: input.actorId, action, resource: "error_log", resourceId, detail },
    });
  } catch (err) {
    // 本処理は失敗させない。ただし握りつぶさず原因追跡できるようにする。
    // 秘密情報・生 userId・生 sourceId・actorId はログに出さない（operation / action / エラー概要のみ）。
    const e = err as { code?: string; name?: string; message?: string };
    console.error("[error-log audit] failed to persist AdminAuditLog", {
      operation: input.operation,
      resource: "error_log",
      action,
      code: e?.code,
      name: e?.name,
      message: (e?.message ?? "").slice(0, 300),
    });
  }
}
