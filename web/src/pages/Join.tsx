import { appJoinLink, base, serverUrl } from "../lib/base.ts";
import { useTitle } from "../ui/components.tsx";
import { Lantern } from "../ui/icons.tsx";
import { QrCode } from "../ui/qr.tsx";

/** Landeseite für Spieler hinter dem Link im Einstiegs-QR; ohne Anmeldung. */
export function JoinPage({ code }: { code: string }) {
  useTitle("Mitspielen");
  const clean = code.trim().toUpperCase();
  const link = appJoinLink(serverUrl(base()), clean);
  return (
    <main class="player">
      <span class="wordmark">
        <Lantern />
        Lykora
      </span>
      <h1>Mitspielen</h1>
      <div class="stack tight" style={{ alignItems: "center" }}>
        <span class="label">Event-Code</span>
        <span class="join-code" aria-label={`Event-Code ${clean.split("").join(" ")}`}>
          {clean}
        </span>
      </div>
      <a class="btn primary" href={link}>
        Lykora-App öffnen
      </a>
      <section class="card stack" aria-labelledby="anleitung">
        <h2 id="anleitung">So geht’s</h2>
        <ol>
          <li>Lykora-App auf dem Android-Handy installieren. Die Spielleitung gibt euch den Link zur App.</li>
          <li>Auf „Lykora-App öffnen“ tippen. Die App kennt dann Server und Event.</li>
          <li>Öffnet sich nichts: in der App „Code eingeben“ wählen und den Code oben eintippen.</li>
          <li>Team anlegen: Name, Farbe und eine Notfallnummer. Die Betreuer-PIN bekommt eure Begleitung von der Spielleitung.</li>
        </ol>
      </section>
      <section class="card stack" aria-labelledby="qr-titel">
        <h2 id="qr-titel">Am Computer?</h2>
        <p class="muted">Diesen Code mit der Lykora-App scannen:</p>
        <QrCode value={link} label={`QR-Code zum Beitreten mit Code ${clean}`} size={360} />
      </section>
    </main>
  );
}
