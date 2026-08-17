interface HeaderProps {
  pageTitle: string;
  pageSub: string;
}

export default function Header({ pageTitle, pageSub }: HeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 32px",
        borderBottom: "1px solid oklch(0.91 0.008 120)",
        background: "oklch(0.99 0.004 95)",
        position: "sticky",
        top: 0,
        zIndex: 2,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 21, fontWeight: 650, letterSpacing: "-0.025em" }}>{pageTitle}</h1>
      <span style={{ fontSize: 13, color: "oklch(0.57 0.01 150)" }}>{pageSub}</span>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 12, color: "oklch(0.58 0.01 150)" }}>
        Mon 17 Aug · 9:41
      </span>
      <button
        className="ghost-btn"
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          padding: "9px 14px",
          borderRadius: 12,
          border: "1px solid oklch(0.9 0.008 120)",
          background: "oklch(1 0 0)",
          color: "oklch(0.3 0.012 150)",
        }}
      >
        Send a broadcast
      </button>
    </div>
  );
}
