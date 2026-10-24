import { hostname } from "node:os";
import { DockerClient } from "./updater/docker.ts";
import { Updater } from "./updater/loop.ts";
import { ServerClient } from "./updater/server.ts";

/*
 * Updater: eigener Container aus demselben Image, mit Zugriff auf den Docker-Socket. Fragt den
 * Server, ob er aktualisieren soll, und ersetzt dann die Container mit dem Label
 * io.lykora.autoupdate=true. Welches Image er zieht, bestimmen die Container, nie der Server.
 */

const env = process.env;
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const url = env.LYKORA_SERVER_URL || "http://server:3000/lykora";
const pollSeconds = Number(env.UPDATER_POLL_SECONDS) || 60;
const docker = new DockerClient(env.DOCKER_SOCKET || "/var/run/docker.sock");

const updater = new Updater({
  docker,
  server: new ServerClient({ url, token: env.UPDATER_TOKEN?.trim(), tokenFile: env.UPDATER_TOKEN_FILE || "/data/updater.token" }),
  pollSeconds,
  registry:
    env.LYKORA_REGISTRY_USER && env.LYKORA_REGISTRY_TOKEN ? { user: env.LYKORA_REGISTRY_USER, token: env.LYKORA_REGISTRY_TOKEN } : undefined,
  hostname: hostname(),
  replaces: env.LYKORA_UPDATER_REPLACES || undefined,
  log,
});

// Als PID 1 im Container beendet sich Node ohne eigene Behandlung nicht auf SIGTERM.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log(`${signal} empfangen, Updater beendet`);
    updater.stop();
    process.exit(0);
  });
}

log(`Updater gestartet; fragt ${url} alle ${pollSeconds} s`);
await docker.apiVersion().then(
  (version) => log(`Docker-API ${version} über ${docker.socketPath}`),
  (err) => log(`Docker nicht erreichbar über ${docker.socketPath}: ${(err as Error).message}`),
);
await updater.start();
