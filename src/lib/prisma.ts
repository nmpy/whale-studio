// src/lib/prisma.ts
// Prisma クライアント シングルトン（Next.js HMR 対応）。
//
// PERF_LOG_ENABLED=1 のとき、$extends で query duration を計測し、
// PERF_SLOW_MS（200ms）を超えるクエリを slow log に出す。
// 出力は model / action / durationMs のみで、args（クエリ引数）は一切出さない（PII 混入回避）。
// OFF のときは $extends の query hook を入れず、既存と完全同一挙動・overhead 0。

import { PrismaClient } from "@prisma/client";
import { PERF_LOG_ENABLED, PERF_SLOW_MS, logSlow } from "@/lib/perf";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// 既存 import (`import { prisma } from "@/lib/prisma"`) を壊さないよう、
// $extends 後のクライアントを `PrismaClient` 型として export する。
// $extends は generic な戻り値型を持つが、ここでは全 model / メソッドを変えていないため
// 構造的に PrismaClient と互換。型注釈で明示しつつ `as unknown as PrismaClient` で
// 既存 import の型推論を維持する。
function createPrismaClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  if (!PERF_LOG_ENABLED) return base;
  return base.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        const start = performance.now();
        try {
          return await query(args);
        } finally {
          const durationMs = Math.round(performance.now() - start);
          if (durationMs >= PERF_SLOW_MS) {
            // args は意図的に出さない（PII / 機密混入回避）
            logSlow("db:slow", {
              model:      model ?? "(none)",
              action:     operation,
              durationMs,
            });
          }
        }
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
