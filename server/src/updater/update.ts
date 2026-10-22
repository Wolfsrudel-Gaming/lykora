import { setTimeout as sleep } from "node:timers/promises";
import type { ContainerInfo, DockerClient } from "./docker.ts";
import { composeImageDigest, parseReference, planReplacement } from "./merge.ts";
import type { UpdaterState } from "./server.ts";

/** Container mit diesem Label ersetzt der Updater; alle anderen fasst er nie an. */
export const TARGET_LABEL = "io.lykora.autoupdate";
/** Label des Updater-Containers selbst. */
export const UPDATER_LABEL = "io.lykora.updater";
/** Tag für die vorige Version, solange sie Rückfall ist. */
export const ROLLBACK_TAG = "lykora-rollback";

export interface Timings {
  /** Höchstens so lange auf „healthy“ warten. */
  healthTimeoutMs: number;
  /** Ohne Healthcheck gilt ein Container als gesund, wenn er so lange läuft. */
  settleMs: number;
  intervalMs: number;
  stopSeconds: number;
  /** Pause vor dem nächsten Versuch, wenn Docker beim Rückfall einen Schritt verweigert. */
  retryDelayMs: number;
}

export const DEFAULT_TIMINGS: Timings = { healthTimeoutMs: 180_000, settleMs: 20_000, intervalMs: 2_000, stopSeconds: 30, retryDelayMs: 3_000 };

/** So oft versucht der Rückfall jeden Schritt: Ein kurzer Aussetzer des Daemons darf die Seite nicht liegen lassen. */
export const RESTORE_ATTEMPTS = 3;

export interface UpdateContext {
  docker: DockerClient;
  /** Meldet den Stand an den Server; wirft nie. */
  report(state: UpdaterState, message?: string, imageId?: string): Promise<void>;
  log(message: string): void;
  registry?: { user: string; token: string };
  timings: Timings;
  /** Hostname dieses Prozesses; im eigenen Container der Anfang der Container-ID. */
  hostname: string;
}

/** Abbruch mit dem Zustand, den der Updater dem Server meldet. */
export class UpdateError extends Error {
  readonly state: "failed" | "rolled_back" | "unsupported";

  constructor(state: UpdateError["state"], message: string) {
    super(message);
    this.state = state;
  }
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const nameOf = (c: { Name: string }) => c.Name.replace(/^\//, "");

const SETUP_HINT =
  "Für automatische Updates in .env LYKORA_IMAGE=ghcr.io/wolfsrudel-gaming/lykora:testbuild (oder :latest) setzen " +
  "und docker compose up -d ausführen.";

/** Fehler beim Ziehen, die sich durch Warten nicht geben. */
const NOT_PULLABLE = /not found|unauthorized|denied|does not exist|manifest unknown|authentication required|forbidden/i;

/** Laufende Ziel-Container; Reste eines Updates („-alt“) zählen nicht. */
async function targets(docker: DockerClient): Promise<ContainerInfo[]> {
  const list = await docker.listContainers({ label: [`${TARGET_LABEL}=true`], status: ["running"] });
  const infos = await Promise.all(list.map((c) => docker.inspectContainer(c.Id)));
  return infos.filter((c): c is ContainerInfo => !!c && !nameOf(c).endsWith("-alt"));
}

/** Zieht das Image, mit dem ein Ziel läuft, und gibt die ID der gezogenen Fassung zurück. */
async function pullImage(ctx: UpdateContext, ref: string, container: string): Promise<string> {
  const parsed = parseReference(ref);
  if (/^(sha256:)?[0-9a-f]{12,64}$/.test(ref) || parsed.digest) {
    throw new UpdateError("unsupported", `${container} läuft mit einem festen Image (${ref}), das sich nicht aktualisieren lässt. ${SETUP_HINT}`);
  }
  if (!parsed.explicitRegistry && !parsed.repo.includes("/")) {
    throw new UpdateError(
      "unsupported",
      `${container} läuft mit dem lokal gebauten Image ${ref}, das in keiner Registry liegt. ${SETUP_HINT}`,
    );
  }
  const auth = ctx.registry ? { ...ctx.registry, server: parsed.registry } : undefined;
  ctx.log(`Ziehe ${ref}`);
  try {
    await ctx.docker.pull(parsed.repo, parsed.tag, auth, (status) => ctx.log(status));
  } catch (err) {
    const text = errorText(err);
    if (NOT_PULLABLE.test(text)) {
      throw new UpdateError(
        "unsupported",
        `Image ${ref} ließ sich nicht ziehen (${text}). Ist es lokal gebaut oder privat? ${SETUP_HINT} ` +
          "Für private Images LYKORA_REGISTRY_USER und LYKORA_REGISTRY_TOKEN setzen.",
      );
    }
    throw new UpdateError("failed", `Image ${ref} ließ sich nicht ziehen: ${text}`);
  }
  const image = await ctx.docker.inspectImage(ref);
  if (!image) throw new UpdateError("failed", `Image ${ref} fehlt nach dem Ziehen`);
  return image.Id;
}

/** Wartet auf „healthy“; ohne Healthcheck genügt es, eine Weile zu laufen. */
export async function waitHealthy(ctx: UpdateContext, id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { healthTimeoutMs, settleMs, intervalMs } = ctx.timings;
  const started = Date.now();
  for (;;) {
    const info = await ctx.docker.inspectContainer(id);
    const elapsed = Date.now() - started;
    if (!info) return { ok: false, reason: "Container verschwunden" };
    const state = info.State;
    if (state.Status === "exited" || state.Status === "dead") return { ok: false, reason: `beendet mit Code ${state.ExitCode ?? "?"}` };
    if (info.RestartCount > 0) return { ok: false, reason: "nach einem Absturz neu gestartet" };
    if (state.Health) {
      if (state.Health.Status === "healthy") return { ok: true };
      if (state.Health.Status === "unhealthy") return { ok: false, reason: "Healthcheck schlägt fehl" };
    } else if (state.Running && elapsed >= settleMs) {
      return { ok: true };
    }
    if (elapsed >= healthTimeoutMs) return { ok: false, reason: `nach ${Math.round(healthTimeoutMs / 1000)} s nicht gesund` };
    await sleep(intervalMs);
  }
}

/** Ein Docker-Aufruf mit Wiederholung; wirft erst, wenn alle Versuche scheitern. */
async function insist<T>(ctx: UpdateContext, what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RESTORE_ATTEMPTS) throw err;
      ctx.log(`${what}: ${errorText(err)}; Versuch ${attempt + 1} von ${RESTORE_ATTEMPTS}`);
      await sleep(ctx.timings.retryDelayMs);
    }
  }
}

