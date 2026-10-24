import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hqName, incomingTone, parseCue, senderLabel, senderOptions, thread, unreadByTeam } from "../src/lib/messages.ts";
import type { Game, Message } from "../src/lib/types.ts";

const testspiel = JSON.parse(readFileSync(new URL("../../spec/v0.1/examples/testspiel.json", import.meta.url), "utf8")) as Game;

const msg = (id: number, team_id: string | null, direction: Message["direction"], body = "x", kind: Message["kind"] = "chat"): Message => ({
  id,
  team_id,
  team_name: team_id ? `Team ${team_id}` : null,
  direction,
  kind,
  sender: null,
  body,
  created_at: "2027-10-19T19:00:00Z",
  read_at: null,
  user_name: null,
});

describe("Funk", () => {
  it("liest Cues", () => {
    expect(parseCue('{"audio":"eule","src":"media/lib/eule.ogg","volume":0.8,"text":"Hört ihr das?"}')).toEqual({
      audio: "eule",
      src: "media/lib/eule.ogg",
      volume: 0.8,
      text: "Hört ihr das?",
    });
    expect(parseCue("kein JSON")).toBeNull();
    expect(parseCue('{"volume":1}')).toBeNull();
  });

  it("zeigt Absender wie die App", () => {
    expect(hqName(testspiel)).toBe("Zentrale Nachtfalke");
    expect(hqName(null)).toBe("Zentrale");
    expect(senderLabel(null, testspiel)).toBe("Zentrale Nachtfalke");
    expect(senderLabel("hq", testspiel)).toBe("Zentrale Nachtfalke");
    expect(senderLabel("brandt", testspiel)).toBe("Försterin Brandt");
    expect(senderLabel("narrator", testspiel)).toBe("Erzähler");
    expect(senderLabel("Unbekannt", testspiel)).toBe("Unbekannt");
  });

  it("bietet Zentrale und Figuren als Absender an", () => {
    expect(senderOptions(testspiel)).toEqual([
      { value: "hq", label: "Zentrale Nachtfalke" },
      { value: "brandt", label: "Försterin Brandt" },
      { value: "erzaehler", label: "Erzähler" },
    ]);
    expect(senderOptions(null)).toEqual([{ value: "hq", label: "Zentrale" }]);
  });

  it("hebt Schnellmeldungen der App hervor", () => {
    expect(incomingTone({ direction: "from_team", body: "Uns ist mulmig." })).toBe("uneasy");
    expect(incomingTone({ direction: "from_team", body: "Station kaputt? Wir kommen bei „Der alte Baum“ nicht weiter." })).toBe("broken");
    expect(incomingTone({ direction: "from_team", body: "Wir sind unterwegs zum Sammelpunkt." })).toBe("returning");
    expect(incomingTone({ direction: "from_team", body: "Hallo" })).toBe("normal");
    expect(incomingTone({ direction: "to_team", body: "mulmig" })).toBe("normal");
  });

  it("filtert Verläufe und zählt Ungelesenes", () => {
    const list = [msg(1, "a", "from_team"), msg(2, null, "to_team"), msg(3, "b", "from_team"), msg(4, "a", "to_team"), msg(5, "a", "from_team")];
    expect(thread(list, "a").map((m) => m.id)).toEqual([1, 2, 4, 5]);
    expect(thread(list, null).map((m) => m.id)).toEqual([2]);
    expect(unreadByTeam(list, {})).toEqual({ a: 2, b: 1 });
    expect(unreadByTeam(list, { a: 1 })).toEqual({ a: 1, b: 1 });
    expect(unreadByTeam(list, { a: 5, b: 3 })).toEqual({});
  });
});
