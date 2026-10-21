import { href } from "../lib/router.ts";
import { Link, useTitle } from "../ui/components.tsx";

export function NotFound() {
  useTitle("Nicht gefunden");
  return (
    <div class="page narrow stack">
      <h1>Seite nicht gefunden</h1>
      <p class="muted">Diese Adresse gibt es im Dashboard nicht.</p>
      <p>
        <Link to={href("home")} class="btn">
          Zur Startseite
        </Link>
      </p>
    </div>
  );
}
