/**
 * Ein Symbolsatz, ein Strich: Linien auf 24er Raster, Strich 1,75, runde Enden, Farbe aus currentColor.
 * Größen 16, 20 (Standard) und 24. Zeichen im Text (Haken, Kreuz, Punkte, Pfeile, Wellen, Griff, Dreiecke) kommen nicht vor, sondern stehen hier:
 * check, x, more, arrow-right, arrow-up, arrow-down, approx, grip, caret-right, caret-down, dot.
 */

import type { JSX } from "preact";

/** Gefüllte Formen (kein Strich): Wiedergabe, Pfeilspitzen, Punkte */
const FILL = { fill: "currentColor", stroke: "none" } as const;

const ICONS = {
  // Medien und Wiedergabe
  play: <path d="M7 5v14l12-7z" {...FILL} />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" {...FILL} />,
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />,
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
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),

  // Orte, Karte, Spiel
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  route: (
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" />
    </>
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6" />,
  crosshair: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </>
  ),
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  building: (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),

  // Funk, Gerät, Verbindung
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
  signal: <path d="M5 18v-2M9 18v-5M13 18V9M17 18V5" />,
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.7 4.7 0 0 1 6.4 0" />
      <circle cx="12" cy="19.2" r="0.9" {...FILL} />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M9.5 5.4A14 14 0 0 1 21.5 9M5.5 12.5a9.5 9.5 0 0 1 3-2M14 10.2a9.5 9.5 0 0 1 4.5 2.3M8.8 16a4.7 4.7 0 0 1 6.4 0" />
      <circle cx="12" cy="19.2" r="0.9" {...FILL} />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10v4" />
    </>
  ),
  "battery-low": (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10v4M6.5 10.5v3" />
    </>
  ),
  nfc: <path d="M7 8a6 6 0 0 1 0 8M11 5.5a10 10 0 0 1 0 13M15 3a14 14 0 0 1 0 18" />,
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v1" />
    </>
  ),

  // Personen und Konto
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.6-1.8" />
    </>
  ),
  key: <path d="M10.5 13.5L20 4M16 8l3 3M13.5 10.5l2 2M8.5 11a4.5 4.5 0 1 0 4.5 4.5A4.5 4.5 0 0 0 8.5 11z" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />,
  "shield-check": (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  logout: <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9" />,

  // Status und Hinweise
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.7v.3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.9M12 16.8v.2" />
    </>
  ),
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" />,
  lightbulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z" />,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  approx: <path d="M4 9.5c2-2 4-2 6 0s4 2 6 0 3-1.5 4-.5M4 15.5c2-2 4-2 6 0s4 2 6 0 3-1.5 4-.5" />,
  dot: <circle cx="12" cy="12" r="4" {...FILL} />,
  "dot-empty": <circle cx="12" cy="12" r="3.6" />,

  // Richtungen und Auf-/Zuklappen
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-up": <path d="M6 15l6-6 6 6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "caret-down": <path d="M7 10h10l-5 6z" {...FILL} />,
  "caret-right": <path d="M10 7v10l6-5z" {...FILL} />,
  "arrow-up": <path d="M12 19V5M6 11l6-6 6 6" />,
  "arrow-down": <path d="M12 5v14M6 13l6 6 6-6" />,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M15 5l-7 7 7 7" />,
  sort: <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />,

  // Menüs und Griffe
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" {...FILL} />
      <circle cx="12" cy="12" r="1.5" {...FILL} />
      <circle cx="19" cy="12" r="1.5" {...FILL} />
    </>
  ),
  "more-vertical": (
    <>
      <circle cx="12" cy="5" r="1.5" {...FILL} />
      <circle cx="12" cy="12" r="1.5" {...FILL} />
      <circle cx="12" cy="19" r="1.5" {...FILL} />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.5" {...FILL} />
      <circle cx="15" cy="6" r="1.5" {...FILL} />
      <circle cx="9" cy="12" r="1.5" {...FILL} />
      <circle cx="15" cy="12" r="1.5" {...FILL} />
      <circle cx="9" cy="18" r="1.5" {...FILL} />
      <circle cx="15" cy="18" r="1.5" {...FILL} />
    </>
  ),

  // Aktionen
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </>
  ),
  save: <path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v5h7V4M8 20v-6h8v6" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-4" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h4" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  "external-link": <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />,
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.4 7C3.7 8.8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),

  // Dinge
  log: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5" />,
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="9" y="2.5" width="6" height="4" rx="1" />
      <path d="M9 11.5h6M9 15.5h4" />
    </>
  ),
  book: <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" />,
  tag: (
    <>
      <path d="M3 12V4h8l9.5 9.5a1.4 1.4 0 0 1 0 2L15.5 20.5a1.4 1.4 0 0 1-2 0z" />
      <circle cx="7.5" cy="8.5" r="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  gear: (
    <>
      <path d="M10.5 5.2L10.7 2.4h2.6l.2 2.8A7 7 0 0 1 15.8 6.1l2-1.8 1.9 1.9-1.8 2A7 7 0 0 1 18.8 10.5l2.8.2v2.6l-2.8.2A7 7 0 0 1 17.9 15.8l1.8 2-1.9 1.9-2-1.8A7 7 0 0 1 13.5 18.8l-.2 2.8h-2.6l-.2-2.8A7 7 0 0 1 8.2 17.9l-2 1.8-1.9-1.9 1.8-2A7 7 0 0 1 5.2 13.5l-2.8-.2v-2.6l2.8-.2A7 7 0 0 1 6.1 8.2l-1.8-2 1.9-1.9 2 1.8A7 7 0 0 1 10.5 5.2z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof ICONS;

/** Alle Namen, z. B. für die Entwurfsseite und Tests */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function hasIcon(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export type IconSize = 16 | 20 | 24;

/** Strich in Einheiten des 24er Rasters: bei 16 px etwas kräftiger, damit er nicht verhungert. */
export function strokeWidth(size: number): number {
  return size <= 16 ? 2 : 1.75;
}

export function Icon({ name, label, size = 20, class: cls }: { name: IconName; label?: string; size?: IconSize | number; class?: string }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : "icon"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth(size)}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * Laternen-Signet: abgerundetes Gehäuse mit Griff und gefüllter Flamme. Mindestgröße 20 px.
 * Mit `mono` ganz in currentColor (Druck, Favicon), sonst Flamme in Amber.
 */
export function Lantern({ mono = false, size }: { mono?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" class="lantern">
      <path d="M9.5 6.3V4.9a2.5 2.5 0 0 1 5 0v1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M6.3 8.6 8.1 6h7.8l1.8 2.6z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M8 8.8v9.6h8V8.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
      <path d="M12 10.5c2 2.1 2.8 3.6 2.8 4.8a2.8 2.8 0 0 1-5.6 0c0-1.2.8-2.7 2.8-4.8z" fill={mono ? "currentColor" : "var(--accent)"} />
      <path d="M6 20.8h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  );
}
