// src/__tests__/follow-action.test.ts
//
// LINE 友だち追加（follow）時の送信判断の検証。
// 未設定・空文字・空白のみ・開始対象なしのときは「何も送らない」(デフォルト文面を送らない)。

import { describe, it, expect } from "vitest";
import { decideFollowBehavior } from "@/lib/follow-action";

describe("decideFollowBehavior", () => {
  // followAction = none
  it("none: 何も送らない（skip / followAction=none）", () => {
    const d = decideFollowBehavior({ followAction: "none", welcomeMessage: "x", hasStartTarget: true });
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("followAction=none");
  });

  // followAction = welcome_wait
  it("welcome_wait + welcomeMessage=null: 送らない", () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: null, hasStartTarget: false });
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("welcomeMessage empty");
  });

  it("welcome_wait + welcomeMessage=undefined: 送らない", () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: undefined, hasStartTarget: false });
    expect(d.action).toBe("skip");
  });

  it('welcome_wait + welcomeMessage="": 送らない', () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "", hasStartTarget: false });
    expect(d.action).toBe("skip");
  });

  it('welcome_wait + welcomeMessage="   "(空白のみ): 送らない', () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "   ", hasStartTarget: false });
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("welcomeMessage empty");
  });

  it('welcome_wait + welcomeMessage="こんにちは": 送る（send_welcome）', () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "こんにちは", hasStartTarget: false });
    expect(d.action).toBe("send_welcome");
    expect(d.reason).toBe("welcome_wait message");
  });

  it("welcome_wait + 前後空白付きメッセージ: trim 後に非空なら送る", () => {
    const d = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "  ようこそ  ", hasStartTarget: false });
    expect(d.action).toBe("send_welcome");
  });

  // followAction = auto_start
  it("auto_start + 開始対象なし: 送らない（auto_start target missing）", () => {
    const d = decideFollowBehavior({ followAction: "auto_start", welcomeMessage: null, hasStartTarget: false });
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("auto_start target missing");
  });

  it("auto_start + 開始対象あり: 開始する（auto_start）", () => {
    const d = decideFollowBehavior({ followAction: "auto_start", welcomeMessage: null, hasStartTarget: true });
    expect(d.action).toBe("auto_start");
    expect(d.reason).toBe("auto_start first message");
  });

  // 既定値（未設定）
  it("followAction 未設定（null）は auto_start 扱い: 開始対象なしなら送らない", () => {
    const d = decideFollowBehavior({ followAction: null, welcomeMessage: null, hasStartTarget: false });
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("auto_start target missing");
  });

  it("followAction 未設定（undefined）+ 開始対象あり: auto_start", () => {
    const d = decideFollowBehavior({ followAction: undefined, welcomeMessage: null, hasStartTarget: true });
    expect(d.action).toBe("auto_start");
  });

  it("welcome_wait は開始対象の有無に依存しない（hasStartTarget=true でも welcome 判定）", () => {
    const empty = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "", hasStartTarget: true });
    expect(empty.action).toBe("skip");
    const set = decideFollowBehavior({ followAction: "welcome_wait", welcomeMessage: "やあ", hasStartTarget: false });
    expect(set.action).toBe("send_welcome");
  });
});
