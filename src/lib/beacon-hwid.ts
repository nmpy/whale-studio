// src/lib/beacon-hwid.ts
//
// LINE Beacon の HWID 正規化ユーティリティ。
// LINE が発行する HWID は 16進英数字（例: "d41d8cd98f"）。
// 大文字小文字や空白混入の可能性があるため、
// DB 保存時も webhook 照合時も同じ関数で正規化することを保証する。

/** 入力値が HWID として許容される形式かを判定する正規表現（小文字英数字のみ） */
export const HWID_PATTERN = /^[a-z0-9]+$/;

export class InvalidBeaconHwidError extends Error {
  readonly code = "INVALID_BEACON_HWID" as const;
  constructor(message = "HWID は英数字のみで指定してください") {
    super(message);
    this.name = "InvalidBeaconHwidError";
  }
}

/**
 * 入力された HWID を正規化する。
 *
 * - trim
 * - 全角・空白を除去
 * - 小文字化
 * - 英数字以外が残った場合は `InvalidBeaconHwidError` を投げる
 *
 * @throws {InvalidBeaconHwidError} 不正形式の場合
 */
export function normalizeBeaconHwid(input: unknown): string {
  if (typeof input !== "string") {
    throw new InvalidBeaconHwidError("HWID は文字列で指定してください");
  }
  // 内部の空白も除去（LINE の表示時に空白が入るケースを救済）
  const compact = input.replace(/\s+/g, "").toLowerCase();
  if (compact.length === 0) {
    throw new InvalidBeaconHwidError("HWID は必須です");
  }
  if (!HWID_PATTERN.test(compact)) {
    throw new InvalidBeaconHwidError(
      "HWID は半角英数字のみ使用できます（記号・全角文字は不可）",
    );
  }
  return compact;
}

/**
 * 例外を投げない版。バリデーション結果を返す。
 */
export function tryNormalizeBeaconHwid(
  input: unknown,
): { ok: true; hwid: string } | { ok: false; error: string } {
  try {
    return { ok: true, hwid: normalizeBeaconHwid(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid hwid" };
  }
}
