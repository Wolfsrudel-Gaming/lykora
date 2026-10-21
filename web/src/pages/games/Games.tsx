import { useState } from "preact/hooks";
import { formatDateTime } from "../../lib/format.ts";
import { can } from "../../lib/roles.ts";
import { href, navigate } from "../../lib/router.ts";
import { api, notify, session } from "../../lib/session.ts";
import { useStore } from "../../lib/store.ts";
import { Empty, ErrorNotice, Link, Loading, useLoad, useTitle } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";
import { GameUpload } from "./GameUpload.tsx";

export function GamesPage() {
  useTitle("Spiele");
  const s = useStore(session);
  const role = s.orgs.find((o) => o.id === s.orgId)?.role;
  const write = can(role, "game.write");
  const { data, error, loading, reload } = useLoad(() => (s.orgId ? api.games(s.orgId) : Promise.resolve([])), [s.orgId]);
  const [uploading, setUploading] = useState(false);
  const [archived, setArchived] = useState(false);
  const games = (data ?? []).filter((g) => archived || !g.archived);
  const archivedCount = (data ?? []).filter((g) => g.archived).length;

  return (
    <div class="page stack loose">
      <div class="page-head">
        <h1>Spiele</h1>
        {write && !uploading && (
          <button type="button" class="btn primary" onClick={() => setUploading(true)}>
            <Icon name="upload" /> Spiel hochladen
          </button>
        )}
      </div>
      {uploading && (
        <section class="card stack" aria-labelledby="upload-title">
          <div class="row between">
            <h2 id="upload-title">Spiel hochladen</h2>
            <button type="button" class="btn small" onClick={() => setUploading(false)}>
              Schließen
            </button>
          </div>
          <p class="small muted">
            Ein Spiel ist eine JSON-Datei im Lykora-Spielformat. Ein Beispiel liegt im Repository unter spec/v0.1/examples/testspiel.json. Der Server prüft das Spiel vor dem Speichern.
          </p>
          <GameUpload
            submitLabel="Spiel speichern"
            onSave={async (content, comment) => {
              const g = await api.createGame(s.orgId!, content, comment || undefined);
              notify(`Spiel „${g.title}“ gespeichert`, "ok");
              navigate(href("game", { gameId: g.id }));
            }}
          />
        </section>
      )}
      <ErrorNotice error={error} retry={reload} />
      {loading && !data ? (
        <Loading />
      ) : games.length === 0 ? (
        <Empty>Noch keine Spiele.{write ? " Lade ein Spiel als JSON-Datei hoch." : ""}</Empty>
      ) : (
        <ul class="list card">
          {games.map((g) => (
            <li key={g.id} class="list-item">
              <div class="grow">
                <Link to={href("game", { gameId: g.id })} class="strong">
                  {g.title}
                </Link>
                <div class="small muted">
                  Version {g.latest_version ?? "–"} · geändert {formatDateTime(g.updated_at)}
                </div>
              </div>
              {g.archived && <span class="badge quiet">Archiviert</span>}
              <div class="row">
                <Link to={href("gameMedia", { gameId: g.id })} class="btn small">
                  Medien und Klänge
                </Link>
                <Link to={href("game", { gameId: g.id })} class="btn small">
                  Übersicht
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {archivedCount > 0 && (
        <label class="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />
          Archivierte Spiele zeigen ({archivedCount})
        </label>
      )}
    </div>
  );
}
