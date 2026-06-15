import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f3ef",
        fontFamily: "inherit",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 520, padding: "0 24px" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>404</div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: "#1c1917",
            marginBottom: 10,
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "#57534e",
            lineHeight: 1.65,
            marginBottom: 32,
          }}
        >
          The page you’re looking for doesn’t exist or has moved.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            background: "linear-gradient(135deg,#0d9488,#059669)",
            color: "white",
            borderRadius: 10,
            padding: "12px 28px",
            fontSize: 15,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "0 4px 14px rgba(13,148,136,0.35)",
          }}
        >
          Go home →
        </Link>
      </div>
    </div>
  );
}
