// src/lib/liff/qr-resolve.ts
//
// スキャンした QR 値から「対象の識別子候補」を抽出する純関数。
// DB アクセス・認可は一切行わない（= 入力値の構造解析のみ）。実際の解決（どの Location か、
// その OA/Work に属するか）は必ずサーバー側の route で DB の正規データに対して行う。
//
// 想定する QR 値:
//   1) Whale Studio の LIFF チェックイン URL
//      例: https://liff.line.me/{liffId}?work_id=<work>&location_id=<loc>
//      例: https://liff.line.me/{liffId}?liff.state=%2F%3Fwork_id%3D...%26location_id%3D...
//      例: https://app.whale-studio.app/liff?work_id=<work>&location_id=<loc>
//   2) 生のコード（= location.publicId 等）。URL でなければコードとして扱う。
//
// セキュリティ方針:
//   - ここで抽出した値は「候補」にすぎない。route 側で oaId/workId scope 内の正規 Location
//     としてのみ解決し、他 OA / 他 work の QR は解決しない。
//   - QR 値から任意の messageId 等を直接指定させない（messageId は QR 値から取らない）。

export interface ParsedQrValue {
  /** trim 済みの元の値。 */
  raw: string;
  /** URL として解釈できたか。 */
  isUrl: boolean;
  /** 抽出した location 識別子（publicId または UUID）候補。 */
  locationRef: string | null;
  /** 抽出した work 識別子候補。 */
  workRef: string | null;
  /** 抽出した page 識別子候補。 */
  pageRef: string | null;
  /** URL でない場合の生コード（= location publicId 候補）。 */
  code: string | null;
}

/** 与えられた URLSearchParams から既知のキー（snake / camel 両対応）で最初の非空値を拾う。 */
function pick(params: URLSearchParams, keys: string[]): string | null {
  for (const k of keys) {
    const v = params.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * QR 値を解析して識別子候補を返す。
 * URL でない / 解析不能な場合は code（生値）にフォールバックし、location 候補として扱う。
 */
export function parseQrValue(value: string): ParsedQrValue {
  const raw = (value ?? "").trim();
  const empty: ParsedQrValue = { raw, isUrl: false, locationRef: null, workRef: null, pageRef: null, code: null };
  if (!raw) return empty;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // URL でない → 生コードを location 候補として扱う。
    return { raw, isUrl: false, locationRef: raw, workRef: null, pageRef: null, code: raw };
  }

  // http(s) 以外（javascript:, data: 等）は信用しない → コード扱いにもしない（unmatched に倒す）。
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ...empty, isUrl: false };
  }

  const params = new URLSearchParams(url.search);

  let locationRef = pick(params, ["location_id", "locationId"]);
  let workRef     = pick(params, ["work_id", "workId"]);
  let pageRef     = pick(params, ["page_id", "pageId"]);

  // LIFF は元のサブパス/クエリを liff.state に退避することがある。未抽出分をそこから補う。
  const liffState = params.get("liff.state");
  if (liffState && (!locationRef || !workRef || !pageRef)) {
    try {
      const decoded = decodeURIComponent(liffState);
      // "/path?query" でも "?query" でも "query" でも拾えるよう、ダミー origin に載せて parse する。
      const stateUrl = new URL(decoded, "https://placeholder.invalid");
      const sp = stateUrl.searchParams;
      locationRef = locationRef ?? pick(sp, ["location_id", "locationId"]);
      workRef     = workRef     ?? pick(sp, ["work_id", "workId"]);
      pageRef     = pageRef     ?? pick(sp, ["page_id", "pageId"]);
    } catch {
      // liff.state が壊れていても、上で拾えた分だけで続行する。
    }
  }

  return { raw, isUrl: true, locationRef, workRef, pageRef, code: null };
}

/**
 * コードリーダーブロック（location_checkin）用: 読み取った QR 値を、既存チェックイン導線
 * `/liff?work_id=..&location_id=..` への遷移先に解決する純関数。
 *
 * - QR が Whale のチェックイン URL / liff.state なら work_id / location_id を抽出。
 * - 生コードなら location_id 候補として扱い、work は fallbackWorkId（現在ページの workId）で補う。
 * - location / work が揃わなければ invalid（呼出側で「このQRコードは利用できません」を表示）。
 * - 遷移先は現在オリジンの相対パスに再構成する（QR 内の絶対 URL/ドメインには遷移しない＝安全側）。
 */
export function resolveCheckinFromQr(
  value: string,
  opts?: { fallbackWorkId?: string | null },
): { kind: "checkin"; path: string; workRef: string; locationRef: string } | { kind: "invalid" } {
  const parsed = parseQrValue(value);
  const locationRef = parsed.locationRef;
  if (!locationRef) return { kind: "invalid" };
  const workRef = parsed.workRef ?? opts?.fallbackWorkId ?? null;
  if (!workRef) return { kind: "invalid" };
  const path = `/liff?work_id=${encodeURIComponent(workRef)}&location_id=${encodeURIComponent(locationRef)}`;
  return { kind: "checkin", path, workRef, locationRef };
}

/** route 側で記録/ログ用に QR 値を安全化する（生値を長文のまま保存しない）。
 *  truncateQrValue（qr.ts）と役割が重複しないよう、ここでは「ログ向けの短い preview」を返す。 */
export function qrValuePreview(value: string, max = 64): string {
  const t = (value ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
