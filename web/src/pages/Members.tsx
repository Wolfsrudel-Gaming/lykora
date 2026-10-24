import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { can, ROLE_HINTS, ROLE_LABELS, ROLES } from "../lib/roles.ts";
import { api, errorText, notify, refreshOrgs, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import type { Member, Role } from "../lib/types.ts";
import { Empty, ErrorNotice, Field, Loading, confirm, useLoad, useTitle } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";

export function MembersPage() {
  useTitle("Mitglieder");
  const s = useStore(session);
  const org = s.orgs.find((o) => o.id === s.orgId);
  const admin = can(org?.role, "org.manage");
  const { data, error, loading, reload, setData } = useLoad(() => (s.orgId && admin ? api.members(s.orgId) : Promise.resolve([])), [s.orgId, admin]);

  if (!admin) {
    return (
      <div class="page narrow">
        <h1>Mitglieder</h1>
        <p class="notice">Mitglieder verwalten nur Admins der Organisation.</p>
      </div>
    );
  }

  const changeRole = async (m: Member, role: Role) => {
    try {
      await api.addMember(s.orgId!, { email: m.email, role });
      setData((data ?? []).map((x) => (x.id === m.id ? { ...x, role } : x)));
      if (m.id === s.user?.id) await refreshOrgs();
      notify(`${m.name} ist jetzt ${ROLE_LABELS[role]}`, "ok");
    } catch (err) {
      notify(errorText(err), "error");
      reload();
    }
  };

  const remove = async (m: Member) => {
    const answer = await confirm({
      title: "Mitglied entfernen?",
      body: <p>{m.name} verliert den Zugang zu dieser Organisation. Das Konto selbst bleibt bestehen.</p>,
      confirm: "Entfernen",
    });
    if (!answer.ok) return;
    try {
      await api.removeMember(s.orgId!, m.id);
      setData((data ?? []).filter((x) => x.id !== m.id));
      notify(`${m.name} entfernt`, "ok");
    } catch (err) {
      notify(errorText(err), "error");
    }
  };

  return (
    <div class="page stack loose">
      <div class="page-head">
        <h1>Mitglieder</h1>
        <span class="muted">{org?.name}</span>
      </div>
      <ErrorNotice error={error} retry={reload} />
      <section class="card" aria-labelledby="members-list">
        <h2 id="members-list">Wer Zugang hat</h2>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>Keine Mitglieder.</Empty>
        ) : (
          <table class="table cards">
            <thead>
              <tr>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>
                  <span class="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td data-label="Name">
                    <strong>{m.name}</strong>
                    {m.disabled && <span class="badge quiet">Gesperrt</span>}
                    {m.id === s.user?.id && <span class="small muted"> (du)</span>}
                  </td>
                  <td data-label="E-Mail" class="wrap-anywhere">
                    {m.email}
                  </td>
                  <td data-label="Rolle">
                    <select aria-label={`Rolle von ${m.name}`} value={m.role} disabled={m.id === s.user?.id} onChange={(e) => void changeRole(m, e.currentTarget.value as Role)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td class="num">
                    {m.id !== s.user?.id && (
                      <button type="button" class="btn small" aria-label={`${m.name} entfernen`} onClick={() => void remove(m)}>
                        <Icon name="trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <AddMember orgId={s.orgId!} onAdded={(m) => setData([...(data ?? []).filter((x) => x.id !== m.id), m].sort((a, b) => a.name.localeCompare(b.name, "de")))} />
      <section class="card" aria-labelledby="roles">
        <h2 id="roles">Rollen</h2>
        <dl class="kv">
          {ROLES.map((r) => (
            <Fragment key={r}>
              <dt>{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_HINTS[r]}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
    </div>
  );
}

function AddMember({ orgId, onAdded }: { orgId: string; onAdded: (m: Member) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("supervisor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await api.addMember(orgId, { email: email.trim(), name: name.trim() || undefined, password: password || undefined, role });
      onAdded({ ...m, disabled: false, role });
      notify(`${m.name} hinzugefügt`, "ok");
      setEmail("");
      setName("");
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card stack" onSubmit={submit} aria-labelledby="member-new">
      <h2 id="member-new">Mitglied hinzufügen</h2>
      <p class="small muted">Gibt es die E-Mail schon, bekommt die Person nur die Rolle. Für neue Konten Name und ein Startpasswort (mindestens 10 Zeichen) angeben und sicher weitergeben.</p>
      <div class="grid-2">
        <Field label="E-Mail">
          <input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </Field>
        <Field label="Rolle">
          <select value={role} onChange={(e) => setRole(e.currentTarget.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name (neues Konto)">
          <input value={name} autoComplete="off" onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="Startpasswort (neues Konto)">
          <input type="password" minLength={10} autoComplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </Field>
      </div>
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={busy}>
          Hinzufügen
        </button>
      </div>
    </form>
  );
}
