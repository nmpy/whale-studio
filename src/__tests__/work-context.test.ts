// src/__tests__/work-context.test.ts
//
// 作品コンテキスト共通サイドバーの「表示判定 / workId 解決 / active 判定 / query 維持」の純関数テスト。
// 集約判定（/oas/[id] 直下の WorkShellBoundary が使う resolveWorkShell）と、nav の active 判定
// （isSidebarItemActive）を組み合わせ、要件の全経路を end-to-end に近い形で固定する。
import { describe, it, expect } from "vitest";
import { resolveWorkShell, workIdFromPathname, isPrintRoute, withWorkId } from "@/app/oas/[id]/_lib/work-context";
import { buildWorkSidebarSections, isSidebarItemActive } from "@/app/oas/[id]/_lib/work-sidebar-nav";

const OA = "o", WORK = "w";
const wp = (seg: string) => `/oas/${OA}/works/${WORK}${seg}`; // 作品配下 pathname
const lp = (seg = "") => `/oas/${OA}/locations${seg}`; // OA 階層 現地トリガー pathname

describe("resolveWorkShell — Shell 表示判定", () => {
  it("作品配下（pathname に workId）は表示。workId は pathname 由来", () => {
    const r = resolveWorkShell({ pathname: wp("/phases"), queryWorkId: null });
    expect(r).toEqual({ show: true, workId: WORK, activeKey: null });
  });
  it("作品配下 /beacons は表示・activeKey=beacons", () => {
    expect(resolveWorkShell({ pathname: wp("/beacons"), queryWorkId: null }))
      .toEqual({ show: true, workId: WORK, activeKey: "beacons" });
  });
  it("OA 階層 /locations?workId= は表示・activeKey=locations", () => {
    expect(resolveWorkShell({ pathname: lp(), queryWorkId: WORK }))
      .toEqual({ show: true, workId: WORK, activeKey: "locations" });
  });
  it("OA 階層 /locations/beacons?workId= は表示・activeKey=beacons", () => {
    expect(resolveWorkShell({ pathname: lp("/beacons"), queryWorkId: WORK }))
      .toEqual({ show: true, workId: WORK, activeKey: "beacons" });
  });
  it("OA 階層 /locations/logs?workId= は表示・activeKey=locations", () => {
    expect(resolveWorkShell({ pathname: lp("/logs"), queryWorkId: WORK }))
      .toEqual({ show: true, workId: WORK, activeKey: "locations" });
  });
  it("/locations/print?workId= は非表示（印刷専用レイアウト優先）", () => {
    expect(resolveWorkShell({ pathname: lp("/print"), queryWorkId: WORK }).show).toBe(false);
  });
  it("/locations（workId なし）は非表示", () => {
    expect(resolveWorkShell({ pathname: lp(), queryWorkId: null }).show).toBe(false);
  });
  it("OA 一覧（/oas）は非表示", () => {
    expect(resolveWorkShell({ pathname: "/oas", queryWorkId: null }).show).toBe(false);
  });
  it("pathname workId と query workId が競合したら pathname を採用", () => {
    const r = resolveWorkShell({ pathname: wp("/messages"), queryWorkId: "OTHER" });
    expect(r.workId).toBe(WORK); // pathname 優先
  });
  it("作成ページ /works/new は workId 扱いしない → 非表示", () => {
    expect(resolveWorkShell({ pathname: `/oas/${OA}/works/new`, queryWorkId: null }).show).toBe(false);
  });
  it("空 query workId は非表示", () => {
    expect(resolveWorkShell({ pathname: lp(), queryWorkId: "" }).show).toBe(false);
  });
});

describe("workIdFromPathname / isPrintRoute", () => {
  it("/works/[workId] を抽出", () => {
    expect(workIdFromPathname(wp("/liff"))).toBe(WORK);
    expect(workIdFromPathname(`/oas/${OA}/works/${WORK}`)).toBe(WORK);
  });
  it("/works/new と works 直下は null", () => {
    expect(workIdFromPathname(`/oas/${OA}/works/new`)).toBeNull();
    expect(workIdFromPathname(`/oas/${OA}/works`)).toBeNull();
  });
  it("locations 系 pathname は pathname から workId を取らない（query 由来のみ）", () => {
    expect(workIdFromPathname(lp("/beacons"))).toBeNull();
  });
  it("印刷ルート判定", () => {
    expect(isPrintRoute(lp("/print"))).toBe(true);
    expect(isPrintRoute(lp("/logs"))).toBe(false);
  });
});

// resolveWorkShell の activeKey と nav の active 判定を合成して、実際にどの項目が active になるか固定する。
function activeLabels(pathname: string, queryWorkId: string | null = null): string[] {
  const { show, workId, activeKey } = resolveWorkShell({ pathname, queryWorkId });
  if (!show || !workId) return [];
  const base = `/oas/${OA}/works/${workId}`;
  const items = buildWorkSidebarSections({ oaId: OA, workId, isTester: false }).flatMap((s) => s.items);
  return items.filter((it) => isSidebarItemActive(it, pathname, base, activeKey)).map((it) => it.label);
}

describe("active 判定 — 機能カテゴリに一致し、二重 active にならない", () => {
  const cases: [string, string, string | null][] = [
    [wp("/scenario"), "フェーズ", null],
    [wp("/phases"), "フェーズ", null],
    [wp("/characters"), "キャラクター", null],
    [wp("/messages"), "応答メッセージ", null],
    [wp("/liff"), "LIFF", null],
    [wp("/audiences"), "オーディエンス", null],
    [wp("/beacons"), "ビーコン", null], // 後方互換 works 配下 beacons
    [lp(), "ロケーション", WORK],
    [lp("/logs"), "ロケーション", WORK],
    [lp("/beacons"), "ビーコン", WORK],
    [lp("/beacons/logs"), "ビーコン", WORK],
  ];
  for (const [pathname, expected, q] of cases) {
    it(`${pathname} → 「${expected}」のみ active`, () => {
      expect(activeLabels(pathname, q)).toEqual([expected]);
    });
  }

  it("作品トップは 作品トップ のみ active", () => {
    expect(activeLabels(`/oas/${OA}/works/${WORK}`)).toEqual(["作品トップ"]);
  });
  it("/locations と /locations/beacons は決して同時 active にならない", () => {
    expect(activeLabels(lp(), WORK)).not.toContain("ビーコン");
    expect(activeLabels(lp("/beacons"), WORK)).not.toContain("ロケーション");
  });
});

describe("withWorkId — 既存 query を壊さず workId を維持（手書き結合をしない）", () => {
  it("query 無し href に付与", () => {
    expect(withWorkId("/oas/o/locations", "w")).toBe("/oas/o/locations?workId=w");
  });
  it("既存 query を保持して付与", () => {
    expect(withWorkId("/oas/o/locations/logs?type=beacon", "w")).toBe("/oas/o/locations/logs?type=beacon&workId=w");
    expect(withWorkId("/oas/o/locations/beacons/logs?hwid=abc", "w")).toBe("/oas/o/locations/beacons/logs?hwid=abc&workId=w");
  });
  it("workId が空なら元 href のまま（作品フィルタ解除等）", () => {
    expect(withWorkId("/oas/o/locations", null)).toBe("/oas/o/locations");
    expect(withWorkId("/oas/o/locations", "")).toBe("/oas/o/locations");
  });
  it("既に workId がある場合は上書きしない", () => {
    expect(withWorkId("/oas/o/locations?workId=existing", "w")).toBe("/oas/o/locations?workId=existing");
  });
});
