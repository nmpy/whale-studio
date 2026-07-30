// src/__tests__/survey-responses-api.test.ts
// POST/GET /api/liff/works/[workId]/survey-responses の重複回答防止・回答済み判定。
//   prisma / public-id-resolver を mock。survey-completion / submission は実物（純関数）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const { mp } = vi.hoisted(() => ({
  mp: {
    liffSurveyResponse: { findFirst: vi.fn(), create: vi.fn() },
    liffSubmission:     { create: vi.fn() },
    liffEventLog:       { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

const { findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId } = vi.hoisted(() => ({
  findWorkByIdOrPublicId: vi.fn(),
  findLiffPageConfigByIdOrPublicId: vi.fn(),
}));
vi.mock("@/lib/public-id-resolver", () => ({ findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId }));

import { POST, GET } from "@/app/api/liff/works/[workId]/survey-responses/route";

const WORK = { id: "work-1", oaId: "oa-1" };
const ctx = { params: Promise.resolve({ workId: "work-public" }) };

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/liff/works/work-public/survey-responses", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    ctx,
  );
}
function get(qs: string) {
  return GET(new NextRequest(`http://localhost/api/liff/works/work-public/survey-responses?${qs}`), ctx);
}
const page = (settingsJson: Record<string, unknown>) => ({ id: "page-1", settingsJson });
const UID = "U0123456789abcdef0123456789abcdef";
const answers = { q0: "hello" };

beforeEach(() => {
  vi.clearAllMocks();
  findWorkByIdOrPublicId.mockResolvedValue(WORK);
  findLiffPageConfigByIdOrPublicId.mockResolvedValue(page({})); // 既定: 複数回答不可（未設定）
  mp.liffSurveyResponse.findFirst.mockResolvedValue(null);
  mp.liffSurveyResponse.create.mockResolvedValue({ id: "resp-1", submittedAt: new Date("2026-07-30T00:00:00Z") });
  mp.liffSubmission.create.mockResolvedValue({});
  mp.liffEventLog.create.mockResolvedValue({});
});

describe("POST survey-responses — 基本", () => {
  it("work 不在 → 404", async () => {
    findWorkByIdOrPublicId.mockResolvedValue(null);
    expect((await post({ answers, page_id: "page-1", line_user_id: UID })).status).toBe(404);
  });
  it("answers 空 → 400", async () => {
    expect((await post({ answers: {}, page_id: "page-1", line_user_id: UID })).status).toBe(400);
    expect(mp.liffSurveyResponse.create).not.toHaveBeenCalled();
  });
});

describe("POST survey-responses — 重複回答防止", () => {
  it("複数回答不可 + 未回答 → 201相当で作成、dedupeKey=`${pageId}:${uid}`", async () => {
    const res = await post({ answers, page_id: "page-1", line_user_id: UID });
    expect(res.status).toBe(200);
    expect(mp.liffSurveyResponse.create).toHaveBeenCalledTimes(1);
    expect(mp.liffSurveyResponse.create.mock.calls[0][0].data).toMatchObject({
      workId: "work-1", liffPageConfigId: "page-1", lineUserId: UID, dedupeKey: "page-1:" + UID,
    });
  });

  it("複数回答不可 + 既に回答済み(事前チェック) → 409 ALREADY_ANSWERED、作成しない", async () => {
    mp.liffSurveyResponse.findFirst.mockResolvedValue({ id: "existing" });
    const res = await post({ answers, page_id: "page-1", line_user_id: UID });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ALREADY_ANSWERED");
    expect(mp.liffSurveyResponse.create).not.toHaveBeenCalled();
  });

  it("競合送信: create が P2002 → 409 ALREADY_ANSWERED", async () => {
    mp.liffSurveyResponse.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" }),
    );
    const res = await post({ answers, page_id: "page-1", line_user_id: UID });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ALREADY_ANSWERED");
  });

  it("複数回答許可 → 事前チェックせず作成、dedupeKey=null（何度でも可）", async () => {
    findLiffPageConfigByIdOrPublicId.mockResolvedValue(page({ survey_allow_multiple: true }));
    const res = await post({ answers, page_id: "page-1", line_user_id: UID });
    expect(res.status).toBe(200);
    expect(mp.liffSurveyResponse.findFirst).not.toHaveBeenCalled();
    expect(mp.liffSurveyResponse.create.mock.calls[0][0].data.dedupeKey).toBeNull();
  });

  it("lineUserId 無し → dedupeKey=null（匿名は重複強制しない）", async () => {
    const res = await post({ answers, page_id: "page-1", line_user_id: null });
    expect(res.status).toBe(200);
    expect(mp.liffSurveyResponse.findFirst).not.toHaveBeenCalled();
    expect(mp.liffSurveyResponse.create.mock.calls[0][0].data.dedupeKey).toBeNull();
  });

  it("page_id 無し → liffPageConfigId=null / dedupeKey=null（旧経路）", async () => {
    const res = await post({ answers, line_user_id: UID });
    expect(res.status).toBe(200);
    expect(findLiffPageConfigByIdOrPublicId).not.toHaveBeenCalled();
    expect(mp.liffSurveyResponse.create.mock.calls[0][0].data).toMatchObject({ liffPageConfigId: null, dedupeKey: null });
  });
});

describe("GET survey-responses — 回答済み判定", () => {
  it("複数回答不可 + 回答済み → answered=true", async () => {
    mp.liffSurveyResponse.findFirst.mockResolvedValue({ id: "existing" });
    const res = await get(`page_id=page-1&line_user_id=${UID}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.answered).toBe(true);
    expect(mp.liffSurveyResponse.findFirst.mock.calls[0][0].where).toMatchObject({ liffPageConfigId: "page-1", lineUserId: UID });
  });
  it("複数回答不可 + 未回答 → answered=false", async () => {
    const res = await get(`page_id=page-1&line_user_id=${UID}`);
    expect((await res.json()).data.answered).toBe(false);
  });
  it("複数回答許可 → 常に answered=false（照会しない）", async () => {
    findLiffPageConfigByIdOrPublicId.mockResolvedValue(page({ survey_allow_multiple: true }));
    const res = await get(`page_id=page-1&line_user_id=${UID}`);
    expect((await res.json()).data.answered).toBe(false);
    expect(mp.liffSurveyResponse.findFirst).not.toHaveBeenCalled();
  });
  it("lineUserId 無し → answered=false", async () => {
    const res = await get(`page_id=page-1`);
    expect((await res.json()).data.answered).toBe(false);
    expect(mp.liffSurveyResponse.findFirst).not.toHaveBeenCalled();
  });
});
