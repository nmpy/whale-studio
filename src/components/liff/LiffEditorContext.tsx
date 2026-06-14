"use client";

// src/components/liff/LiffEditorContext.tsx
//
// LIFF ページ編集画面の配下コンポーネント（ブロック設定フォーム等）に、
// 遷移先ピッカー用の参照データ（同一作品の LIFF ページ一覧 / ロケーション一覧）を供給する Context。
// ButtonLinkForm から useLiffEditorData() で参照する。Provider が無い文脈では null を返し、
// 呼び出し側は「外部URLのみ」にフォールバックする（後方互換・他画面流用時に壊さない）。

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { liffConfigApi, locationApi, getDevToken } from "@/lib/api-client";

export interface LiffPageOption {
  id:        string;
  public_id: string | null;
  title:     string | null;
  page_type: string;
}
export interface LocationOption {
  id:           string;
  public_id:    string | null;
  name:         string;
  checkin_mode: string | null;
}
export interface LiffEditorData {
  oaId:         string;
  workId:       string;
  pageId:       string;
  workPublicId: string | null;
  /** 同一作品の LIFF ページ（自ページ除外）。 */
  pages:        LiffPageOption[];
  /** 同一作品のロケーション。 */
  locations:    LocationOption[];
  /** 取得完了フラグ（削除済み参照の判定に使う：未完了中は「見つからない」と断定しない）。 */
  loaded:       boolean;
}

const Ctx = createContext<LiffEditorData | null>(null);

/** Provider 配下でのみ非 null。無い場合は呼び出し側で外部URLのみにフォールバックする。 */
export function useLiffEditorData(): LiffEditorData | null {
  return useContext(Ctx);
}

export function LiffEditorProvider({
  oaId, workId, pageId, workPublicId, children,
}: {
  oaId:         string;
  workId:       string;
  pageId:       string;
  workPublicId?: string | null;
  children:     ReactNode;
}) {
  const [pages, setPages] = useState<LiffPageOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = getDevToken();
    (async () => {
      const [pageList, locList] = await Promise.all([
        liffConfigApi.listPages(token, workId).then((r) => r.pages).catch(() => []),
        locationApi.list(token, workId).catch(() => []),
      ]);
      if (cancelled) return;
      setPages(
        pageList
          .filter((p) => p.id !== pageId)
          .map((p) => ({ id: p.id, public_id: p.public_id ?? null, title: p.title, page_type: p.page_type })),
      );
      setLocations(
        (locList as Array<{ id: string; public_id?: string | null; name: string; checkin_mode?: string | null }>).map((l) => ({
          id: l.id, public_id: l.public_id ?? null, name: l.name, checkin_mode: l.checkin_mode ?? null,
        })),
      );
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [oaId, workId, pageId]);

  return (
    <Ctx.Provider value={{ oaId, workId, pageId, workPublicId: workPublicId ?? null, pages, locations, loaded }}>
      {children}
    </Ctx.Provider>
  );
}
