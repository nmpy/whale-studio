// src/lib/ticket-link/reservation-number.ts
//
// 予約番号（ESCAPE.ID）の正規化・抽出・マスク表示。DOM 非依存・純関数のみ（テスト対象）。
//
// 実フォーマット: 数字のみ + ハイフン区切り（例 `123-456`）。
//   運用で全角入力・異体ハイフン・空白区切りが混ざるため、照合前に必ず正規化する。
//
// 設計方針:
//   - 正規化は「表記ゆれの吸収」だけを行い、桁の補完や推測は一切しない。
//   - 正規表現だけで最終確定しない（抽出は候補列挙まで。確定はプレイヤーの確認操作で行う）。
//   - 一般会話を誤ってチケット連携として扱わないため、日付/時刻/電話番号らしき並びは候補から外す。
//   - UZU Pro CMS 側の保存値（PlayerBooking.externalBookingId）は変更しない。
//     照合は「両システムで同じ正規化関数を通した値どうし」で比較する。

/** 正規化後に許容する予約番号の形。数字グループ 2 つをハイフンで繋いだ形のみ。 */
const CANONICAL = /^\d{2,8}-\d{2,8}$/;

/** 実運用の予約番号の桁数（数字のみの合計）。この桁数のときだけ区切りを補完する。 */
export const RESERVATION_NUMBER_DIGITS = 6;
/** 区切り位置（先頭から何桁目の後ろにハイフンを入れるか）。 */
const RESERVATION_NUMBER_SPLIT_AT = 3;
/** 入力欄の表示上の最大文字数（数字 6 桁 + ハイフン 1）。 */
export const RESERVATION_NUMBER_MAX_LENGTH = RESERVATION_NUMBER_DIGITS + 1;

/**
 * 入力途中の**表示用**整形。確定値の検証はしない（そのため常に string を返す）。
 *
 * 数字以外（英字・記号・ハイフン・空白）はすべて落とし、全角数字は半角へ寄せる。
 * 数字が 4 桁以上になった時点で 3 桁目の後ろへハイフンを入れる。
 *
 *   ""       → ""        "1"      → "1"
 *   "123"    → "123"     "1234"   → "123-4"
 *   "123456" → "123-456" "1234567"→ "123-456"（7 桁目以降は捨てる）
 *
 * バックスペースで末尾を消すと桁数が減り、3 桁以下に戻ればハイフンも自然に消える
 * （"123-4" → "123-" → 数字3桁 → "123"）。末尾ハイフンは付けない。
 */
export function formatReservationNumberInput(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.normalize("NFKC").replace(/\D/g, "").slice(0, RESERVATION_NUMBER_DIGITS);
  if (digits.length <= RESERVATION_NUMBER_SPLIT_AT) return digits;
  return `${digits.slice(0, RESERVATION_NUMBER_SPLIT_AT)}-${digits.slice(RESERVATION_NUMBER_SPLIT_AT)}`;
}

/**
 * 手動入力欄の値が「6 桁そろっている」か。**入力完了判定専用**。
 *
 * なぜ normalizeReservationNumber だけでは足りないか:
 *   照合キーの正規形 CANONICAL は `\d{2,8}-\d{2,8}` と緩く、他フォーマットの予約番号
 *   （例 `12-34`）も受理する。そのため入力途中の `12345` を整形した `123-45` も
 *   「正規形として妥当」になってしまい、未完成のまま送信できてしまう。
 *   手動入力 UI は 6 桁固定なので、桁数でも完了を判定する。
 *   （CANONICAL 自体は既存データ・他経路の互換のため変更しない）
 */
export function isCompleteReservationNumberInput(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.normalize("NFKC").replace(/\D/g, "").length === RESERVATION_NUMBER_DIGITS;
}

// ─── ticket_link 手動入力 専用の厳格判定 ───────────────────────────────────
//
// 共通の normalizeReservationNumber / CANONICAL は、Live Mode（#588/#589）や
// 外部連携など**他経路の既存フォーマット**（例 `12-34`）も受理する必要があるため
// 緩いままにする。ticket_link の手動入力だけは「数字 6 桁を 3-3 で区切る」形に固定したい。
// そこで専用の純関数を分けて、クライアント / draft API / 確定処理で共有する。

