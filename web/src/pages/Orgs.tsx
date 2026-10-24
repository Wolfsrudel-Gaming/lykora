import { useState } from "preact/hooks";
import { slugify } from "../lib/format.ts";
import { ROLE_LABELS } from "../lib/roles.ts";
import { href, navigate } from "../lib/router.ts";
import { api, errorText, notify, refreshOrgs, selectOrg, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import { Empty, Field, useTitle } from "../ui/components.tsx";

export function OrgsPage() {
  useTitle("Organisation");
  const s = useStore(session);
  const isAdmin = s.orgs.some((o) => o.role === "admin");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    selectOrg(id);
    navigate(href("home"));
  };

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api.createOrg(name.trim(), slug);
      await refreshOrgs();
      selectOrg(org.id);
      notify(`Organisation „${org.name}“ angelegt`, "ok");
      navigate(href("home"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page narrow stack loose">
      <div class="page-head">
        <h1>Organisation</h1>
      </div>
      <section class="card" aria-labelledby="orgs-list">
        <h2 id="orgs-list">Deine Organisationen</h2>
        {s.orgs.length === 0 ? (
          <Empty>Du bist noch in keiner Organisation. Lass dich von einer Admin oder einem Admin einladen.</Empty>
        ) : (
          <ul class="list">
            {s.orgs.map((o) => (
              <li key={o.id} class="list-item">
                <div class="grow">
                  <strong>{o.name}</strong>
                  <div class="small muted">
                    {o.slug} · {ROLE_LABELS[o.role]}
                  </div>
                </div>
                {o.id === s.orgId ? (
                  <span class="badge on">Gewählt</span>
                ) : (
                  <button type="button" class="btn small" onClick={() => choose(o.id)}>
                    Wählen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {isAdmin && (
        <form class="card stack" onSubmit={create} aria-labelledby="org-new">
          <h2 id="org-new">Neue Organisation</h2>
          <p class="muted small">Du wirst dort Admin. Spiele, Events und Mitglieder sind je Organisation getrennt.</p>
          <Field label="Name">
            <input
              required
              value={name}
              onInput={(e) => {
                setName(e.currentTarget.value);
                if (!slugTouched) setSlug(slugify(e.currentTarget.value));
              }}
            />
          </Field>
          <Field label="Kürzel" hint="2 bis 40 Zeichen: Kleinbuchstaben, Ziffern und Bindestriche">
            <input
              required
              pattern="[a-z0-9\-]{2,40}"
              value={slug}
              onInput={(e) => {
                setSlugTouched(true);
                setSlug(e.currentTarget.value);
              }}
            />
          </Field>
          {error && (
            <p class="notice error" role="alert">
              {error}
            </p>
          )}
          <div class="form-actions">
            <button type="submit" class="btn primary" disabled={busy}>
              Anlegen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
