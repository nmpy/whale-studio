// src/app/oas/[id]/works/loading.tsx
// perf: 作品一覧 page (= use client) の親 Server fetch 中の skeleton。

export default function Loading() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 320, height: 14, marginBottom: 20 }} />
      <div style={{ display: "grid", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 12,
              padding: 18,
              background: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div className="skeleton" style={{ width: 56, height: 24, borderRadius: 12 }} />
              <div className="skeleton" style={{ flex: 1, height: 18 }} />
              <div className="skeleton" style={{ width: 72, height: 30, borderRadius: 6 }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[80, 70, 90, 90].map((w, j) => (
                <div key={j} className="skeleton" style={{ width: w, height: 24, borderRadius: 12 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
