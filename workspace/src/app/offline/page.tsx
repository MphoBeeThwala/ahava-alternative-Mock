// Shown by the service worker (public/sw.js) when a page navigation can't
// reach the network. Deliberately static — no auth check, no data fetch —
// since by definition there is no network to fetch anything from.
export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0a1628",
        color: "rgba(255,255,255,0.85)",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#93c5fd", marginBottom: 12 }}>
          You&apos;re offline
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
          Can&apos;t reach Ahava right now
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
          Check your connection and try again. Nothing you&apos;ve entered on this device has been lost.
        </p>
      </div>
    </div>
  );
}
