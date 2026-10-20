/* Automatisch erzeugt aus game.schema.json – nicht von Hand ändern. Neu erzeugen: npm run generate -w @lykora/spec */

/**
 * Stabile ID, eindeutig innerhalb des Spiels.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string;
/**
 * Text in einer Sprache oder als Übersetzungen je Sprachcode.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "text".
 */
export type Text =
  | string
  | {
      [k: string]: string;
    };
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "lang".
 */
export type Lang = string;
/**
 * Dauer in Sekunden.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "duration".
 */
export type Duration = number;
/**
 * Fläche als Polygon (mindestens 3 Punkte, nicht geschlossen) oder als Kreis.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "area".
 */
export type Area =
  | {
      /**
       * @minItems 3
       */
      polygon: Point[];
    }
  | {
      center: Point;
      /**
       * Radius in Metern.
       */
      radius: number;
    };
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "trigger".
 */
export type Trigger =
  | {
      type: "gps";
      /**
       * Radius in Metern; wächst bei schlechter GPS-Genauigkeit.
       */
      radius?: number;
      location?: Point;
    }
  | {
      type: "qr";
      code: string;
    }
  | {
      type: "nfc";
      /**
       * Inhalt oder UID des NFC-Tags.
       */
      tag: string;
    }
  | {
      type: "ble";
      uuid: string;
      major?: number;
      minor?: number;
      /**
       * Mindest-Signalstärke in dBm.
       */
      rssi?: number;
    }
  | {
      type: "manual";
      /**
       * Notfall-Code, den Spielleitung oder Betreuer durchgeben.
       */
      code: string;
    }
  | {
      type: "box";
      /**
       * Kennung der ESP32-Box.
       */
      box: string;
      /**
       * Ereignis der Box, das die Station auslöst.
       */
      event?: string;
    };
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "task".
 */
export type Task =
  | {
      type: "text";
      question: Text;
      /**
       * Alle richtigen Antworten.
       *
       * @minItems 1
       */
      answers: string[];
      match?: {
        ignoreCase?: boolean;
        ignoreWhitespace?: boolean;
        maxTypos?: number;
      };
      manualReview?: boolean;
      media?: Id[];
    }
  | {
      type: "code";
      question: Text;
      /**
       * Zahlen- oder Zeichencodes, exakt geprüft.
       *
       * @minItems 1
       */
      answers: string[];
      media?: Id[];
    }
  | {
      type: "choice";
      question: Text;
      /**
       * @minItems 2
       */
      options: {
        text: Text;
        correct: boolean;
      }[];
      shuffle?: boolean;
      media?: Id[];
    }
  | {
      type: "photo";
      prompt: Text;
      video?: boolean;
      review?: "live" | "auto_accept" | "after_game" | "vote";
    }
  | {
      type: "find_location";
      prompt: Text;
      location: Point;
      radius?: number;
    };
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "condition".
 */
export type Condition =
  | {
      station_solved: Id;
    }
  | {
      has_item: Id;
    }
  | {
      fragments_collected: number;
    }
  | {
      elapsed: Duration;
    }
  | {
      near: {
        location: Point;
        radius: number;
      };
    };
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "action".
 */
export type Action =
  | {
      reveal_station: Id;
    }
  | {
      give_item: Id;
    }
  | {
      add_points: number;
    }
  | {
      message: {
        from?: "hq" | "narrator" | "npc";
        text: Text;
      };
    }
  | {
      start_chapter: Id;
    };

/**
 * Ein Lykora-Spiel: Grundregeln, Spielfeld, Stationen, Aufgaben, Story und Sicherheit. Gemeinsamer Vertrag für Server, Web und App.
 */