/**
 * Neuen Container entfernen, alten wieder starten und zurückbenennen. Jeder Schritt wird bei einem
 * Fehler wiederholt, und der alte Container startet auch dann, wenn ein Schritt davor scheiterte.
 * Startet er nicht, bleibt er als <name>-alt stehen: Den holt recover() beim nächsten Mal zurück.
 */
async function restore(ctx: UpdateContext, old: ContainerInfo, created?: string): Promise<void> {
  const { docker, timings } = ctx;
  const name = nameOf(old);
  const problems: string[] = [];
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await insist(ctx, what, fn);
      return true;
    } catch (err) {
      problems.push(`${what}: ${errorText(err)}`);
      return false;
    }
  };
  if (created) {
    // Erst der neue weg, sonst wären Ports und Name belegt; Löschen mit force beendet ihn notfalls.
    const fresh = created;
    await insist(ctx, "Neuen Container stoppen", () => docker.stopContainer(fresh, timings.stopSeconds)).catch(() => {});
    await step("Neuen Container löschen", () => docker.removeContainer(fresh, true));
  }
  const started = await step(`${name} starten`, () => docker.startContainer(old.Id));
  const current = started ? await docker.inspectContainer(old.Id).catch(() => null) : null;
  if (current && nameOf(current) !== name) await step(`${name} zurückbenennen`, () => docker.renameContainer(old.Id, name));
  if (problems.length) throw new Error(problems.join("; "));
}

const lastLines = (text: string, lines = 15, chars = 1500) => text.trimEnd().split("\n").slice(-lines).join("\n").slice(-chars);

/**
 * Zurück zur alten Version. Das Tag zeigt danach wieder auf sie, damit „docker compose up -d“ den
 * Container nicht erneut mit der kaputten Fassung anlegt. Liefert den Fehler zum Werfen: rolled_back;
 * bleibt der Rückfall selbst hängen, failed mit dem Hinweis, dass der Updater ihn bei der nächsten Frage nachholt.
 */
async function rollBack(ctx: UpdateContext, container: ContainerInfo, created: string | undefined, why: string, tail = ""): Promise<UpdateError> {
  const { repo, tag } = parseReference(container.Config.Image!);
  await ctx.docker.tagImage(container.Image, repo, tag).catch((err) => ctx.log(`Tag ${repo}:${tag} zeigt weiter auf die neue Version: ${errorText(err)}`));
  let state: UpdateError["state"] = "rolled_back";
  let outcome = "Die alte Version läuft wieder.";
  try {
    await restore(ctx, container, created);
  } catch (err) {
    state = "failed";
    outcome = `Der Rückfall auf die alte Version ist unvollständig (${errorText(err)}); der Updater holt sie bei der nächsten Frage zurück.`;
  }
  return new UpdateError(state, `${why} ${outcome}${tail.trim() ? `\nLetzte Zeilen:\n${lastLines(tail)}` : ""}`);
}

