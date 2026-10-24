import { setTimeout as sleep } from "node:timers/promises";
import type { DockerClient } from "./docker.ts";
import type { Plan, ServerClient, UpdaterState } from "./server.ts";
import { DEFAULT_TIMINGS, errorText, recover, runUpdate, takeOver, type Timings, type UpdateContext } from "./update.ts";

/**
 * Ob ein gescheitertes Ziel noch einmal versucht wird, entscheidet der Server (automatisch erst nach
 * 6 Stunden, „Jetzt aktualisieren“ sofort). Kam die Meldung des Scheiterns nicht bei ihm an, weiß er
 * davon nichts; dann wartet der Updater selbst so lange, damit eine kaputte Version die Seite nicht
 * bei jeder Frage kurz lahmlegt.
 */
export const RETRY_FAILED_AFTER_MS = 6 * 60 * 60_000;

export interface UpdaterOptions {
  docker: DockerClient;
  server: Pick<ServerClient, "plan" | "report">;
  /** Abstand der Fragen, solange der Server keinen anderen vorgibt. */
  pollSeconds: number;
  registry?: { user: string; token: string };
  hostname: string;
  /** Container-ID des Vorgängers nach einem Selbst-Update (LYKORA_UPDATER_REPLACES). */
  replaces?: string;
  timings?: Partial<Timings & { reportRetryMs: number; reportAttempts: number; handoverMs: number }>;
  log?: (message: string) => void;
}

/** Endzustände meldet der Updater beharrlich: Nach einem Update braucht der Server einen Moment. */
const FINAL: UpdaterState[] = ["idle", "failed", "rolled_back", "unsupported"];

/** Bleibt der Server so viele Fragen lang weg, liegt vielleicht ein unvollständiger Rückfall: aufräumen. */
const RECOVER_AFTER_FAILURES = 3;

/** Fragt den Server regelmäßig und spielt Updates ein, nie zwei gleichzeitig. */
export class Updater {
  private readonly opts: UpdaterOptions;
  private readonly ctx: UpdateContext;
  private readonly failed = new Map<string, number>();
  private readonly log: (message: string) => void;
  private current?: Promise<void>;
  private successor?: string;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private lastError?: string;
  private unreachable = 0;
  /** Nach einem gescheiterten Update können Reste liegen, etwa ein unvollständiger Rückfall. */
  private leftovers = false;
  /** Endzustand, den der Server nicht bekommen hat; geht mit der nächsten Frage noch einmal raus. */
  private undelivered?: { state: UpdaterState; message?: string };

  constructor(opts: UpdaterOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    this.ctx = {
      docker: opts.docker,
      report: (state, message, imageId) => this.report(state, message, imageId),
      log: this.log,
      registry: opts.registry,
      timings: { ...DEFAULT_TIMINGS, ...opts.timings },
      hostname: opts.hostname,
    };
  }

  /** Übernimmt vom Vorgänger, räumt abgebrochene Updates auf und fragt dann regelmäßig. */
  async start(): Promise<void> {
    if (this.opts.replaces) await takeOver(this.ctx, this.opts.replaces).catch((err) => this.log(`Übernahme gescheitert: ${errorText(err)}`));
    await recover(this.ctx).catch((err) => this.log(`Aufräumen nach Abbruch gescheitert: ${errorText(err)}`));
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Das laufende Update, sonst undefined. */
  get running(): Promise<void> | undefined {
    return this.current;
  }

  private schedule(seconds: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick().then((next) => this.schedule(next)), seconds * 1000);
  }

  /**
   * Fragt einmal nach dem Plan und startet bei „update“ ein Update im Hintergrund. Währenddessen
   * fragt der Updater weiter (Lebenszeichen), ein erneutes „update“ lässt er liegen.
   * Gibt die Sekunden bis zur nächsten Frage zurück.
   */
  async tick(): Promise<number> {
    if (this.leftovers) await this.heal();
    let plan: Plan;
    try {
      plan = await this.opts.server.plan();
      this.lastError = undefined;
      this.unreachable = 0;
    } catch (err) {
      // Während eines Updates ist der Server kurz weg; dieselbe Meldung nur einmal ins Log.
      const text = errorText(err);
      if (text !== this.lastError) this.log(`Server nicht erreichbar: ${text}`);
      this.lastError = text;
      if (++this.unreachable % RECOVER_AFTER_FAILURES === 0) await this.heal();
      return this.opts.pollSeconds;
    }
    const next = plan.pollSeconds > 0 ? plan.pollSeconds : this.opts.pollSeconds;
    const missed = this.current ? undefined : this.undelivered;
    if (missed) {
      this.undelivered = undefined;
      await this.opts.server.report(missed.state, missed.message).catch(() => (this.undelivered ??= missed));
    }
    if (plan.action !== "update" || this.current || this.successor) return next;
    const digest = plan.target?.digest;
    const failedAt = digest ? this.failed.get(digest) : undefined;
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_FAILED_AFTER_MS) return next;

    this.log(`Update angefordert: ${plan.reason}`);
    this.current = this.update(digest).finally(() => (this.current = undefined));
    return next;
  }

  /** Räumt Reste eines Updates auf (recover), nie neben einem laufenden Update. */
  private async heal(): Promise<void> {
    if (this.current || this.successor) return;
    try {
      await recover(this.ctx);
      this.leftovers = false;
    } catch (err) {
      this.log(`Aufräumen gescheitert: ${errorText(err)}`);
    }
  }

  private async update(digest: string | undefined): Promise<void> {
    const result = await runUpdate(this.ctx);
    if (!result.ok) this.leftovers = true;
    if (!result.ok && digest && this.undelivered) this.failed.set(digest, Date.now());
    if (!result.successor) return;
    // Der Nachfolger stoppt diesen Container gleich. Kommt er nicht dazu, weiter wie bisher.
    this.successor = result.successor;
    await sleep(this.opts.timings?.handoverMs ?? 120_000);
    this.log("Neuer Updater hat nicht übernommen; entferne ihn und arbeite weiter");
    await this.opts.docker.removeContainer(result.successor, true).catch(() => {});
    this.successor = undefined;
  }

  private async report(state: UpdaterState, message?: string, imageId?: string): Promise<void> {
    this.log(message ? `${state}: ${message}` : state);
    const attempts = FINAL.includes(state) ? (this.opts.timings?.reportAttempts ?? 24) : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.opts.server.report(state, message, imageId);
        if (FINAL.includes(state)) this.undelivered = undefined;
        return;
      } catch (err) {
        if (attempt < attempts) {
          await sleep(this.opts.timings?.reportRetryMs ?? 5_000);
          continue;
        }
        if (FINAL.includes(state)) this.undelivered = { state, message };
        return this.log(`Stand „${state}“ nicht gemeldet: ${errorText(err)}`);
      }
    }
  }
}
