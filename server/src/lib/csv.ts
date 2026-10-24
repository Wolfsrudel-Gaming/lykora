const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Schutz gegen Formel-Injektion in Tabellenprogrammen.
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV mit Semikolon und BOM, damit Excel in deutscher Einstellung es direkt öffnet. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
