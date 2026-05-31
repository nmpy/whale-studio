#!/usr/bin/env tsx
/**
 * scripts/admin/set-oa-plan.ts
 *
 * 指定 OA の Subscription を「内部 grant」として任意プラン (例: plus) に切り替える管理用スクリプト。
 *
 * 設計:
 *   - default は dry-run。`--apply` フラグがあるときだけ DB 更新する。
 *   - 実行前に対象 OA / 現在の subscription / plan / external_id を表示する。
 *   - 指定 plan 名が plans table に存在しない場合はエラー。
 *   - subscriptions が既にある場合: plan_id を切り替え + status を "active" に。
 *   - subscriptions がない場合: 新規作成 (status="active", period = 1 年)。
 *   - external_id は Stripe 契約の識別子。内部 grant では既存値があれば
 *     そのまま温存し、無い (null) ならそのまま null。誤って Stripe 紐付けを壊さない。
 *
 * Stripe 整合性に関する注意:
 *   - このスクリプトは Stripe API を呼ばず、Subscription row のみを書き換える。
 *   - 後で同じ OA で Stripe Checkout を実行した場合、checkout.session.completed
 *     webhook が `subscription.upsert({ where: { oaId }, ... })` を行い、plan_id が
 *     Stripe 側の price に対応する plan で「上書き」される可能性がある。
 *     内部 grant を維持したい OA では Stripe Checkout を実行しないこと。
 *
 * 実行方法:
 *   # dry-run (default) - 何も更新しない、表示のみ
 *   npx tsx scripts/admin/set-oa-plan.ts --oa-id=<uuid> --plan=plus
 *
 *   # 本当に更新する
 *   npx tsx scripts/admin/set-oa-plan.ts --oa-id=<uuid> --plan=plus --apply
 *
 *   # plans テーブルに何が存在するかだけを確認 (read-only)
 *   npx tsx scripts/admin/set-oa-plan.ts --list-plans
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Args = {
  oaId: string | null;
  planName: string | null;
  apply: boolean;
  listPlans: boolean;
};

function parseArgs(argv: string[]): Args {
  let oaId: string | null = null;
  let planName: string | null = null;
  let apply = false;
  let listPlans = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--list-plans") {
      listPlans = true;
    } else if (arg.startsWith("--oa-id=")) {
      oaId = arg.slice("--oa-id=".length).trim();
    } else if (arg.startsWith("--plan=")) {
      planName = arg.slice("--plan=".length).trim();
    }
  }

  return { oaId, planName, apply, listPlans };
}

function usage(): void {
  console.error("使い方:");
  console.error("  npx tsx scripts/admin/set-oa-plan.ts --oa-id=<uuid> --plan=<plan-name> [--apply]");
  console.error("  npx tsx scripts/admin/set-oa-plan.ts --list-plans");
  console.error("");
  console.error("引数:");
  console.error("  --oa-id=<uuid>     対象 OA の id (必須 / --list-plans のときは不要)");
  console.error("  --plan=<name>      切り替え先 plan の name (必須 / 例: plus, standard, pro)");
  console.error("  --apply            実際に DB を更新する (このフラグが無い場合は dry-run)");
  console.error("  --list-plans       plans table の現在状態を表示するだけ (read-only)");
}

async function listPlansAndExit(): Promise<void> {
  const plans = await prisma.plan.findMany({
    orderBy: { name: "asc" },
    select: {
      id:           true,
      name:         true,
      displayName:  true,
      isActive:     true,
      maxWorks:     true,
      maxPlayers:   true,
      priceMonthly: true,
    },
  });
  console.log("─".repeat(72));
  console.log(`plans table (${plans.length} 件)`);
  console.log("─".repeat(72));
  if (plans.length === 0) {
    console.log("  (plans table は空です — seed 未実行の可能性)");
    return;
  }
  for (const p of plans) {
    console.log(
      `  ${p.name.padEnd(10)} | ${p.displayName.padEnd(16)} | active=${String(p.isActive).padEnd(5)} | maxWorks=${String(p.maxWorks).padEnd(3)} | maxPlayers=${String(p.maxPlayers).padEnd(3)} | priceMonthly=${p.priceMonthly}`,
    );
  }
}

async function main(): Promise<void> {
  const { oaId, planName, apply, listPlans } = parseArgs(process.argv.slice(2));

  if (listPlans) {
    await listPlansAndExit();
    return;
  }

  if (!oaId || !planName) {
    console.error("❌ --oa-id と --plan は必須です (または --list-plans を指定)");
    usage();
    process.exit(1);
  }

  // 1. 対象 OA を取得 (subscription / plan を含む)
  const oa = await prisma.oa.findUnique({
    where: { id: oaId },
    select: {
      id:       true,
      title:    true,
      lineOaId: true,
      subscription: {
        select: {
          id:                 true,
          status:             true,
          externalId:         true,
          currentPeriodStart: true,
          currentPeriodEnd:   true,
          plan: {
            select: { id: true, name: true, displayName: true },
          },
        },
      },
    },
  });

  if (!oa) {
    console.error(`❌ OA が見つかりません: ${oaId}`);
    process.exit(1);
  }

  // 2. 指定 plan を取得 (存在チェック)
  const targetPlan = await prisma.plan.findUnique({
    where: { name: planName },
    select: { id: true, name: true, displayName: true, isActive: true },
  });

  if (!targetPlan) {
    console.error(`❌ plan が plans table に存在しません: name="${planName}"`);
    console.error("   利用可能な plan を確認するには:");
    console.error('     SELECT name, display_name, is_active FROM plans ORDER BY name;');
    process.exit(1);
  }

  // 3. 対象情報を表示
  console.log("─".repeat(72));
  console.log("対象 OA");
  console.log("─".repeat(72));
  console.log(`  oa_id:       ${oa.id}`);
  console.log(`  title:       ${oa.title}`);
  console.log(`  line_oa_id:  ${oa.lineOaId ?? "(null)"}`);
  console.log("");
  console.log("現在の Subscription");
  console.log("─".repeat(72));
  if (oa.subscription) {
    const s = oa.subscription;
    console.log(`  subscription_id:      ${s.id}`);
    console.log(`  status:               ${s.status}`);
    console.log(`  external_id:          ${s.externalId ?? "(null)"}`);
    console.log(`  current_period_start: ${s.currentPeriodStart.toISOString()}`);
    console.log(`  current_period_end:   ${s.currentPeriodEnd.toISOString()}`);
    console.log(`  plan.name:            ${s.plan.name}`);
    console.log(`  plan.display_name:    ${s.plan.displayName}`);
  } else {
    console.log("  (subscription なし — このスクリプトで新規作成します)");
  }
  console.log("");
  console.log("切り替え先 Plan");
  console.log("─".repeat(72));
  console.log(`  plan_id:           ${targetPlan.id}`);
  console.log(`  plan.name:         ${targetPlan.name}`);
  console.log(`  plan.display_name: ${targetPlan.displayName}`);
  console.log(`  plan.is_active:    ${targetPlan.isActive}`);
  console.log("");

  // 4. 実行プランを表示
  console.log("─".repeat(72));
  console.log(apply ? "🔧 適用モード (--apply)" : "🔍 DRY-RUN モード (--apply なし)");
  console.log("─".repeat(72));

  if (oa.subscription) {
    console.log("実行内容: 既存 subscription を更新");
    console.log(`  plan_id:    ${oa.subscription.plan.name} (${oa.subscription.plan.id})`);
    console.log(`           → ${targetPlan.name} (${targetPlan.id})`);
    console.log(`  status:     ${oa.subscription.status} → active`);
    console.log(`  external_id: ${oa.subscription.externalId ?? "(null)"} (保持・変更しない)`);
  } else {
    const now = new Date();
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    console.log("実行内容: subscription を新規作成");
    console.log(`  oa_id:                ${oa.id}`);
    console.log(`  plan_id:              ${targetPlan.id} (${targetPlan.name})`);
    console.log(`  status:               active`);
    console.log(`  external_id:          null (内部 grant)`);
    console.log(`  current_period_start: ${now.toISOString()}`);
    console.log(`  current_period_end:   ${end.toISOString()}`);
  }
  console.log("");

  if (!apply) {
    console.log("✋ DRY-RUN のため DB は変更していません。実行するには --apply を付けてください。");
    return;
  }

  // 5. 実 DB 更新
  if (oa.subscription) {
    const updated = await prisma.subscription.update({
      where: { id: oa.subscription.id },
      data: {
        planId: targetPlan.id,
        status: "active",
        // external_id は更新しない (既存値を保持)
      },
      select: {
        id:         true,
        status:     true,
        externalId: true,
        plan:       { select: { name: true, displayName: true } },
      },
    });
    console.log("✅ 更新完了");
    console.log(`  subscription_id:   ${updated.id}`);
    console.log(`  status:            ${updated.status}`);
    console.log(`  external_id:       ${updated.externalId ?? "(null)"}`);
    console.log(`  plan.name:         ${updated.plan.name}`);
    console.log(`  plan.display_name: ${updated.plan.displayName}`);
  } else {
    const now = new Date();
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);

    const created = await prisma.subscription.create({
      data: {
        oaId:               oa.id,
        planId:             targetPlan.id,
        status:             "active",
        currentPeriodStart: now,
        currentPeriodEnd:   end,
        // externalId はデフォルト (null) のまま
      },
      select: {
        id:                 true,
        status:             true,
        externalId:         true,
        currentPeriodStart: true,
        currentPeriodEnd:   true,
        plan:               { select: { name: true, displayName: true } },
      },
    });
    console.log("✅ 作成完了");
    console.log(`  subscription_id:      ${created.id}`);
    console.log(`  status:               ${created.status}`);
    console.log(`  external_id:          ${created.externalId ?? "(null)"}`);
    console.log(`  current_period_start: ${created.currentPeriodStart.toISOString()}`);
    console.log(`  current_period_end:   ${created.currentPeriodEnd.toISOString()}`);
    console.log(`  plan.name:            ${created.plan.name}`);
    console.log(`  plan.display_name:    ${created.plan.displayName}`);
  }
}

main()
  .catch((e) => {
    console.error("❌ エラーが発生しました:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
