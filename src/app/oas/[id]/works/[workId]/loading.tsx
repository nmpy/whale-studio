// src/app/oas/[id]/works/[workId]/loading.tsx
// perf: 作品ハブの初回 fetch 中の skeleton。

export default function Loading() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      <div className="skeleton" style={{ width: 280, height: 28, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 360, height: 14, marginBottom: 24 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <div className="skeleton" style={{ width: "50%", height: 14, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: "85%", height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