/** ticket_link 手動入力で**入力を許可する文字**（半角/全角数字・ハイフン異体字・半角/全角空白）。 */
const TICKET_LINK_ALLOWED_CHARS = /^[0-9０-９‐‑‒–—―−ー－﹣\-\s　]*$/;

/** ticket_link 手動入力の最終正規形。3 桁-3 桁のみ。 */
const TICKET_LINK_CANONICAL = /^\d{3}-\d{3}$/;

export type TicketLinkReservationNumberParseResult =
  /** 正規形まで確定できた。normalized を保存・照合・外部連携に使う。 */
  | { ok: true; normalized: string; formatted: string }
  /**
   * 失敗理由:
   *   incomplete        … 数字が 6 桁に満たない（入力途中）
   *   invalid_character … 数字・ハイフン・空白以外を含む（英字 / 記号など）
   *   invalid_format    … 文字種は正しいが 3-3 の 6 桁にならない（例 `12-34` / `1234567`）
   */
  | { ok: false; reason: "incomplete" | "invalid_character" | "invalid_format" };

/**
 * ticket_link 手動入力の予約番号を厳格に解析する。
 *
 * **不正文字を黙って捨てない。** 数字だけを抜き出すと 6 桁になる入力（例 `abc123def456`）でも
 * invalid_character として拒否する。クライアントを迂回した直接 POST でも同じ関数で弾く。
 *
 *   "123456" / "123-456" / "123 456" / "１２３－４５６" → ok "123-456"
 *   "12345"        → incomplete
 *   "abc123def456" / "123/456" / "123_456" / "123456円" → invalid_character
 *   "12-34" / "1234-56" / "1234567"                     → invalid_format
 */
export function parseTicketLinkReservationNumberInput(
  raw: string | null | undefined,
): TicketLinkReservationNumberParseResult {
  const s = (raw ?? "").trim();
  if (s.length === 0) return { ok: false, reason: "incomplete" };

  // 1) 文字種チェック（正規化前の生値で判定する。数字以外を落とす前に弾くため）
  if (!TICKET_LINK_ALLOWED_CHARS.test(s)) return { ok: false, reason: "invalid_character" };

  // 2) 共通の正規化（NFKC / ハイフン統一 / 空白区切り / 6 桁補完）を再利用
  const normalized = normalizeReservationNumber(s);

  // 3) ticket_link は 3-3 の 6 桁のみ
  if (!normalized || !TICKET_LINK_CANONICAL.test(normalized)) {
    const digits = s.normalize("NFKC").replace(/\D/g, "");
    if (digits.length < RESERVATION_NUMBER_DIGITS) return { ok: false, reason: "incomplete" };
    return { ok: false, reason: "invalid_format" };
  }

  return { ok: true, normalized, formatted: normalized };
}

/** 解析失敗の理由 → ユーザー向け文言（内部情報は出さない）。 */
export function ticketLinkReservationNumberErrorMessage(
  reason: "incomplete" | "invalid_character" | "invalid_format",
): string {
  switch (reason) {
    case "invalid_character": return "予約番号には数字とハイフンのみ入力できます。";
    case "invalid_format":    return "予約番号は数字6桁（例 123-456）で入力してください。";
    case "incomplete":
    default:                  return "予約番号は数字6桁で入力してください。";
  }
}

/**
 * 予約番号を照合キーへ正規化する。
 *
 * 手順: NFKC（全角数字→半角） → ハイフン類を `-` へ統一 → 数字間の空白を `-` へ → 残余空白除去
 *       → **区切り無しちょうど 6 桁なら 3-3 に補完** → 期待する形に一致しなければ null。
 *
 * 例: `１２３－４５６` / `123 456` / `123ー456` / ` 123-456 ` → いずれも `123-456`
 *
 * 区切り補完について（後方互換）:
 *   実運用の予約番号は「数字 6 桁を 3-3 で区切る」形のみ。ユーザーが区切りを省いて
 *   `123456` と入力/貼り付けするケースを救うため、**ちょうど 6 桁**のときだけ `123-456` を返す。
 *   これは受理範囲の**拡張のみ**で、従来受理していた入力の結果は一切変えない。
 *   桁数が 6 でない区切り無しの数字（例 `123` / `12345678`）は従来どおり null のままにする
 *   （区切り位置を推測すると別予約に誤一致しうるため）。
 */
