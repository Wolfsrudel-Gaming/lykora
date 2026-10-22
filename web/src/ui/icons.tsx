/** Schlichte Linien-Symbole, 24er Raster, Strichstärke 2. Farbe kommt aus currentColor. */

import type { JSX } from "preact";

const paths: Record<string, JSX.Element> = {
  play: <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  radio: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M8 9l9-5" />
      <circle cx="9" cy="14.5" r="2" />
      <path d="M14 13h3M14 16h3" />
    </>
  ),
  send: <path d="M4 12l16-8-6 16-3-6z M11 14l9-10" />,
  sound: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  log: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6" />,
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </>
  ),
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />,
  signal: <path d="M5 18v-2M9 18v-5M13 18V9M17 18V5" />,
  route: (
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" />
    </>
  ),
  gear: (
    <>
      <path d="M10.5 5.2L10.7 2.4h2.6l.2 2.8A7 7 0 0 1 15.8 6.1l2-1.8 1.9 1.9-1.8 2A7 7 0 0 1 18.8 10.5l2.8.2v2.6l-2.8.2A7 7 0 0 1 17.9 15.8l1.8 2-1.9 1.9-2-1.8A7 7 0 0 1 13.5 18.8l-.2 2.8h-2.6l-.2-2.8A7 7 0 0 1 8.2 17.9l-2 1.8-1.9-1.9 1.8-2A7 7 0 0 1 5.2 13.5l-2.8-.2v-2.6l2.8-.2A7 7 0 0 1 6.1 8.2l-1.8-2 1.9-1.9 2 1.8A7 7 0 0 1 10.5 5.2z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, label, size }: { name: IconName; label?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 18}
      height={size ?? 18}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

/** Laternen-Signet der Wortmarke */
export function Lantern() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M24 10h16l-2 6H26z" fill="var(--edge)" />
      <path d="M22 18h20v26a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z" fill="none" stroke="var(--text)" stroke-width="3" />
      <path d="M32 24c4 5 4 9 0 14-4-5-4-9 0-14z" fill="var(--accent)" />
      <path d="M28 48v5h8v-5" fill="none" stroke="var(--text)" stroke-width="3" />
    </svg>
  );
}
