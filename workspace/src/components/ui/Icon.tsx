// Single-file stroke icon set, 24x24 grid, replacing emoji across the app.
// Emoji render inconsistently per OS, can't take currentColor, and are
// announced by screen readers as things like "medical symbol" — a real
// accessibility problem, not just a visual one.
//
// Colour comes from the parent's `color` (via currentColor) — never
// hardcode a stroke colour here. Pass `label` for a meaningful icon,
// omit it for a purely decorative one (renders aria-hidden).

export type IconName =
  | "home"
  | "heart"
  | "calendar"
  | "stethoscope"
  | "watch"
  | "user"
  | "lock"
  | "bell"
  | "search"
  | "chevron-right"
  | "plus"
  | "check"
  | "alert-triangle"
  | "alert-square"
  | "check-circle"
  | "phone"
  | "clock"
  | "pulse"
  | "mic"
  | "save"
  | "signal-off"
  | "menu"
  | "close"
  // additions beyond the original spec, needed by DashboardLayout/existing screens
  | "log-out"
  | "mail"
  | "building";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible label. Omit for purely decorative icons (renders aria-hidden). */
  label?: string;
}

const paths: Record<IconName, React.ReactNode> = {
  home: (
    <path d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" />
  ),
  heart: (
    <path d="M12 20.5s-7.5-4.6-10-9.3C.5 8 2 4.5 5.5 4c2-.3 3.7.6 6.5 3.2C14.8 4.6 16.5 3.7 18.5 4c3.5.5 5 4 3.5 7.2-2.5 4.7-10 9.3-10 9.3Z" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  stethoscope: (
    <path d="M6 4v6a4 4 0 0 0 8 0V4M6 4H4.5M14 4h1.5M10 14v2a5 5 0 0 0 10 0v-1.5M20 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
  ),
  watch: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 7V4.5h6V7M9 17v2.5h6V17M12 10v2.3l1.5 1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  bell: (
    <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 13.5 6 9ZM10 19a2 2 0 0 0 4 0" />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m20 20-4.8-4.8" />
    </>
  ),
  "chevron-right": <path d="m9.5 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  "alert-triangle": (
    <path d="M10.4 4.3 2 19h20L13.6 4.3a2 2 0 0 0-3.2 0ZM12 10v4M12 17.5v.1" />
  ),
  "alert-square": (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 8v5M12 16.5v.1" />
    </>
  ),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.3 2.6 2.6 4.8-5.8" />
    </>
  ),
  phone: (
    <path d="M5.5 4h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2 4.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 4 5.6 1.5 1.5 0 0 1 5.5 4Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  pulse: <path d="M2 12h4l2-7 4 14 2-7h8" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5Z" />
      <path d="M8 4v5h7V4M8 14h8v6H8Z" />
    </>
  ),
  "signal-off": (
    <path d="M3 3l18 18M8.5 15.5A6 6 0 0 1 10.5 14M5.3 12.3A10 10 0 0 1 8 10.4M18.5 15.5a6 6 0 0 0-1.6-4.3M21 12a10 10 0 0 0-2.7-3.5M12 19.5v.1" />
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  "log-out": (
    <path d="M9 4H5.5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5.5 20H9M15.5 16l4-4-4-4M8.5 12h11" />
  ),
  mail: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m4.5 6.5 7.5 6 7.5-6" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="11" height="18" rx="1" />
      <path d="M8 7h3M8 11h3M8 15h3M15 10h5v11h-5" />
    </>
  ),
};

export function Icon({ name, size = 20, className, label }: IconProps) {
  const accessibleProps = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true, focusable: false };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...accessibleProps}
    >
      {paths[name]}
    </svg>
  );
}