export function normalizeReservationNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw.normalize("NFKC");

  // ハイフンとして使われがちな文字を `-` に寄せる。
  s = s.replace(/[‐‑‒–—―−ー－﹣]/g, "-");

  // 「数字 空白 数字」の区切りをハイフンとみなす（`123 456` → `123-456`）。
  s = s.replace(/(\d)[\s　]+(\d)/g, "$1-$2");

  // 残った空白（前後・内部）は除去する。
  s = s.replace(/[\s　]/g, "");

  // 連続ハイフンは 1 つに畳む（`123--456` のような打ち間違いを吸収）。
  s = s.replace(/-{2,}/g, "-");

  // 前後のハイフンは区切りではないので落とす。
  s = s.replace(/^-+|-+$/g, "");

  // 区切りが無く、ちょうど 6 桁の数字なら 3-3 に補完する（`123456` → `123-456`）。
  // 桁数が違う場合は補完しない（区切り位置を推測して誤一致させない）。
  if (new RegExp(`^\\d{${RESERVATION_NUMBER_DIGITS}}$`).test(s)) {
    s = `${s.slice(0, RESERVATION_NUMBER_SPLIT_AT)}-${s.slice(RESERVATION_NUMBER_SPLIT_AT)}`;
  }

  return CANONICAL.test(s) ? s : null;
}

/** 正規化済みの形かどうか（サーバ側の再検証用）。 */
export function isNormalizedReservationNumber(value: string): boolean {
  return CANONICAL.test(value);
}

/**
 * 日付・時刻・電話番号らしき並びを予約番号候補から除外する。
 * 誤検知（一般会話・別用途テキスト）を減らすためのガード。
 */
function looksLikeNonReservation(candidate: string): boolean {
  const [left, right] = candidate.split("-");

  // 西暦らしき 4 桁（19xx / 20xx）で始まる = 日付の可能性が高い。
  if (/^(19|20)\d{2}$/.test(left)) return true;

  // 月日らしき組（左 1-2 桁 かつ 右 1-2 桁 で暦の範囲に収まる）。
  const l = Number(left);
  const r = Number(right);
  if (left.length <= 2 && right.length <= 2 && l >= 1 && l <= 12 && r >= 1 && r <= 31) return true;

  // 電話番号らしき長さ（合計 10 桁以上）。
  if (left.length + right.length >= 10) return true;

  return false;
}

/**
 * 自由文から予約番号候補を列挙する（重複排除・出現順）。
 *
 * `予約番号は123-456です` のように前後へ文章が付くケースを想定する。
 * **候補が 1 件のときだけ**呼び出し側で自動確定してよい。0 件 / 複数件は手動入力へ誘導する。
 */
export function extractReservationNumberCandidates(text: string | null | undefined): string[] {
  if (!text) return [];

  const normalizedText = text
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−ー－﹣]/g, "-");

  // 数字グループ - 数字グループ。前後が数字/ハイフンでない位置のみ拾う。
  const matches = normalizedText.match(/(?<![\d-])\d{2,8}-\d{2,8}(?![\d-])/g) ?? [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const normalized = normalizeReservationNumber(m);
    if (!normalized) continue;
    if (looksLikeNonReservation(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * 画面表示用のマスク。全桁を常時表示しない（例 `123-456` → `123-***`）。
 * ハイフンが無い/想定外の形でも、先頭 3 文字だけ残して伏せる。
 */
export function maskReservationNumber(value: string | null | undefined): string {
  if (!value) return "—";
  const idx = value.indexOf("-");
  if (idx > 0) return `${value.slice(0, idx)}-***`;
  return `${value.slice(0, 3)}***`;
}
