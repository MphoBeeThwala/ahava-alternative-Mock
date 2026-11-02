// Ahava mark: an "A" whose crossbar is a heartbeat line.
//
// tone="light" is for light backgrounds (green A, coral pulse);
// tone="dark" is for dark or green backgrounds (cream A, coral pulse).
// The same artwork is in src/app/icon.svg (favicon) and public/icons.

export const BRAND = {
  green: "#0F5D4E",
  deep: "#0B3B31",
  coral: "#E8704A",
  cream: "#FBF7F0",
} as const;

type Tone = "light" | "dark";

export function LogoMark({
  size = 32,
  tone = "light",
  label,
  className,
}: {
  size?: number;
  tone?: Tone;
  /** Accessible name. Omit when the mark sits next to the wordmark (decorative). */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M8 42 L24 6 L40 42"
        stroke={tone === "dark" ? BRAND.cream : BRAND.green}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 31 H20 L23 24 L27 37 L30 31 H33.5"
        stroke={BRAND.coral}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus the "Ahava" wordmark (serif) and, optionally, "healthcare". */
export function Logo({
  size = 32,
  tone = "light",
  tagline = true,
  href,
}: {
  size?: number;
  tone?: Tone;
  tagline?: boolean;
  href?: string;
}) {
  const ink = tone === "dark" ? BRAND.cream : BRAND.deep;
  const soft = tone === "dark" ? "rgba(251,247,240,0.65)" : "#6B6459";
  const content = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <LogoMark size={size} tone={tone} />
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1 }}>
        <span
          style={{
            fontFamily: "var(--font-serif, Georgia, serif)",
            fontWeight: 600,
            fontSize: Math.round(size * 0.85),
            color: ink,
            letterSpacing: "-0.01em",
          }}
        >
          Ahava
        </span>
        {tagline && (
          <span
            style={{
              fontSize: Math.max(9, Math.round(size * 0.3)),
              letterSpacing: "0.14em",
              color: soft,
              marginTop: 3,
            }}
          >
            healthcare
          </span>
        )}
      </span>
    </span>
  );
  return href ? (
    <a href={href} aria-label="Ahava Healthcare home" style={{ textDecoration: "none" }}>
      {content}
    </a>
  ) : (
    content
  );
}
