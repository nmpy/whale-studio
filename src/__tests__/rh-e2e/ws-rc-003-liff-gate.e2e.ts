// src/__tests__/rh-e2e/ws-rc-003-liff-gate.e2e.ts
// WS-RC-003 の実証 E2E: LIFF 公開データ API が publishStatus=active / liffEnabled=true を
// 強制しているか、実 route × docker PG で状態マトリクス検証する。
// 露出対象は「非機密（spoiler-safe な問題文）」か、answer/秘密が漏れないかを厳密判定する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as puzzlesGET } from "@/app/api/liff/works/[workId]/puzzles/route";
import { GET as workGET } from "@/app/api/liff/works/[workId]/route";
import { GET as menuGET } from "@/app/api/liff/works/[workId]/menu/route";

interface StateWork { workId: string; publicId: string; puzzleBody: string; answer: string; }
const created: string[] = []; // oaIds to cleanup

async function makeWork(tag: string, publishStatus: string, liffEnabled: boolean): Promise<StateWork> {
  const oa = await prisma.oa.create({ data: { title: `RH-RC003-${tag}`, channelId: "0", channelSecret: "s", channelAccessToken: "t", publishStatus: "active", ownerKey: "rh-test-user-0001", mode: "content", lineOaId: `rc003-${tag}` } });
  created.push(oa.id);
  const work = await prisma.work.create({ data: { oaId: oa.id, title: `W-${tag}`, publishStatus, liffEnabled } });
  const phase = await prisma.phase.create({ data: { workId: work.id, phaseType: "normal", name: "p", sortOrder: 0, isActive: true } });
  const body = `SYNTH問題文-${tag}`;
  const answer = `SYNTH答え-${tag}`;
  await prisma.message.create({ data: { workId: work.id, phaseId: phase.id, kind: "puzzle", messageType: "riddle", body, answer, answerMatchType: JSON.stringify(["exact"]), correctText: `SYNTH正解文-${tag}`, puzzleHintText: `SYNTHヒント-${tag}`, isActive: true, sortOrder: 0 } });
  return { workId: work.id, publicId: work.publicId, puzzleBody: body, answer };
}

const req = (qs = "") => ({ url: `http://localhost/api?${qs}`, headers: new Headers(), method: "GET" } as never);
const ctx = (workId: string) => ({ params: Promise.resolve({ workId }) } as never);

let states: Record<string, StateWork> = {};
beforeAll(async () => {
  states = {
    active_on:  await makeWork("active-on",  "active", true),
    active_off: await makeWork("active-off", "active", false),
    draft_on:   await makeWork("draft-on",   "draft",  true),
    draft_off:  await makeWork("draft-off",  "draft",  false),
  };
});
afterAll(async () => { for (const oaId of created) await prisma.oa.deleteMany({ where: { id: oaId } }); await prisma.$disconnect(); });

describe("WS-RC-003: puzzles API (ungated) — 状態別に何を返すか", () => {
  it("全状態で puzzle 一覧を 200 で返す（active/draft/liff on/off 問わず）", async () => {
    for (const [label, s] of Object.entries(states)) {
      const res = await puzzlesGET(req("mode=all"), ctx(s.publicId));
      expect(res.status, label).toBe(200);
    }
  });

  it("★露出確認: draft+liff-off の作品でも問題文(body)が取得できる（＝active/liffEnabled 非強制）", async () => {
    const s = states.draft_off;
    const res = await puzzlesGET(req("mode=all"), ctx(s.publicId));
    const body = await res.json();
    const bodies = (body.data?.puzzles ?? []).map((p: { body?: string }) => p.body);
    // WS-RC-003 の核心: draft+liff無効でも問題文が返る（gate されていない）
    expect(bodies).toContain(s.puzzleBody);
  });

  it("★機密保護: answer / correctText / hint / 内部管理IDは一切返さない（spoiler-safe）", async () => {
    for (const [label, s] of Object.entries(states)) {
      const res = await puzzlesGET(req("mode=all"), ctx(s.publicId));
      const raw = JSON.stringify(await res.json());
      expect(raw, `${label}: answer leak`).not.toContain(s.answer);
      expect(raw, `${label}: correctText leak`).not.toContain(`SYNTH正解文`);
      expect(raw, `${label}: hint leak`).not.toContain(`SYNTHヒント`);
    }
  });
});

describe("WS-RC-003: gated routes (works/[workId], menu) は liff-off で content を露出しない（対比）", () => {
  // puzzles（ungated）と異なり、works/[workId] と menu は liffEnabled ゲートがある。
  // liff-off の作品では LIFF_DISABLED か、少なくとも問題文 content を返さないことを確認する。
  it("works/[workId]: liff-off → 問題文 content を返さない（LIFF_DISABLED か非200）", async () => {
    const s = states.active_off;
    const res = await workGET(req(), ctx(s.publicId));
    const raw = JSON.stringify(await res.json());
    const gated = res.status !== 200 || raw.includes("LIFF_DISABLED");
    expect(gated).toBe(true);
    expect(raw).not.toContain(s.puzzleBody);
  });
  it("menu: liff-off → 問題文 content を返さない（LIFF_DISABLED か非200）", async () => {
    const s = states.draft_off;
    const res = await menuGET(req(), ctx(s.publicId));
    const raw = JSON.stringify(await res.json());
    const gated = res.status !== 200 || raw.includes("LIFF_DISABLED");
    expect(gated).toBe(true);
    expect(raw).not.toContain(s.puzzleBody);
  });
});

describe("WS-RC-003: tenant 越境がないこと", () => {
  it("puzzles は work.id スコープのみ（他作品の問題文は混ざらない）", async () => {
    const res = await puzzlesGET(req("mode=all"), ctx(states.active_on.publicId));
    const raw = JSON.stringify(await res.json());
    // 他状態作品の問題文が混入しない
    expect(raw).not.toContain(states.draft_off.puzzleBody);
    expect(raw).not.toContain(states.active_off.puzzleBody);
  });
  it("存在しない publicId → 空 or 404（500 化しない）", async () => {
    const res = await puzzlesGET(req("mode=all"), ctx("nonexistent0"));
    expect([200, 404]).toContain(res.status);
  });
});
