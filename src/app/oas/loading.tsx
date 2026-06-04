// src/app/oas/loading.tsx
// perf: OA 一覧の初回 Server fetch 中に表示される skeleton。
// page.tsx は Client Component (= use client) だが、Server Component で
// 親 layout から API fetch 等が走る経路でもこの loading.tsx が掛かる。

export default function Loading() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: 320, height: 14, marginBottom: 24 }} />
      <div style={{ display: "grid", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 12,
              padding: 18,
              background: "#fff",
            }}
          >
            <div className="skeleton" style={{ width: "55%", height: 20, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: "80%", height: 12, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "40%", height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
