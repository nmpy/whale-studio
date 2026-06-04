// src/app/oas/[id]/loading.tsx
// perf: OA 詳細の初回 Server fetch 中の skeleton。

export default function Loading() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <div className="skeleton" style={{ width: 240, height: 28, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: 320, height: 14, marginBottom: 24 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <div className="skeleton" style={{ width: "60%", height: 16, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: "90%", height: 12, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "70%", height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
