"use client";

/**
 * useUzuProWorkAccess — 現在ユーザーの「この作品での for ウズプロ アクセス可否」を取得する hook
 *
 * GET /api/oas/{oaId}/works/{workId}/uzu-pro/access から、**現在ユーザー本人**の
 * boolean だけを取得する（他ユーザーの Grant / プレイヤー情報は一切含まれない）。
 *   - access:      この作品で for ウズプロ を開けるか（= workEnabled ∧ granted ∧ member を server が算出）
 *   - workEnabled: この作品で for ウズプロ が有効化されているか
 *   - granted:     自分が UzuProGrant（利用権限）を保有するか（platform owner は true）
 *   - member:      この workspace のメンバーか
 *   - canManage:   自分が有効/無効トグルを操作できるか（owner / platform owner）
 *
 * サイドバー「FOR ウズプロ」の表示は access（server が 3 条件を算出）でのみ判定する。
 * 実際の認可は常に server 側ガードが担保する（これは UI 表示用）。
 *
 * @example
 * const { access, workEnabled, granted, member, canManage, loading, refetch } =
 *   useUzuProWorkAccess(oaId, workId);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { createTtlCache } from "@/lib/client-cache";

type AccessResponse = {
  success: boolean;
  data?: {
    access:     boolean;
    workEnabled: boolean;
    granted:    boolean;
    member:     boolean;
    canManage:  boolean;
  };
};

/** access endpoint の data 部。stale-while-revalidate cache に格納する。 */
type AccessData = NonNullable<AccessResponse["data"]>;

// oaId+workId ごとの access 情報を 45s 共有する（useWorkspaceRole と同じ短 TTL パターン）。
// 遷移をまたいだ即時描画と重複 fetch 抑制のため。常に裏で revalidate し、認可は server が毎回判定する。
const ACCESS_TTL_MS = 45_000;
const accessCache = createTtlCache<AccessData>(ACCESS_TTL_MS);

const ALL_FALSE: AccessData = {
  access:      false,
  workEnabled: false,
  granted:     false,
  member:      false,
  canManage:   false,
};

export interface UzuProWorkAccessState {
  /** この作品で for ウズプロ を開けるか（server が workEnabled ∧ granted ∧ member を算出） */
  access:      boolean;
  /** この作品で for ウズプロ が有効化されているか */
  workEnabled: boolean;
  /** 自分が利用権限グラント（UzuProGrant）を保有するか */
  granted:     boolean;
  /** この workspace のメンバーか */
  member:      boolean;
  /** 自分が有効/無効トグルを操作できるか（owner / platform owner） */
  canManage:   boolean;
  loading:     boolean;
  /** 明示的に再取得する（トグル更新後などに使う。cache を無視して fetch し直す）。 */
  refetch:     () => void;
}

export function useUzuProWorkAccess(oaId: string, workId: string): UzuProWorkAccessState {
  const [data,    setData]    = useState<AccessData>(ALL_FALSE);
  const [loading, setLoading] = useState(true);
  // 再取得トリガー（refetch で increment し、effect を再実行させる）。
  const [reloadKey, setReloadKey] = useState(0);

  // mount フラグ。fetch 完了時点で unmount されていれば setState を抑止する。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!oaId || !workId) {
      setData(ALL_FALSE);
      setLoading(false);
      return;
    }

    const cacheKey = `${oaId}::${workId}`;
    // この effect 実行時点の key を closure で固定。fetch 完了までに oaId/workId が
    // 変わったら、その結果は捨てる（古い state を新しい key に書き込まない）。
    const requestedOa = oaId;
    const requestedWork = workId;
    let cancelled = false;

    // refetch（reloadKey 変化）時は cache を無視して必ず fetch し直す。
    const forced = reloadKey > 0;
    const cached = forced ? null : accessCache.get(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetch(`/api/oas/${requestedOa}/works/${requestedWork}/uzu-pro/access`, {
      headers: { ...getAuthHeaders() },
      cache:   "no-store",
    })
      .then((res) => (res.ok ? (res.json() as Promise<AccessResponse>) : null))
      .then((json) => {
        const next = json?.success && json.data ? json.data : ALL_FALSE;
        // 取得成功時のみ cache を更新（unmount/別作品への遷移後でも cache は埋めてよい）。
        if (json?.success && json.data) accessCache.set(cacheKey, json.data);
        if (cancelled || !mountedRef.current) return;
        if (oaId !== requestedOa || workId !== requestedWork) return;
        setData(next);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        if (oaId !== requestedOa || workId !== requestedWork) return;
        setData(ALL_FALSE);
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        if (oaId !== requestedOa || workId !== requestedWork) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [oaId, workId, reloadKey]);

  return {
    access:      data.access,
    workEnabled: data.workEnabled,
    granted:     data.granted,
    member:      data.member,
    canManage:   data.canManage,
    loading,
    refetch,
  };
}
