// src/lib/destination-url-builder.ts
// 遷移先URL（destination）から最終的にLINEのURIアクション等に設定すべきURLを生成する。
// server / client 両方から使用可能。
//
// ## liffId は呼び出し側が解決して渡す（env fallback なし）
//
// destinationType="liff" の URL は、リッチメニューエディタ等で**運用者がそのまま
// 本番設定へ保存する**。ここで `process.env.NEXT_PUBLIC_LIFF_ID` へフォールバック
// すると、対象 OA と無関係な LIFF（テスト用ログインチャネル）の URL が
// 一見正常な見た目で生成され、そのまま本番に焼き付く。
// 実際に D.O.T と Whale Studio 自社 OA のリッチメニューで発生した。
//
// そのためこのモジュールは **liffId を env から読まない**。
// 呼び出し側が対象 Work の OA から `Oa.liffId` を解決して `opts.liffId` で渡すこと
// （server: `prisma.oa.findUnique({select:{liffId:true}})` + `getLiffIdForUrlGeneration`、
//   client: `fetchOaLiffId(oaId)`）。渡されなければ URL を生成せず null を返す。
//
// ※ `baseUrl`（internal_url 用）の env フォールバックは残している。
//   これはアプリ自身の origin であって OA ごとに変わる識別子ではないため、
//   別 OA の URL が混入する余地がない。liffId とは性質が違うので分けて扱う。
//
// ## URL の path は用途別の canonical route を使う
//
// 旧実装は `https://liff.line.me/{liffId}?workId={uuid}` を生成していたが、これは
// **LIFF runtime の契約と一致せず動作しない**:
//   - `/liff` は `work_id`（snake_case）を読む。`workId`（camelCase）は読まれない
//   - そもそも `/liff` はチェックイン専用入口で `location_id` も必須。
//     足りないと MISSING_PARAMS の案内画面になる
// LineDestination は Work スコープ（page 参照を持たない）なので、canonical は
// **作品ホーム** `/w/{workPublicId}`（publicId の無い旧データのみ `/work/{workId}`）。
// URL 組み立ては既存の buildWorkHomeLiffUrl を再利用し、ここで重複実装しない。
//
// page を特定できないデータから `/p/{pagePublicId}` を捏造してはいけない
// （最初の published page 等を推測で採用するのも禁止）。

import { buildWorkHomeLiffUrl } from "@/lib/liff/public-urls";

/**
 * destination レコードから LINE に設定すべき resolved URL を生成する。
 *
 * @param dest - DB の destination レコード（snake_case API 形式でも camelCase でも可）
 * @param opts - liffId は**必須相当**（対象 OA の Oa.liffId）。無い場合 liff 型は null を返す。
 *               baseUrl は internal_url 用のアプリ origin（未指定なら env → localhost）。
 */
export function resolveDestinationUrl(
  dest: {
    destinationType: string;
    liffTargetType?: string | null;
    urlOrPath?: string | null;
    queryParamsJson?: Record<string, string> | unknown;
    workId: string;
    /** Work の公開 URL 用短縮 ID。canonical な `/w/{workPublicId}` を組むのに使う。 */
    workPublicId?: string | null;
  },
  opts?: {
    /** 対象 OA の Oa.liffId。未設定/null なら liff 型は生成不能（null）になる。 */
    liffId?: string | null;
    baseUrl?: string;
  }
): string | null {
  // liffId は opts のみ。env へフォールバックしない（誤 OA の LIFF URL を作らないため）。
  const liffId = opts?.liffId?.trim() ?? "";
  const baseUrl = opts?.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const qp = (dest.queryParamsJson ?? {}) as Record<string, string>;

  switch (dest.destinationType) {
    case "liff": {
      // Oa.liffId が解決できないときは「生成不能」。env の共通 LIFF で代用しない。
      if (!liffId) return null;

      // canonical: 作品ホーム。publicId があれば /w/{workPublicId}、無ければ旧 /work/{workId}。
      // bare `https://liff.line.me/{liffId}` や `?workId=` には落とさない。
      const base = buildWorkHomeLiffUrl({
        liffId,
        workPublicId: dest.workPublicId,
        workId:       dest.workId,
      });
      if (!base) return null;

      // query_params は従来どおりそのまま引き継ぐ（空文字の値も落とさない）。
      // workId は path が作品を表すので query には入れない。
      const params = new URLSearchParams(qp);
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }

    case "internal_url": {
      const path = dest.urlOrPath ?? "";
      if (!path.startsWith("/")) return null;
      const url = new URL(path, baseUrl || "https://localhost:3000");
      for (const [k, v] of Object.entries(qp)) {
        url.searchParams.set(k, v);
      }
      return url.toString();
    }

    case "external_url": {
      const raw = dest.urlOrPath ?? "";
      if (!raw.startsWith("http")) return null;
      try {
        const url = new URL(raw);
        for (const [k, v] of Object.entries(qp)) {
          url.searchParams.set(k, v);
        }
        return url.toString();
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

/**
 * API レスポンス形式（snake_case）の destination から resolved URL を生成する。
 * フロントエンドで使用。
 */
export function resolveDestinationUrlFromApi(
  dest: {
    destination_type: string;
    liff_target_type?: string | null;
    url_or_path?: string | null;
    query_params_json?: Record<string, string>;
    work_id: string;
    work_public_id?: string | null;
  },
  opts?: { liffId?: string | null; baseUrl?: string }
): string | null {
  return resolveDestinationUrl(
    {
      destinationType: dest.destination_type,
      liffTargetType: dest.liff_target_type,
      urlOrPath: dest.url_or_path,
      queryParamsJson: dest.query_params_json,
      workId: dest.work_id,
      workPublicId: dest.work_public_id,
    },
    opts
  );
}
