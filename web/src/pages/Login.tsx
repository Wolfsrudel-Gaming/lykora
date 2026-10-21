import { useState } from "preact/hooks";
import { errorText, signIn } from "../lib/session.ts";
import { Field, useTitle } from "../ui/components.tsx";
import { Lantern } from "../ui/icons.tsx";

export function LoginPage() {
  useTitle("Anmelden");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="login">
      <form class="card stack" onSubmit={submit} aria-labelledby="login-title">
        <div class="stack tight">
          <span class="wordmark">
            <Lantern />
            Lykora
          </span>
          <h1 id="login-title" class="label">
            Leitstand · Anmeldung
          </h1>
        </div>
        <Field label="E-Mail">
          <input type="email" name="email" autoComplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </Field>
        <Field label="Passwort">
          <input type="password" name="password" autoComplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </Field>
        {error && (
          <p class="notice error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn primary block" disabled={busy}>
          {busy ? "Melde an …" : "Anmelden"}
        </button>
        <p class="small muted">Zugänge vergibt, wer in deiner Organisation Admin ist.</p>
      </form>
    </main>
  );
}