/** Ersetzt einen Container durch einen Nachfolger mit dem neuen Image; bei Problemen zurück zum alten. */
async function replace(ctx: UpdateContext, container: ContainerInfo, newImageId: string): Promise<void> {
  const { docker, timings } = ctx;
  const name = nameOf(container);
  const ref = container.Config.Image!;
  const { repo } = parseReference(ref);
  const oldImage = await docker.inspectImage(container.Image);
  const newImage = await docker.inspectImage(newImageId, true);
  const previous = await docker.inspectImage(`${repo}:${ROLLBACK_TAG}`);
  await docker.tagImage(container.Image, repo, ROLLBACK_TAG);
  const plan = planReplacement(container, oldImage?.Config ?? {}, newImageId, {}, newImage ? composeImageDigest(newImage) : newImageId);

  await ctx.report("updating", `Ersetze ${name}`);
  let created: string | undefined;
  try {
    // Erst umbenennen, dann stoppen: Bricht der Updater mittendrin ab, stellt er beim nächsten
    // Start den Container unter <name>-alt wieder her.
    await docker.renameContainer(container.Id, `${name}-alt`);
    await docker.stopContainer(container.Id, timings.stopSeconds);
    created = (await docker.createContainer(name, plan.body)).Id;
    for (const network of plan.networks) await docker.connectNetwork(network.name, created, network.endpoint);
    await docker.startContainer(created);
  } catch (err) {
    throw await rollBack(ctx, container, created, `Neue Version von ${name} ließ sich nicht starten (${errorText(err)}).`);
  }

  await ctx.report("restarting", `Warte, bis ${name} gesund läuft`);
  const health = await waitHealthy(ctx, created);
  if (!health.ok) {
    const tail = await docker.logs(created, 30, !!container.Config.Tty).catch(() => "");
    throw await rollBack(ctx, container, created, `Neue Version von ${name} startete nicht gesund (${health.reason}).`, tail);
  }
  await docker.removeContainer(container.Id);
  // Das vorige Rückfall-Image braucht niemand mehr, sofern es keinen Namen mehr trägt.
  if (previous && previous.Id !== container.Image && previous.Id !== newImageId) {
    const stale = await docker.inspectImage(previous.Id);
    if (stale && !stale.RepoTags?.length) await docker.removeImage(previous.Id).catch(() => {});
  }
  ctx.log(`${name} läuft mit ${newImageId}`);
}

/** Der eigene Container: Label io.lykora.updater und Hostname gleich ID-Anfang oder gesetztem Hostnamen. */
export async function findSelf(ctx: UpdateContext): Promise<ContainerInfo | null> {
  const list = await ctx.docker.listContainers({ label: [`${UPDATER_LABEL}=true`] }, true);
  const host = ctx.hostname;
  const byId = /^[0-9a-f]{12,64}$/.test(host) ? list.find((c) => c.Id.startsWith(host)) : undefined;
  if (byId) return ctx.docker.inspectContainer(byId.Id);
  for (const c of list) {
    const info = await ctx.docker.inspectContainer(c.Id);
    if (info?.Config.Hostname === host) return info;
  }
  return null;
}

/**
 * Läuft der Updater selbst mit einer älteren Fassung eines gerade gezogenen Images, startet er einen
 * Nachfolger „<name>-neu“. Der übernimmt beim Start (siehe takeOver). Gibt dessen ID zurück.
 */
async function replaceSelf(ctx: UpdateContext, pulled: Map<string, string>): Promise<string | null> {
  const self = await findSelf(ctx);
  const newImageId = self ? pulled.get(self.Config.Image ?? "") : undefined;
  if (!self || !newImageId || newImageId === self.Image) return null;
  const { docker } = ctx;
  const name = `${nameOf(self)}-neu`;
  const stale = await docker.inspectContainer(name);
  if (stale) await docker.removeContainer(stale.Id, true);
  const image = await docker.inspectImage(self.Image);
  const newImage = await docker.inspectImage(newImageId, true);
  const plan = planReplacement(self, image?.Config ?? {}, newImageId, { LYKORA_UPDATER_REPLACES: self.Id }, newImage ? composeImageDigest(newImage) : newImageId);
  const { Id } = await docker.createContainer(name, plan.body);
  for (const network of plan.networks) await docker.connectNetwork(network.name, Id, network.endpoint);
  await docker.startContainer(Id);
  ctx.log(`Neuer Updater ${name} gestartet; er löst diesen gleich ab`);
  return Id;
}

