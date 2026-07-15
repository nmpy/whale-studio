"use client";

// src/app/oas/[id]/locations/print/page.tsx
// OA レベルの QR 一括印刷。?workId= で対象作品を指定（QR / タイトルは作品スコープのため作品指定前提）。
// QR 生成（buildLiffCheckinUrl）/ LIFF URL は既存のまま一切変更しない。

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { locationApi, workApi, getDevToken, fetchOaLiffId } from "@/lib/api-client";
import { buildLiffCheckinUrl } from "@/lib/liff/config";
import type { LocationWithTransition } from "@/types";
import { withWorkId } from "../../_lib/work-context";

export default function OaLocationsPrintPage() {
  const params = useParams();
  const router = useRouter();
  const oaId = params.id as string;
  const workId = useSearchParams().get("workId") ?? "";

  const [works, setWorks] = useState<{ id: string; title: string }[]>([]);
  const [locations, setLocations] = useState<LocationWithTransition[]>([]);
  const [workTitle, setWorkTitle] = useState("");
  const [liffId, setLiffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchOaLiffId(oaId).then(setLiffId).catch(() => setLiffId(null)); }, [oaId]);
  useEffect(() => { workApi.list(getDevToken(), oaId).then((l) => setWorks(l.map((w) => ({ id: w.id, title: w.title })))).catch(() => {}); }, [oaId]);

  useEffect(() => {
    if (!workId) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const token = getDevToken();
        const [locs, work] = await Promise.all([
          locationApi.list(token, workId, { is_active: true }),
          workApi.get(token, workId),
        ]);
        setLocations(locs);
        setWorkTitle(work.title);
      } catch (err) {
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [workId]);

  // 作品未指定: 作品セレクタ
  if (!workId) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <BreadcrumbLike oaId={oaId} workId={workId} />
        <h1 className="mb-3 font-round text-[20px] font-extrabold text-ink">QR 一括印刷</h1>
        <p className="mb-3 text-[12px] text-ink-3">印刷する作品を選択してください（QR は作品ごとに発行されます）。</p>
        <select
          className="w-full rounded-field border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand"
          defaultValue=""
          onChange={(e) => { if (e.target.value) router.push(`/oas/${oaId}/locations/print?workId=${e.target.value}`); }}
        >
          <option value="">選択してください</option>
          {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </div>
    );
  }

  if (!liffId) {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "40px 16px", textAlign: "center" }}>
        <div style={{ padding: 24, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, color: "#92400e", fontSize: 14 }}>
          このOAの LIFF ID が未設定のため印刷用 QR を生成できません。<br />
          <Link href={`/oas/${oaId}/account`} style={{ color: "#2563eb", textDecoration: "underline" }}>設定 → アカウント情報（LIFF設定）</Link> で LIFF ID を設定してください。
        </div>
        <Link href={withWorkId(`/oas/${oaId}/locations`, workId)} style={{ display: "inline-block", marginTop: 16, fontSize: 14, color: "#2563eb" }}>
          ← 現地トリガーへ戻る
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="print-hide" style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <Link href={withWorkId(`/oas/${oaId}/locations`, workId)} style={{ fontSize: 14, color: "#2563eb", textDecoration: "none" }}>← 戻る</Link>
          <button onClick={() => window.print()} style={{ padding: "8px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            印刷する
          </button>
        </div>
        {loading && <p style={{ textAlign: "center", color: "#6b7280" }}>読み込み中...</p>}
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      </div>

      {!loading && !error && locations.length > 0 && (
        <div className="print-area" style={{ maxWidth: 700, margin: "0 auto", padding: "0 16px" }}>
          <h1 className="print-only" style={{ display: "none", fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 24 }}>
            {workTitle} / チェックイン QR 一覧
          </h1>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {locations.map((loc) => {
              const url = buildLiffCheckinUrl({ liffId, workId, locationId: loc.id }) ?? "";
              return (
                <div key={loc.id} className="qr-card" style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: 20, textAlign: "center", pageBreakInside: "avoid", breakInside: "avoid" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 4 }}>{loc.name}</h3>
                  {loc.description && <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{loc.description}</p>}
                  <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
                    <QRCodeSVG value={url} size={140} level="M" />
                  </div>
                  <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>LINE で読み取り、チェックインしてください</p>
                  <p style={{ fontSize: 9, color: "#9ca3af", wordBreak: "break-all", lineHeight: 1.4 }}>{url}</p>
                  <p style={{ fontSize: 8, color: "#d1d5db", marginTop: 4 }}>ID: {loc.id.slice(0, 8)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && locations.length === 0 && (
        <div className="print-hide" style={{ maxWidth: 700, margin: "0 auto", padding: "40px 16px", textAlign: "center", color: "#6b7280" }}>
          有効なロケーションがありません
        </div>
      )}

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          .print-only { display: block !important; }
          .print-area { max-width: none; padding: 0; }
          .qr-card { border: 1px solid #ccc !important; box-shadow: none; }
          body { background: #fff; }
          header, footer { display: none !important; }
        }
      `}</style>
    </>
  );
}

function BreadcrumbLike({ oaId, workId }: { oaId: string; workId: string }) {
  return (
    <div className="mb-4 text-[12px] text-ink-3">
      <Link href="/oas" className="text-ink-3 underline">アカウントリスト</Link>
      <span className="mx-1">›</span>
      <Link href={withWorkId(`/oas/${oaId}/locations`, workId)} className="text-ink-3 underline">現地トリガー</Link>
      <span className="mx-1">›</span>
      <span className="text-ink">QR 印刷</span>
    </div>
  );
}
