import { describe, expect, it } from "vitest";
import * as server from "../../server/src/lib/roles.ts";
import { can, PERMISSIONS, ROLE_HINTS, ROLE_LABELS, ROLES } from "../src/lib/roles.ts";

describe("Rechte", () => {
  it("kennt dieselben Rollen wie der Server", () => {
    expect([...ROLES]).toEqual([...server.ROLES]);
  });

  it("entscheidet für jede Rolle und jedes Recht wie der Server", () => {
    const permissions = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];
    for (const role of ROLES) {
      for (const p of permissions) expect(can(role, p), `${role} / ${p}`).toBe(server.can(role, p as server.Permission));
    }
  });

  it("lehnt ohne Rolle alles ab", () => {
    expect(can(undefined, "event.read")).toBe(false);
    expect(can(null, "game.read")).toBe(false);
  });

  it("lässt Betreuer prüfen und funken, aber nicht eingreifen", () => {
    expect(can("supervisor", "event.review")).toBe(true);
    expect(can("supervisor", "event.message")).toBe(true);
    expect(can("supervisor", "event.intervene")).toBe(false);
    expect(can("supervisor", "event.manage")).toBe(false);
  });

  it("hat für jede Rolle eine deutsche Bezeichnung und Erklärung", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_HINTS[role]).toBeTruthy();
    }
  });
});
