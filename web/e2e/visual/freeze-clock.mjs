// Wird von instance.mjs --freeze per --import in den Server geladen: friert Date des Servers ein.
// Sonst rechnet der Server (Warnungen "seit N Min", Laufzeiten) mit der Wanduhr und jede Minute sieht die Seite anders aus.
const fixed = Number(process.env.VISUAL_NOW);
if (Number.isFinite(fixed) && fixed > 0) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = FrozenDate;
}
