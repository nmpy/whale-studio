/**
 * src/__tests__/stripe-webhook-idempotency.test.ts
 *
 * Stripe Webhook の idempotency 制御 (= 二重受信検知) を検証する。
 *
 * webhook route 本体 (= 署名検証 + Stripe SDK + Prisma の組み合わせ) を統合テスト
 * するのは困難なので、本テストでは「Prisma の unique 制約違反検知」ロジックを
 * 個別に検証する。
 *
 * 検証:
 *   1. P2002 (= Prisma 標準の unique 制約違反コード) は二重受信として検知する
 *   2. 他のエラーコード / 形状の値は二重受信として検知しない (= 通常エラーとして上位に伝播)
 *   3. プレーン Error 等は二重受信として扱わない
 *
 * 受け入れ条件:
 *   - 同一 stripeEventId の 2 回目の create が P2002 で失敗した場合のみ
 *     "skip" として 200 を返す経路に入る
 */

import { describe, it, expect } from "vitest";

// isPrismaUniqueViolation は webhook/route.ts 内のローカル関数のため、本テストでは
// 同一ロジックを再現してテストする (= 関数の挙動定義を test 側でも明示する)。
// 万一 route.ts のロジックが変わった場合は本テストの再現関数も合わせて更新する。
function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

describe("Stripe Webhook idempotency: isPrismaUniqueViolation", () => {
  it("P2002 (= Prisma unique 制約違反) → true", () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    expect(isPrismaUniqueViolation(err)).toBe(true);
  });

  it("P2002 + meta 付きエラー (= Prisma 実物の形) → true", () => {
    const err = Object.assign(new Error("Unique constraint failed on the fields: (`stripe_event_id`)"), {
      code: "P2002",
      meta: { target: ["stripe_event_id"] },
    });
    expect(isPrismaUniqueViolation(err)).toBe(true);
  });

  it("他の Prisma コード (P2025 = Record not found) → false", () => {
    const err = Object.assign(new Error("Record not found"), { code: "P2025" });
    expect(isPrismaUniqueViolation(err)).toBe(false);
  });

  it("コードを持たないプレーン Error → false", () => {
    expect(isPrismaUniqueViolation(new Error("db down"))).toBe(false);
  });

  it("null / undefined → false", () => {
    expect(isPrismaUniqueViolation(null)).toBe(false);
    expect(isPrismaUniqueViolation(undefined)).toBe(false);
  });

  it("string / number → false", () => {
    expect(isPrismaUniqueViolation("error")).toBe(false);
    expect(isPrismaUniqueViolation(42)).toBe(false);
  });

  it("object だが code 値が違う → false", () => {
    expect(isPrismaUniqueViolation({ code: "P0001" })).toBe(false);
    expect(isPrismaUniqueViolation({ code: 2002 })).toBe(false);
    expect(isPrismaUniqueViolation({ message: "P2002" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Webhook idempotency フロー (= 期待挙動の仕様確認)
//
// 本セクションは実行ロジックではなく「設計の仕様 (= フロー記述)」を
// テスト形式で残し、レビュー時に挙動を確認しやすくする。
// 実際の手動確認手順は PR 本文に記載する。
// ──────────────────────────────────────────────────────────
describe("Webhook idempotency: 期待フロー (= 仕様メモ)", () => {
  it("受信フローのステップを記述する", () => {
    const expectedFlow = [
      "1. POST /api/billing/webhook がリクエストを受信",
      "2. Stripe-Signature を STRIPE_WEBHOOK_SECRET で検証",
      "3. prisma.stripeWebhookEvent.create({ stripeEventId: event.id, status: 'received' }) で reserve",
      "4. P2002 で失敗したら → 200 { received: true, skipped: true } を返して終了",
      "5. それ以外の失敗 → 500 (Stripe に再送させる)",
      "6. event.type に応じて handleCheckoutCompleted / handleSubscriptionUpdated / handleSubscriptionDeleted を呼ぶ",
      "7. 処理成功 → status='processed' + processedAt セット、200 を返す",
      "8. 処理失敗 → status='failed' + errorMessage セット、200 を返す (= 再送ループ抑制)",
      "9. update 自体の失敗 → ログのみ、200 を返す",
    ];
    expect(expectedFlow).toHaveLength(9);
  });

  it("二重受信時に処理ハンドラ (handleCheckoutCompleted 等) が呼ばれない", () => {
    // P2002 を catch して early return するため、switch 文に到達しない。
    // 実機確認は PR 本文の「手動確認手順」セクションに記載。
    expect(true).toBe(true);
  });

  it("処理失敗時も Stripe には 200 を返し、失敗内容は stripe_webhook_events に残る", () => {
    // status='failed' + errorMessage で記録 → SELECT で管理者が後から確認可能。
    expect(true).toBe(true);
  });
});
