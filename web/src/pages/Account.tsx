import { useState } from "preact/hooks";
import { ROLE_LABELS } from "../lib/roles.ts";
import { api, errorText, notify, session, signOut } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import { Field, useTitle } from "../ui/components.tsx";

export function AccountPage() {
  useTitle("Konto");
  const s = useStore(session);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (next !== repeat) return setError("Die beiden neuen Passwörter stimmen nicht überein.");
    if (next.length < 10) return setError("Das neue Passwort braucht mindestens 10 Zeichen.");
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      notify("Passwort geändert. Andere Anmeldungen wurden beendet.", "ok");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page narrow stack loose">
      <div class="page-head">
        <h1>Konto</h1>
      </div>
      <section class="card">
        <dl class="kv">
          <dt>Name</dt>
          <dd>{s.user?.name}</dd>
          <dt>E-Mail</dt>
          <dd>{s.user?.email}</dd>
          <dt>Rollen</dt>
          <dd>{s.orgs.map((o) => `${o.name}: ${ROLE_LABELS[o.role]}`).join(" · ") || "–"}</dd>
        </dl>
      </section>
      <form class="card stack" onSubmit={submit} aria-labelledby="pw">
        <h2 id="pw">Passwort ändern</h2>
        <input type="email" autoComplete="username" value={s.user?.email ?? ""} readOnly hidden />
        <Field label="Aktuelles Passwort">
          <input type="password" autoComplete="current-password" required value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
        </Field>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">
          <input type="password" autoComplete="new-password" minLength={10} required value={next} onInput={(e) => setNext(e.currentTarget.value)} />
        </Field>
        <Field label="Neues Passwort wiederholen">
          <input type="password" autoComplete="new-password" minLength={10} required value={repeat} onInput={(e) => setRepeat(e.currentTarget.value)} />
        </Field>
        {error && (
          <p class="notice error" role="alert">
            {error}
          </p>
        )}
        <div class="form-actions">
          <button type="submit" class="btn primary" disabled={busy}>
            Passwort ändern
          </button>
        </div>
      </form>
      <section class="card row between">
        <span>Auf diesem Gerät abmelden</span>
        <button type="button" class="btn" onClick={() => void signOut()}>
          Abmelden
        </button>
      </section>
    </div>
  );
}