export interface LykoraSpielformatV01 {
  $schema?: string;
  /**
   * Name und Version des Spielformats.
   */
  format: {
    name: "lykora-game";
    version: "0.1";
  };
  id: Id;
  meta: Meta;
  settings: Settings;
  field: Field;
  story?: Story;
  /**
   * Code-Fragmente. Jedes Fragment trägt seine Position im Finalcode; die Reihenfolge beim Sammeln ist egal.
   */
  fragments?: Fragment[];
  /**
   * Inventar-Gegenstände, die Teams sammeln können.
   */
  items?: Item[];
  /**
   * @minItems 1
   */
  stations: Station[];
  /**
   * Spiellogik als visuelle Blöcke: wenn – dann – sonst.
   */
  rules?: Rule[];
  safety: Safety;
  /**
   * Medien des Spiels. Werden vor dem Spiel aufs Gerät geladen.
   */
  media?: Media[];
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "meta".
 */
export interface Meta {
  title: Text;
  summary?: Text;
  authors?: string[];
  /**
   * Sprachen des Spiels; die erste ist die Standardsprache.
   *
   * @minItems 1
   */
  languages: Lang[];
  ageGroups?: ("6-9" | "10-13" | "14-17" | "adult")[];
  genre?: "crime" | "mystery" | "agents" | "rescue" | "other";
  /**
   * Grusel-Stufe von 0 (kein Grusel) bis 3.
   */
  scareLevel?: number;
  night?: boolean;
  expectedDuration?: Duration;
  /**
   * SPDX-Lizenz der Spielinhalte, z. B. CC-BY-SA-4.0.
   */
  license?: string;
}
/**
 * Grundregeln des Spiels. Alles ist einstellbar, die Standards sind sinnvoll gewählt.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "settings".
 */
export interface Settings {
  mode?: "competitive" | "time_trial" | "cooperative";
  winCondition?: "first_escape" | "most_points" | "all_fragments_in_time";
  time?: {
    limit?: "global" | "per_team" | "none";
    duration?: Duration;
  };
  teamSize?: {
    min?: number;
    max?: number;
  };
  wrongAnswer?: Penalty;
  hints?: {
    enabled?: boolean;
    /**
     * Kosten je Hinweisstufe, wenn die Station keine eigenen festlegt.
     */
    defaultCost?: Penalty[];
  };
  scoring?: {
    solvePoints?: number;
    /**
     * Schnelligkeitspunkte. Bei Nachtspielen standardmäßig aus.
     */
    speedBonus?: boolean;
    firstOnSiteBonus?: number;
    streakBonus?: number;
    tieBreak?: "fewer_hints" | "earlier_finish";
  };
  leaderboard?: "live" | "end_only" | "live_hidden_last_minutes";
  showOwnPosition?: boolean;
  map?: {
    style?: "standard" | "topo" | "treasure";
    /**
     * URL oder Media-ID eines PMTiles-Pakets.
     */
    tiles?: string;
  };
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "penalty".
 */
export interface Penalty {
  type: "none" | "time" | "points" | "lockout";
  /**
   * Sekunden bei time und lockout, Punkte bei points.
   */
  amount?: number;
}
/**
 * Spielfeld mit Grenze, Sperrzonen, Sammel- und Rettungspunkten.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "field".
 */
export interface Field {
  boundary: Area;
  start?: Point;
  assemblyPoint: NamedPoint;
  restrictedZones?: {
    id: Id;
    name?: Text;
    kind?: "road" | "water" | "slope" | "ditch" | "private" | "other";
    area: Area;
    /**
     * Warnung ab diesem Abstand in Metern.
     */
    warnDistance?: number;
    penalty?: Penalty;
    alertGameMaster?: boolean;
  }[];
  /**
   * Rettungspunkte und Zufahrten für den Rettungsdienst.
   */
  rescuePoints?: NamedPoint[];
  supplyPoints?: NamedPoint[];
}
/**
 * WGS84-Koordinate.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "point".
 */
export interface Point {
  lat: number;
  lon: number;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "namedPoint".
 */
export interface NamedPoint {
  id?: Id;
  name?: Text;
  description?: Text;
  location: Point;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "story".
 */
export interface Story {
  intro?: StoryPiece;
  outro?: StoryPiece;
  /**
   * Die „Zentrale“, die per Chat oder Funk spricht.
   */
  hq?: {
    name?: Text;
    avatar?: Id;
  };
  chapters?: {
    id: Id;
    title: Text;
    piece?: StoryPiece;
  }[];
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "storyPiece".
 */
export interface StoryPiece {
  text?: Text;
  /**
   * IDs aus media.
   */
  media?: Id[];
  speaker?: "narrator" | "hq" | "npc";
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "fragment".
 */
export interface Fragment {
  id: Id;
  /**
   * Position im Finalcode, ab 1.
   */
  position: number;
  value: string;
  label?: Text;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "item".
 */
export interface Item {
  id: Id;
  name: Text;
  description?: Text;
  icon?: Id;
  tradeable?: boolean;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "station".
 */
export interface Station {
  id: Id;
  name: Text;
  location?: Point;
  /**
   * visible: von Anfang an auf der Karte. hidden: erscheint erst über eine Regel oder durch die Spielleitung.
   */
  visibility?: "visible" | "hidden";
  /**
   * Versteckte Station erscheint bei Annäherung auf diesen Abstand in Metern.
   */
  revealRadius?: number;
  /**
   * Finale-Station: wird freigeschaltet, wenn alle Fragmente gesammelt sind.
   */
  final?: boolean;
  /**
   * Station abseits der Wege; braucht Knicklicht oder Reflektor als Marker.
   */
  offPath?: boolean;
  /**
   * Gleichwertige Auslöser. Jeder einzelne aktiviert die Station.
   *
   * @minItems 1
   */
  triggers: Trigger[];
  story?: StoryPiece;
  task?: Task;
  /**
   * Hinweise in Stufen, üblich sind drei: Schubs, deutlicher Tipp, fast Lösung.
   */
  hints?: Hint[];
  rewards?: Rewards;
  /**
   * Physische Requisiten; landen automatisch in der Materialliste.
   */
  props?: Prop[];
  /**
   * Notizen für Spielleitung und Aufbau; nie für Teams sichtbar.
   */
  notes?: string;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "hint".
 */
export interface Hint {
  text: Text;
  cost?: Penalty;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "rewards".
 */
export interface Rewards {
  points?: number;
  fragments?: Id[];
  items?: Id[];
  /**
   * Stationen, die nach dem Lösen erscheinen.
   */
  reveal?: Id[];
  chapter?: Id;
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "prop".
 */
export interface Prop {
  name: string;
  quantity?: number;
  kind?: "lock" | "uv_message" | "puzzle" | "hidden_object" | "marker" | "document" | "box" | "other";
  note?: string;
}
/**
 * Visueller Block: Wenn alle Bedingungen erfüllt sind, laufen die Dann-Aktionen. Ist nur die erste Bedingung erfüllt, laufen die Sonst-Aktionen.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "rule".
 */
export interface Rule {
  id: Id;
  /**
   * @minItems 1
   */
  when: Condition[];
  /**
   * @minItems 1
   */
  then: Action[];
  else?: Action[];
  once?: boolean;
}
/**
 * Sicherheitsregeln. Notfallinfos funktionieren immer offline.
 *
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "safety".
 */
export interface Safety {
  emergency: {
    gameMasterPhone: string;
    emergencyNumber?: string;
    notes?: Text;
  };
  /**
   * Lebenszeichen: Team bestätigt alle interval Sekunden.
   */
  heartbeat?: {
    enabled?: boolean;
    /**
     * Dauer in Sekunden.
     */
    interval?: number;
    /**
     * Dauer in Sekunden.
     */
    grace?: number;
  };
  sos?: {
    /**
     * Nummer für den SMS-Rückfall ohne Datenverbindung.
     */
    smsFallback?: string;
    lora?: boolean;
    loudSignal?: boolean;
  };
  /**
   * Bei Minderjährigen startet das Spiel erst mit Betreuer.
   */
  requireSupervisor?: boolean;
  /**
   * Pflicht-Ausrüstung je Team, z. B. Lampe und Warnweste.
   */
  requiredGear?: Text[];
}
/**
 * This interface was referenced by `LykoraSpielformatV01`'s JSON-Schema
 * via the `definition` "media".
 */
export interface Media {
  id: Id;
  type: "image" | "audio" | "video";
  /**
   * Relativer Pfad im Spielpaket oder URL.
   */
  src: string;
  alt?: Text;
  transcript?: Text;
}
