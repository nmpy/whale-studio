/**
 * src/__tests__/admin-bootstrap-cache.test.ts
 *
 * メッセージ一覧 Bootstrap のクライアント側 cache（module-scope Map）を検証する。
 *
 * 検証観点:
 *   - miss は null
 *   - set 後は fresh で返る
 *   - FRESH 超過〜MAX_AGE 以内は「stale だが使える」(isFresh=false)
 *   - MAX_AGE 超過は破棄して null
 *   - invalidate で消える
 *   - oaId/workId が違えば別 entry（汚染しない）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedBootstrap,
  setCachedBootstrap,
  invalidateBootstrap,
  clearAllBootstrap,
  _clearBootstrapCacheForTest,
  BOOTSTRAP_FRESH_MS,
  BOOTSTRAP_MAX_AGE_MS,
} from "@/lib/admin-bootstrap-cache";
import type { MessagesBootstrapData } from "@/lib/api-client";

function stub(title: string): MessagesBootstrapData {
  return {
    work: {
      id: "w1", oa_id: "oa1", title, welcome_message: null,
      publish_status: "draft", liff_enabled: true, resume_enabled: true, system_character_id: null,
    },
    messages: [],
    phases: [],
    transitions: [],
    role: "owner",
    permissions: { can_edit: true, is_owner: true, is_admin: true, is_viewer: false },
    counts: { messages: 0, phases: 0, transitions: 0 },
  };
}

beforeEach(() => {
  _clearBootstrapCacheForTest();
});

describe("admin-bootstrap-cache", () => {
  it("miss は null を返す", () => {
    expect(getCachedBootstrap("oa1", "w1", 1000)).toBeNull();
  });

  it("set 後は fresh で返る", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 1000);
    const hit = getCachedBootstrap("oa1", "w1", 1000);
    expect(hit).not.toBeNull();
    expect(hit!.data.work.title).toBe("A");
    expect(hit!.isFresh).toBe(true);
  });

  it("FRESH 境界ちょうどは fresh、超えると stale (使えるが要 revalidate)", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 0);
    expect(getCachedBootstrap("oa1", "w1", BOOTSTRAP_FRESH_MS)!.isFresh).toBe(true);
    const stale = getCachedBootstrap("oa1", "w1", BOOTSTRAP_FRESH_MS + 1);
    expect(stale).not.toBeNull();
    expect(stale!.isFresh).toBe(false);
  });

  it("MAX_AGE 超過は破棄して null", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 0);
    expect(getCachedBootstrap("oa1", "w1", BOOTSTRAP_MAX_AGE_MS + 1)).toBeNull();
    // 破棄済みなので、now を戻しても復活しない
    expect(getCachedBootstrap("oa1", "w1", 0)).toBeNull();
  });

  it("invalidate で消える", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 1000);
    invalidateBootstrap("oa1", "w1");
    expect(getCachedBootstrap("oa1", "w1", 1000)).toBeNull();
  });

  it("oaId/workId が違えば別 entry", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 1000);
    expect(getCachedBootstrap("oa1", "w2", 1000)).toBeNull();
    expect(getCachedBootstrap("oa2", "w1", 1000)).toBeNull();
    expect(getCachedBootstrap("oa1", "w1", 1000)!.data.work.title).toBe("A");
  });

  it("clearAllBootstrap は全 entry を一掃する（ユーザー切替/ログアウト用）", () => {
    setCachedBootstrap("oa1", "w1", stub("A"), 1000);
    setCachedBootstrap("oa2", "w9", stub("B"), 1000);
    clearAllBootstrap();
    expect(getCachedBootstrap("oa1", "w1", 1000)).toBeNull();
    expect(getCachedBootstrap("oa2", "w9", 1000)).toBeNull();
  });
});
