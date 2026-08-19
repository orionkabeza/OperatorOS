import type { StubSection } from "@/lib/types";

interface StubViewProps {
  stub: StubSection;
}

export default function StubView({ stub }: StubViewProps) {
  return (
    <div style={{ padding: "26px 32px 40px", maxWidth: 900 }}>
      <div style={{ fontSize: 13.5, color: "oklch(0.56 0.01 150)" }}>{stub.sub}</div>
      <div
        style={{
          marginTop: 16,
          background: "oklch(1 0 0)",
          border: "1px solid oklch(0.91 0.008 120)",
          borderRadius: 20,
          overflow: "hidden",
        }}
      >
        {stub.rows.map((r, i) => (
          <div
            key={i}
            style={{
              padding: "15px 18px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderTop: "1px solid oklch(0.94 0.006 120)",
            }}
          >
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{r.a}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "oklch(0.57 0.01 150)", marginTop: 2 }}>
                {r.b}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 14, fontWeight: 550, color: r.tone }}>
              {r.c}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