/** Nachfolger beim Start: Vorgänger stoppen und löschen, dann dessen Namen übernehmen. */
export async function takeOver(ctx: UpdateContext, predecessorId: string): Promise<void> {
  const { docker } = ctx;
  const self = await findSelf(ctx);
  if (!self) return;
  const own = nameOf(self);
  let name = own.endsWith("-neu") ? own.slice(0, -4) : own;
  const old = await docker.inspectContainer(predecessorId);
  if (old && old.Id !== self.Id) {
    name = nameOf(old);
    await docker.stopContainer(old.Id, ctx.timings.stopSeconds);
    await docker.removeContainer(old.Id, true);
    ctx.log(`Alten Updater ${name} abgelöst`);
  }
  if (name !== own && !(await docker.inspectContainer(name))) await docker.renameContainer(self.Id, name);
}

/**
 * Räumt nach einem abgebrochenen Update auf: Gibt es „<name>-alt“, läuft aber „<name>“ nicht
 * (oder nicht gesund), kommt der alte Container zurück. Die Seite soll nie liegen bleiben.
 */
export async function recover(ctx: UpdateContext): Promise<void> {
  const { docker, timings } = ctx;
  const all = await docker.listContainers({ label: [`${TARGET_LABEL}=true`] }, true);
  const byName = new Map(all.map((c) => [(c.Names[0] ?? "").replace(/^\//, ""), c]));
  for (const [altName, alt] of byName) {
    if (!altName.endsWith("-alt")) continue;
    const name = altName.slice(0, -4);
    const current = byName.get(name);
    if (current?.State === "running") {
      ctx.log(`${altName} gefunden; prüfe, ob ${name} gesund läuft`);
      const health = await waitHealthy(ctx, current.Id);
      if (health.ok) {
        await docker.removeContainer(alt.Id, true);
        ctx.log(`${altName} gelöscht, ${name} läuft gesund`);
        await ctx.report("idle", "Update eingespielt", current.ImageID);
        continue;
      }
      await docker.stopContainer(current.Id, timings.stopSeconds).catch(() => {});
    }
    if (current) await docker.removeContainer(current.Id, true);
    await docker.renameContainer(alt.Id, name);
    await docker.startContainer(alt.Id);
    ctx.log(`${name} aus ${altName} wiederhergestellt`);
    await ctx.report("rolled_back", `Ein Update von ${name} wurde unterbrochen. Die alte Version läuft wieder.`);
  }
}

/**
 * Ein Update: Images der Ziele ziehen, geänderte Container ersetzen, danach bei Bedarf sich selbst.
 * Meldet jeden Schritt; das Ergebnis sagt, ob es geklappt hat und ob ein Nachfolger übernimmt.
 */
export async function runUpdate(ctx: UpdateContext): Promise<{ ok: boolean; successor?: string }> {
  try {
    await ctx.report("pulling", "Lade die neue Version");
    const list = await targets(ctx.docker);
    if (!list.length) {
      throw new UpdateError("unsupported", `Kein laufender Container mit dem Label ${TARGET_LABEL}=true. compose.yaml aus dem Repo verwenden.`);
    }
    // Nur Images ziehen, mit denen Ziele schon laufen; jedes nur einmal.
    const pulled = new Map<string, string>();
    for (const c of list) {
      const ref = c.Config.Image ?? "";
      if (!pulled.has(ref)) pulled.set(ref, await pullImage(ctx, ref, nameOf(c)));
    }
    let replaced = 0;
    for (const c of list) {
      const newImageId = pulled.get(c.Config.Image ?? "")!;
      if (newImageId === c.Image) continue;
      await replace(ctx, c, newImageId);
      replaced++;
    }
    const imageId = pulled.get(list[0]!.Config.Image ?? "");
    await ctx.report("idle", replaced ? "Update eingespielt" : "Schon aktuell", imageId);
    const successor = await replaceSelf(ctx, pulled).catch((err) => {
      ctx.log(`Updater konnte sich nicht selbst erneuern: ${errorText(err)}`);
      return null;
    });
    return successor ? { ok: true, successor } : { ok: true };
  } catch (err) {
    const state = err instanceof UpdateError ? err.state : "failed";
    const message = err instanceof UpdateError ? err.message : `Update gescheitert: ${errorText(err)}`;
    await ctx.report(state, message);
    return { ok: false };
  }
}
