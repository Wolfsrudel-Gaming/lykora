import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatBattery,
  formatBytes,
  formatClock,
  formatDateTime,
  formatDuration,
  formatSigned,
  formatSpan,
  fromLocalInput,
  kebabId,
  slugify,
  text,
  toLocalInput,
  uniqueId,
} from "../src/lib/format.ts";

describe("Formatierung", () => {
  it("wählt die Sprache eines Textes", () => {
    expect(text("Hallo")).toBe("Hallo");
    expect(text({ de: "Hallo", en: "Hello" }, "en")).toBe("Hello");
    expect(text({ en: "Hello" }, "de")).toBe("Hello");
    expect(text(undefined)).toBe("");
  });

  it("zeigt Dauern als Uhr", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(2700)).toBe("45:00");
    expect(formatDuration(3903)).toBe("1:05:03");
    expect(formatDuration(-200)).toBe("−3:20");
    expect(formatDuration(59.9)).toBe("0:59");
  });

  it("zeigt Dauern in Worten", () => {
    expect(formatSpan(30)).toBe("30 s");
    expect(formatSpan(300)).toBe("5 Min");
    expect(formatSpan(3600)).toBe("1 Std");
    expect(formatSpan(7800)).toBe("2 Std 10 Min");
  });

  it("zeigt Abstände zu jetzt", () => {
    const now = Date.parse("2026-10-21T20:00:00Z");
    expect(formatAgo(null, now)).toBe("nie");
    expect(formatAgo("2026-10-21T19:59:40Z", now)).toBe("gerade eben");
    expect(formatAgo("2026-10-21T19:57:00Z", now)).toBe("vor 3 Min");
    expect(formatAgo("2026-10-21T18:00:00Z", now)).toBe("vor 2 Std");
    expect(formatAgo("2026-10-20T08:00:00Z", now)).toBe("vor 1 Tag");
    expect(formatAgo("2026-10-18T20:00:00Z", now)).toBe("vor 3 Tagen");
  });

  it("zeigt Uhrzeit und Datum in lokaler Zeit", () => {
    const d = new Date(2026, 9, 19, 20, 5);
    expect(formatClock(d)).toBe("20:05");
    expect(formatDateTime(d)).toBe("19.10.2026, 20:05 Uhr");
    expect(formatDateTime(null)).toBe("–");
  });

  it("zeigt Akku, Größen und Vorzeichen", () => {
    expect(formatBattery(0.426)).toBe("43 %");
    expect(formatBattery(null)).toBe("–");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3,5 MB");
    expect(formatSigned(50)).toBe("+50");
    expect(formatSigned(-20)).toBe("−20");
    expect(formatSigned(0)).toBe("0");
  });

  it("rechnet datetime-local hin und zurück", () => {
    const iso = new Date(2027, 9, 19, 19, 30).toISOString();
    expect(toLocalInput(iso)).toBe("2027-10-19T19:30");
    expect(fromLocalInput("2027-10-19T19:30")).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("macht aus Dateinamen gültige IDs", () => {
    expect(kebabId("Wald bei Nacht.mp3")).toBe("wald-bei-nacht");
    expect(kebabId("Tür knarzt (2).WAV")).toBe("tuer-knarzt-2");
    expect(kebabId("Größe_Straße.ogg")).toBe("groesse-strasse");
    expect(kebabId("Café Noël.m4a")).toBe("cafe-noel");
    expect(kebabId("---.mp3")).toBe("medium");
    expect(kebabId("a".repeat(80) + ".mp3")).toHaveLength(64);
    for (const name of ["Eule!.mp3", "  Funk  Knacken .ogg", "123.wav"]) expect(kebabId(name)).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
  });

  it("hängt bei belegten IDs eine Nummer an", () => {
    expect(uniqueId("eule", [])).toBe("eule");
    expect(uniqueId("eule", ["eule"])).toBe("eule-2");
    expect(uniqueId("eule", ["eule", "eule-2"])).toBe("eule-3");
    expect(uniqueId("x".repeat(64), ["x".repeat(64)])).toHaveLength(64);
  });

  it("macht Kürzel für Organisationen", () => {
    expect(slugify("Jugendfeuerwehr Hennef")).toBe("jugendfeuerwehr-hennef");
    expect(slugify("Pfadfinder Süd")).toBe("pfadfinder-sued");
  });
});
