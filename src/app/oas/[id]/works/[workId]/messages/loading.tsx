// src/app/oas/[id]/works/[workId]/messages/loading.tsx
// perf: メッセージ一覧の初回 fetch 中の skeleton。

export default function Loading() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      <div className="skeleton" style={{ width: 240, height: 28, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 320, height: 14, marginBottom: 20 }} />
      <div style={{ display: "grid", gap: 8 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 10,
              padding: 12,
              background: "#fff",
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: "55%", height: 14, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: "85%", height: 11 }} />
            </div>
            <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 11 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
