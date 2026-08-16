// src/lib/broadcast/validate.ts
//
// LINE 公式の「Validate message objects of push message」を呼ぶ薄い wrapper。**配信専用**。
//
// なぜ必要か:
//   画像 URL や Flex JSON は管理者が手入力するため、Whale 側の構文チェックだけでは
//   LINE が受理するとは限らない。宛先を snapshot して sending にした後で全宛先が
//   400 で失敗する事故を避けるため、**送信前に LINE 自身に検証させる**。
//
// 重要:
//   - このエンドポイントは **メッセージを送信しない**（検証のみ）。
//   - 応答メッセージ側の送信経路からは呼ばない。配信側だけで使う。
//   - channel access token / LINE の生レスポンスを管理画面へそのまま返さない。

import type { BroadcastLineMessage } from "./content";

const LINE_VALIDATE_PUSH_URL = "https://api.line.me/v2/bot/message/validate/push";

/**
 * 検証 API のタイムアウト。既存の outbound HTTP（lib/uzu-client.ts の sendEnvelope）と
 * 同じ AbortController + 10 秒の方式に合わせる。新しい基盤は作らない。
 *
 * タイムアウトは「内容が不正」ではなく「判定できなかった」なので unavailable 扱いにし、
 * sending へは遷移させない。
 */
export const VALIDATE_TIMEOUT_MS = 10_000;

export type ValidateResult =
  | { ok: true }
  /** LINE が不正と判断した（HTTP 400）。message は管理者向けに整形済み。 */
  | { ok: false; reason: "invalid"; status: number; message: string }
  /** 認証・通信・LINE 側障害など、内容の妥当性を判定できなかった。 */
  | { ok: false; reason: "unavailable"; status: number | null; message: string };

/**
 * 外部（LINE）由来の文字列から channel access token を除去する。
 * LINE がトークンを echo することは想定していないが、**外部入力をそのままログ・
 * 管理画面へ流す経路**であるため、念のため取り除いてから扱う。
 */
function redactToken(s: string, token: string): string {
  return token.length >= 8 ? s.split(token).join("***") : s;
}

/** LINE のエラー body から、管理者に見せてよい範囲だけを取り出す。 */
function summarizeLineError(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string; details?: { message?: string; property?: string }[] };
    const details = (j.details ?? [])
      .slice(0, 5)
      .map((d) => [d.property, d.message].filter(Boolean).join(": "))
      .filter((s) => s !== "");
    const head = j.message ?? "メッセージ内容が LINE の仕様に適合しません";
    return details.length > 0 ? `${head}（${details.join(" / ")}）` : head;
  } catch {
    // 非 JSON はそのまま出さない（想定外の内容が管理画面へ漏れないようにする）
    return "メッセージ内容が LINE の仕様に適合しません";
  }
}

/**
 * LINE 公式 API に messages を検証させる。**送信は行わない。**
 *
 * 判定できなかった場合（token 不正 / ネットワーク / 5xx）は `unavailable` を返す。
 * 呼び出し側が「検証できなかった」と「内容が不正だった」を区別できるようにするため、
 * ここで両者を潰さない。
 */
export async function validateLinePushMessages(args: {
  messages: BroadcastLineMessage[];
  channelAccessToken: string;
  timeoutMs?: number;
}): Promise<ValidateResult> {
  const { messages, channelAccessToken } = args;
  if (messages.length === 0) {
    return { ok: false, reason: "invalid", status: 400, message: "送信するメッセージがありません" };
  }

  const timeoutMs = args.timeoutMs ?? VALIDATE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(LINE_VALIDATE_PUSH_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body:   JSON.stringify({ messages }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("[line:broadcast:validate:error]", JSON.stringify({
      status: null, timedOut: aborted,
      error: aborted ? `timeout ${timeoutMs}ms` : err instanceof Error ? err.message : String(err),
    }));
    return {
      ok: false, reason: "unavailable", status: null,
      message: aborted
        ? "LINE の検証 API がタイムアウトしました。時間をおいて再度お試しください。"
        : "LINE の検証 API に接続できませんでした",
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return { ok: true };

  const body = await res.text().catch(() => "");

  // 400 = メッセージ内容が不正。それ以外（401/403/429/5xx）は内容の可否を判定できていない。
  if (res.status === 400) {
    const message = redactToken(summarizeLineError(body), channelAccessToken);
    console.log("[line:broadcast:validate:invalid]", JSON.stringify({
      status: res.status, types: messages.map((m) => m.type), message,
    }));
    return { ok: false, reason: "invalid", status: res.status, message };
  }

  console.error("[line:broadcast:validate:unavailable]", JSON.stringify({ status: res.status }));
  return {
    ok: false,
    reason: "unavailable",
    status: res.status,
    message: `LINE の検証 API がエラーを返しました（HTTP ${res.status}）`,
  };
}

/**
 * 公式 validate を通す対象か。
 *
 * テキストは MVP 時点から Production で送信実績があり、Whale 側の検証だけで
 * 事故が起きていない。ここで全 text 配信に新しい外部依存（LINE API 呼び出し）を
 * 足すと既存経路の回帰リスクだけが増えるため、**画像 / Flex に限定**する。
 */
export function needsOfficialValidation(kind: string): boolean {
  return kind === "image" || kind === "flex";
}
