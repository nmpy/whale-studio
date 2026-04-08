// src/lib/destination-url-builder.ts
// 遷移先URL（destination）から最終的にLINEのURIアクション等に設定すべきURLを生成する。
// server / client 両方から使用可能。

/**
 * destination レコードから LINE に設定すべき resolved URL を生成する。
 *
 * @param dest - DB の destination レコード（snake_case API 形式でも camelCase でも可）
 * @param opts - LIFF ID / base URL の上書き（テスト用）
 */
export function resolveDestinationUrl(
  dest: {
    destinationType: string;
    liffTargetType?: string | null;
    urlOrPath?: string | null;
    queryParamsJson?: Record<string, string> | unknown;
    workId: string;
  },
  opts?: {
    liffId?: string;
    baseUrl?: string;
  }
): string | null {
  const liffId = opts?.liffId ?? process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const baseUrl = opts?.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const qp = (dest.queryParamsJson ?? {}) as Record<string, string>;

  switch (dest.destinationType) {
    case "liff": {
      if (!liffId) return null;
      const params = new URLSearchParams({ workId: dest.workId, ...qp });
      return `https://liff.line.me/${liffId}?${params.toString()}`;
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
  },
  opts?: { liffId?: string; baseUrl?: string }
): string | null {
  return resolveDestinationUrl(
    {
      destinationType: dest.destination_type,
      liffTargetType: dest.liff_target_type,
      urlOrPath: dest.url_or_path,
      queryParamsJson: dest.query_params_json,
      workId: dest.work_id,
    },
    opts
  );
}
