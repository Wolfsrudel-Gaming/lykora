/**
 * localStorage mit Schutz: In privaten Fenstern oder bei gesperrten Website-Daten wirft der
 * Zugriff. Dann merkt sich das Dashboard eben nichts, funktioniert aber weiter.
 */

const PREFIX = "lykora.";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Nicht speicherbar; die Sitzung gilt dann nur bis zum Neuladen.
  }
}
