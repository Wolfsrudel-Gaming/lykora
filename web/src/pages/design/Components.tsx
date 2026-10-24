/** Entwurfsseite, Teil 2: Bausteine in allen Zuständen. */

import { useState } from "preact/hooks";
import { notify } from "../../lib/session.ts";
import { Button, ButtonLink, IconButton, type ButtonVariant } from "../../ui/Button.tsx";
import { Avatar, Badge, Chip, Count, StatusBadge, StatusDot, TeamDot } from "../../ui/badge.tsx";
import { confirm, Dialog, Sheet } from "../../ui/dialog.tsx";
import { Banner, EmptyState, ErrorNotice, ErrorState, Loading, Notice, Progress, ProgressRing, Skeleton, SkeletonCard, SkeletonRows, Spinner } from "../../ui/feedback.tsx";
import { Checkbox, Field, Input, Radio, RadioGroup, Select, Switch, Textarea } from "../../ui/form.tsx";
import { Icon } from "../../ui/icons.tsx";
import { Breadcrumb, Card, Divider, Kbd, PageHeader, Panel, SectionHeader, Stat, StatGrid } from "../../ui/layout.tsx";
import { Menu, Popover } from "../../ui/menu.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Segmented, Tabs, type TabDef } from "../../ui/tabs.tsx";
import { DataTable, type Column, type SortState } from "../../ui/table.tsx";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "danger-quiet", "safety", "link"];

function Matrix({ cols, head, fit, children }: { cols: number; head: string[]; /** Spalten teilen die Breite (Formulare) statt Inhaltsbreite (Knöpfe) */ fit?: boolean; children: preact.ComponentChildren }) {
  return (
    <div class="ds-matrix" style={{ gridTemplateColumns: `minmax(80px, auto) repeat(${cols}, ${fit ? "minmax(120px, 1fr)" : "minmax(max-content, 1fr)"})` }}>
      <span />
      {head.map((h) => (
        <span class="ds-label" key={h}>
          {h}
        </span>
      ))}
      {children}
    </div>
  );
}

export function Buttons() {
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Varianten × Zustände</h3>
        <p class="ds-note">Hover, gedrückt und Fokus sind hier erzwungen (Klassen is-hover, is-active, is-focus); in der App erscheinen sie per Zeiger und Tastatur. Gesperrt hat eigene Flächen statt Deckkraft, „Lädt“ ersetzt das Symbol durch den Spinner.</p>
        <div class="ds-stage">
          <Matrix cols={7} head={["Standard", "Hover", "Gedrückt", "Fokus", "Gewählt", "Gesperrt", "Lädt"]}>
            {VARIANTS.map((v) => (
              <>
                <span class="ds-rowhead" key={`${v}-h`}>
                  {v}
                </span>
                <Button key={`${v}-1`} variant={v}>
                  Speichern
                </Button>
                <Button key={`${v}-2`} variant={v} class="is-hover">
                  Speichern
                </Button>
                <Button key={`${v}-3`} variant={v} class="is-active">
                  Speichern
                </Button>
                <Button key={`${v}-4`} variant={v} class="is-focus">
                  Speichern
                </Button>
                <Button key={`${v}-5`} variant={v} aria-pressed={true}>
                  Speichern
                </Button>
                <Button key={`${v}-6`} variant={v} disabled>
                  Speichern
                </Button>
                <Button key={`${v}-7`} variant={v} loading>
                  Speichert
                </Button>
              </>
            ))}
          </Matrix>
        </div>
      </div>
      <div class="ds-block">
        <h3>Größen, Symbole, Zähler</h3>
        <div class="ds-stage ds-row">
          <Button size="sm" variant="primary">
            Klein 32
          </Button>
          <Button variant="primary">Mittel 40</Button>
          <Button size="lg" variant="primary">
            Groß 48
          </Button>
          <Button icon="plus" variant="primary">
            Neues Spiel
          </Button>
          <Button icon="upload">Importieren</Button>
          <Button iconEnd="arrow-right">Weiter</Button>
          <Button icon="users" count={6}>
            Teams
          </Button>
          <Button block variant="secondary" style={{ maxWidth: 220 }}>
            Volle Breite
          </Button>
        </div>
        <div class="ds-stage ds-row">
          <IconButton label="Mehr" icon="more" />
          <IconButton label="Bearbeiten" icon="edit" variant="secondary" />
          <IconButton label="Löschen" icon="trash" variant="danger-quiet" />
          <IconButton label="Speichern" icon="save" variant="primary" />
          <IconButton label="Klein" icon="x" size="sm" />
          <IconButton label="Groß" icon="search" size="lg" variant="secondary" />
          <Button variant="primary" disabledReason="Es fehlen noch zwei Pflichtfelder.">
            Veröffentlichen
          </Button>
          <ButtonLink to="/events" icon="arrow-left">
            Als Link
          </ButtonLink>
          <div class="btn-group">
            <Button size="sm">Eins</Button>
            <Button size="sm">Zwei</Button>
            <Button size="sm">Drei</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Forms() {
  const [pw, setPw] = useState("geheim-geheim");
  const [radio, setRadio] = useState<"a" | "b" | "c">("b");
  const [seg, setSeg] = useState<"liste" | "karte">("liste");
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Feld mit Beschriftung, Hinweis und Fehler</h3>
        <div class="ds-stage ds-grid--wide ds-grid">
          <Field label="E-Mail">
            <Input type="email" placeholder="name@organisation.de" />
          </Field>
          <Field label="Spielname" hint="Erscheint auf dem Aushang und in der App.">
            <Input defaultValue="Nachtigall in Sieglar" />
          </Field>
          <Field label="Event-Code" required>
            <Input placeholder="6 Zeichen" />
          </Field>
          <Field label="Telefon der Spielleitung" optional>
            <Input type="tel" />
          </Field>
          <Field label="Passwort" error="Das Passwort ist zu kurz: mindestens 10 Zeichen.">
            <Input type="password" defaultValue="kurz" />
          </Field>
          <Field label="Passwort mit Auge" hint="Das Auge zeigt und verbirgt die Eingabe.">
            <Input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
          </Field>
          <Field label="Gesperrt">
            <Input disabled defaultValue="Nicht änderbar" />
          </Field>
          <Field label="Nur lesen">
            <Input readOnly defaultValue="Aus dem Spiel übernommen" />
          </Field>
          <Field label="Nach Prüfung gültig" hint="Der Server hat den Code bestätigt.">
            <Input ok defaultValue="4VMBZ5" />
          </Field>
          <Field label="Dauer">
            <Input type="number" suffix="min" defaultValue="100" />
          </Field>
          <Field label="Adresse">
            <Input prefix={<Icon name="globe" size={16} />} placeholder="lykora.example.org" />
          </Field>
          <Field label="Radius" hint="Einheit fest im Feld.">
            <Input type="number" suffix="m" prefix="r" defaultValue="40" />
          </Field>
        </div>
      </div>
      <div class="ds-block">
        <h3>Zustände eines Feldes</h3>
        <div class="ds-stage">
          <Matrix fit cols={6} head={["Standard", "Hover", "Fokus", "Ungültig", "Gesperrt", "Nur lesen"]}>
            <span class="ds-rowhead">Eingabe</span>
            <Input aria-label="Standard" defaultValue="Text" />
            <Input aria-label="Hover" class="is-hover" defaultValue="Text" />
            <Input aria-label="Fokus" class="is-focus" defaultValue="Text" />
            <Input aria-label="Ungültig" aria-invalid={true} defaultValue="Text" />
            <Input aria-label="Gesperrt" disabled defaultValue="Text" />
            <Input aria-label="Nur lesen" readOnly defaultValue="Text" />
            <span class="ds-rowhead">Auswahl</span>
            <Select aria-label="Standard" options={[{ value: "1", label: "Nacht" }]} />
            <Select aria-label="Hover" class="is-hover" options={[{ value: "1", label: "Nacht" }]} />
            <Select aria-label="Fokus" class="is-focus" options={[{ value: "1", label: "Nacht" }]} />
            <Select aria-label="Ungültig" aria-invalid={true} options={[{ value: "1", label: "Nacht" }]} />
            <Select aria-label="Gesperrt" disabled options={[{ value: "1", label: "Nacht" }]} />
            <span />
          </Matrix>
        </div>
      </div>
      <div class="ds-block">
        <h3>Textfeld und Auswahl</h3>
        <div class="ds-stage ds-grid--wide ds-grid">
          <Field label="Notiz" hint="Mehrzeilig, wächst nach unten.">
            <Textarea placeholder="Was ist passiert?" />
          </Field>
          <Field label="Altersgruppe">
            <Select
              options={[
                { value: "a", label: "10 bis 13 Jahre" },
                { value: "b", label: "14 bis 17 Jahre" },
                { value: "c", label: "Erwachsene" },
              ]}
            />
          </Field>
        </div>
      </div>
      <div class="ds-block">
        <h3>Haken, Radio, Schalter</h3>
        <div class="ds-stage">
          <Matrix cols={6} head={["Aus", "An", "Teilweise", "Fokus", "Gesperrt aus", "Gesperrt an"]}>
            <span class="ds-rowhead">Haken</span>
            <input type="checkbox" aria-label="Aus" />
            <input type="checkbox" aria-label="An" defaultChecked />
            <Checkbox label="" indeterminate aria-label="Teilweise" />
            <input type="checkbox" aria-label="Fokus" style={{ outline: "2px solid var(--focus)", outlineOffset: 2 }} defaultChecked />
            <input type="checkbox" aria-label="Gesperrt aus" disabled />
            <input type="checkbox" aria-label="Gesperrt an" disabled defaultChecked />
            <span class="ds-rowhead">Radio</span>
            <input type="radio" name="r1" aria-label="Aus" />
            <input type="radio" name="r2" aria-label="An" defaultChecked />
            <span />
            <input type="radio" name="r3" aria-label="Fokus" style={{ outline: "2px solid var(--focus)", outlineOffset: 2 }} defaultChecked />
            <input type="radio" name="r4" aria-label="Gesperrt aus" disabled />
            <input type="radio" name="r5" aria-label="Gesperrt an" disabled defaultChecked />
            <span class="ds-rowhead">Schalter</span>
            <input type="checkbox" role="switch" aria-label="Aus" />
            <input type="checkbox" role="switch" aria-label="An" defaultChecked />
            <span />
            <input type="checkbox" role="switch" aria-label="Fokus" style={{ outline: "2px solid var(--focus)", outlineOffset: 2 }} defaultChecked />
            <input type="checkbox" role="switch" aria-label="Gesperrt aus" disabled />
            <input type="checkbox" role="switch" aria-label="Gesperrt an" disabled defaultChecked />
          </Matrix>
        </div>
        <div class="ds-stage ds-grid--wide ds-grid">
          <div class="stack tight">
            <Checkbox label="Finale-Station" hint="Beendet das Spiel" />
            <Checkbox label="Abseits der Wege" defaultChecked />
            <Checkbox label="Gesperrt" disabled />
          </div>
          <RadioGroup
            legend="Sichtbarkeit"
            name="sicht"
            value={radio}
            onChange={setRadio}
            options={[
              { value: "a", label: "Immer sichtbar" },
              { value: "b", label: "Versteckt, bis ein Team in der Nähe ist", hint: "Pfeiltasten wechseln" },
              { value: "c", label: "Erst nach Freigabe", disabled: true },
            ]}
          />
          <div class="stack tight">
            <Switch label="Ton im Leitstand" defaultChecked />
            <Switch label="Benachrichtigungen" />
            <Radio name="solo" label="Einzelnes Radio" />
          </div>
          <div class="stack tight">
            <span class="ds-label">Segmentiert</span>
            <Segmented
              label="Ansicht"
              value={seg}
              onChange={setSeg}
              options={[
                { id: "liste", label: "Liste", icon: "list" },
                { id: "karte", label: "Karte", icon: "map" },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS: TabDef<string>[] = [
  { id: "teams", label: "Teams", count: 6 },
  { id: "funk", label: "Funk", count: 3, countClass: "on" },
  { id: "klang", label: "Klang" },
  { id: "pruefungen", label: "Prüfungen", count: 1, countClass: "safety" },
  { id: "rangliste", label: "Rangliste" },
  { id: "logbuch", label: "Logbuch" },
  { id: "gesperrt", label: "Gesperrt", disabled: true },
  { id: "mehr1", label: "Noch ein Reiter" },
  { id: "mehr2", label: "Und noch einer" },
];

interface Row {
  id: string;
  team: string;
  color: string;
  stations: number;
  points: number;
  state: "ok" | "warn" | "sos";
}

const ROWS: Row[] = [
  { id: "1", team: "Waschbären", color: "green", stations: 5, points: 420, state: "ok" },
  { id: "2", team: "Eulenwacht", color: "blue", stations: 4, points: 380, state: "sos" },
  { id: "3", team: "Dachse", color: "red", stations: 4, points: 350, state: "warn" },
  { id: "4", team: "Nachtfalter", color: "purple", stations: 2, points: 190, state: "ok" },
];

export function Surfaces() {
  const [tab, setTab] = useState("teams");
  const [sort, setSort] = useState<SortState | null>({ key: "points", dir: "desc" });
  const [selected, setSelected] = useState<string | null>("2");
  const [density, setDensity] = useState<"regular" | "compact">("regular");
  const rows = [...ROWS].sort((a, b) => {
    if (!sort) return 0;
    const k = sort.key as "points" | "stations" | "team";
    const d = sort.dir === "asc" ? 1 : -1;
    return a[k] < b[k] ? -d : a[k] > b[k] ? d : 0;
  });
  const columns: Column<Row>[] = [
    { key: "team", header: "Team", sortable: true, cell: (r) => <span class="row nowrap"><TeamDot color={r.color} id={r.id} /> <strong>{r.team}</strong></span> },
    { key: "stations", header: "Stationen", num: true, sortable: true, cell: (r) => `${r.stations} / 9` },
    { key: "points", header: "Punkte", num: true, sortable: true, cell: (r) => r.points },
    { key: "state", header: "Zustand", cell: (r) => (r.state === "sos" ? <Badge variant="safety">SOS</Badge> : r.state === "warn" ? <Badge variant="warn" dot>Akku schwach</Badge> : <Badge variant="ok" dot>Im Spiel</Badge>) },
    { key: "actions", header: "", actions: true, cell: () => <IconButton label="Mehr" icon="more" size="sm" /> },
  ];
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Reiter</h3>
        <p class="ds-note">Eine Zeile, seitlich scrollbar mit Randverlauf, nie zwei Zeilen. Pfeiltasten wechseln, Home und Ende springen, der gewählte Reiter ist der einzige Tabstopp.</p>
        <div class="ds-stage" style={{ maxWidth: 520 }}>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Leitstand" />
        </div>
      </div>
      <div class="ds-block">
        <h3>Karten</h3>
        <div class="ds-stage ds-stage--ground ds-grid--wide ds-grid">
          <Card>
            <SectionHeader title="Karte" level={3} description="Fläche, Rand, 12 px Radius." actions={<Button size="sm">Aktion</Button>} />
            <p>Inhalt der Karte. Höchstens zwei sichtbare Rahmenebenen.</p>
          </Card>
          <Card variant="raised">
            <h3>Erhöht</h3>
            <p>Unterkarte ohne Rahmen, nur Fläche.</p>
          </Card>
          <Card variant="interactive" as="a" href="#karten">
            <h3>Klickbar</h3>
            <p class="muted">Hover, gedrückt und Fokus wie ein Knopf.</p>
          </Card>
          <Card selected variant="interactive" as="a" href="#karten">
            <h3>Gewählt</h3>
            <p class="muted">Rand, Fläche und Haken, nicht nur Farbe.</p>
          </Card>
          <Card variant="safety">
            <h3 class="safety-title">Sicherheit</h3>
            <p>Absperrband nur für SOS, Rückruf und Sperrzonen.</p>
          </Card>
          <Panel title="Panel" actions={<Badge variant="info">Neu</Badge>}>
            <p>Fester Kopf, scrollender Körper; Container für Container-Queries.</p>
          </Panel>
        </div>
      </div>
      <div class="ds-block">
        <h3>Kennzahlen</h3>
        <div class="ds-stage">
          <StatGrid>
            <Stat label="Punkte" value="1.455" />
            <Stat label="Stationen" value="5" unit="/ 9" />
            <Stat label="Akku" value="14" unit="%" tone="warn" delta={{ text: "sinkt", icon: "arrow-down", tone: "warn" }} />
            <Stat label="Kontakt" value="2" unit="min" tone="ok" />
            <Stat label="SOS offen" value="1" tone="danger" />
          </StatGrid>
        </div>
      </div>
      <div class="ds-block">
        <h3>Tabelle</h3>
        <div class="ds-row">
          <Segmented
            label="Dichte"
            value={density}
            onChange={setDensity}
            options={[
              { id: "regular", label: "Regulär 44" },
              { id: "compact", label: "Kompakt 36" },
            ]}
          />
          <span class="ds-note">Sortieren per Kopf, Zeile wählen per Klick oder Enter. Schmaler als 560 px Behälterbreite werden Zeilen zu Karten: Ziehe unten am Rand.</span>
        </div>
        <div class="ds-resize">
          <DataTable
            caption="Rangliste der Teams"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            sort={sort}
            onSort={setSort}
            selectedKey={selected}
            onRowClick={(r) => setSelected(r.id)}
            density={density}
          />
        </div>
        <div class="ds-grid--wide ds-grid">
          <div class="ds-stage">
            <span class="ds-label">Lädt</span>
            <DataTable caption="Lädt" columns={columns} rows={[]} rowKey={(r) => r.id} loading />
          </div>
          <div class="ds-stage">
            <span class="ds-label">Leer</span>
            <DataTable caption="Leer" columns={columns} rows={[]} rowKey={(r) => r.id} empty={<EmptyState variant="inline" title="Noch keine Teams">Sobald ein Team beitritt, erscheint es hier.</EmptyState>} />
          </div>
        </div>
      </div>
      <div class="ds-block">
        <h3>Seitenkopf und Brotkrumen</h3>
        <div class="ds-stage">
          <PageHeader
            eyebrow="Baukasten"
            title="Nachtwanderung Sieglar"
            status={<StatusBadge status="running" />}
            description="Nachtigall in Sieglar · Version 1 · 6 Teams"
            breadcrumb={[{ label: "Events", to: "/events" }, { label: "Nachtwanderung Sieglar" }]}
            actions={
              <>
                <Button icon="pause">Pause</Button>
                <Button variant="safety" icon="flag">
                  Rückruf
                </Button>
                <Button variant="primary">Leitstand öffnen</Button>
              </>
            }
          />
          <Breadcrumb items={[{ label: "Spiele", to: "/spiele" }, { label: "Nachtigall", to: "/spiele" }, { label: "Station 3" }]} />
        </div>
      </div>
    </div>
  );
}

export function Badges() {
  const [chips, setChips] = useState(["Eule", "Igel", "Fuchs"]);
  const [on, setOn] = useState(true);
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Badges</h3>
        <p class="ds-note">Zustand eines Objekts. Status immer mit Text; Punkt ist ein Zusatz, kein Ersatz.</p>
        <div class="ds-stage ds-row">
          <Badge>Neutral</Badge>
          <Badge variant="accent" dot>
            Läuft
          </Badge>
          <Badge variant="ok" dot>
            Verbunden
          </Badge>
          <Badge variant="warn" dot>
            Pausiert
          </Badge>
          <Badge variant="danger" dot>
            Fehler
          </Badge>
          <Badge variant="info" dot>
            Hinweis
          </Badge>
          <Badge variant="safety">SOS</Badge>
          <Badge variant="recalled">Rückruf</Badge>
          <Badge dot="hollow">Geplant</Badge>
          <Badge keepCase>stimme-foersterin</Badge>
        </div>
        <div class="ds-stage ds-row">
          <span class="ds-label">Event-Status</span>
          <StatusBadge status="draft" />
          <StatusBadge status="running" />
          <StatusBadge status="paused" />
          <StatusBadge status="recalled" />
          <StatusBadge status="ended" />
          <span class="ds-label">Legacy</span>
          <span class="badge">Version 1</span>
          <span class="badge on">Gewählt</span>
          <span class="badge strong">Am Sammelpunkt</span>
          <span class="badge quiet">versteckt</span>
          <span class="badge safety">SOS</span>
        </div>
      </div>
      <div class="ds-block">
        <h3>Chips, Zähler, Punkte, Avatar</h3>
        <div class="ds-stage ds-row">
          <Chip>Etikett</Chip>
          <Chip selected={on} onClick={() => setOn(!on)}>
            Wählbar
          </Chip>
          <Chip size="sm">Klein</Chip>
          {chips.map((c) => (
            <Chip key={c} onRemove={() => setChips(chips.filter((x) => x !== c))} removeLabel={`${c} entfernen`}>
              {c}
            </Chip>
          ))}
          <Chip disabled>Gesperrt</Chip>
        </div>
        <div class="ds-stage ds-row">
          <Count value={6} />
          <Count value={3} tone="on" />
          <Count value={1} tone="safety" />
          <StatusDot tone="ok" /> Live
          <StatusDot tone="warn" /> Verbinde
          <StatusDot tone="danger" /> Getrennt
          <StatusDot tone="neutral" /> Unbekannt
          <Avatar name="Pfadfinder Hennef" tone="accent" />
          <Avatar name="Admin" />
          <Avatar name="Max Muster" size="sm" />
          <Avatar name="Org" size="lg" square />
          <span class="row nowrap">
            {["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink", "olive"].map((c) => (
              <TeamDot key={c} color={c === "teal" || c === "pink" || c === "olive" ? null : c} id={c === "teal" ? "x6" : c === "pink" ? "x2" : c === "olive" ? "x7" : c} />
            ))}
            <TeamDot color="red" id="s" stale />
          </span>
        </div>
      </div>
      <div class="ds-block">
        <h3>Kbd, Trenner</h3>
        <div class="ds-stage ds-row">
          <Kbd>Strg</Kbd>
          <Kbd>K</Kbd>
          <Divider vertical />
          <Kbd>Esc</Kbd>
          <span style={{ flex: 1, minWidth: 80 }}>
            <Divider />
          </span>
        </div>
      </div>
    </div>
  );
}

export function Feedback() {
  const [dlg, setDlg] = useState<null | "md" | "sheet" | "safety">(null);
  return (
    <div class="ds-content">
      <div class="ds-block">
        <h3>Hinweise</h3>
        <div class="ds-stage stack">
          <Notice status="info" title="Hinweis">
            Neue Version steht bereit. Sie wird beim nächsten Neuladen aktiv.
          </Notice>
          <Notice status="ok" title="Gespeichert">
            Alle Änderungen sind auf dem Server.
          </Notice>
          <Notice status="warn" title="Akku schwach" action={<Button size="sm">Nachricht</Button>}>
            Eulenwacht: Akku bei 14 %.
          </Notice>
          <Notice status="danger" title="Nicht gespeichert">
            Der Server antwortet nicht. Deine Änderungen bleiben auf diesem Gerät.
          </Notice>
          <ErrorNotice error={new Error("Altes Muster: Fehler mit Wiederholen.")} retry={() => notify("Neuer Versuch …")} />
          <div class="notice">Altes neutrales Muster ohne Symbol.</div>
        </div>
        <div class="ds-stage ds-stage--ground" style={{ padding: 0, overflow: "hidden" }}>
          <Banner status="warn" action={<Button size="sm">Neu laden</Button>} onClose={() => undefined}>
            Lykora wurde aktualisiert. Neu laden, um die neue Version zu nutzen.
          </Banner>
          <Banner status="danger">Verbindung getrennt. Letzter Kontakt vor 12 Sekunden.</Banner>
        </div>
      </div>
      <div class="ds-block">
        <h3>Meldungen</h3>
        <p class="ds-note">Stapel bis drei. Info und Erfolg 4 s, Warnung 8 s, Fehler bleibt. Hover und Fokus halten den Streifen an. Handy: oben mittig.</p>
        <div class="ds-stage ds-row">
          <Button onClick={() => notify("Meldung gesendet.", "info")}>Info</Button>
          <Button onClick={() => notify("Spiel veröffentlicht.", "ok")}>Erfolg</Button>
          <Button onClick={() => notify("Eulenwacht: Akku bei 14 %.", "warn")}>Warnung</Button>
          <Button onClick={() => notify("Speichern fehlgeschlagen.", "error")}>Fehler</Button>
          <Button onClick={() => notify("Station gelöscht.", "info", { action: { label: "Rückgängig", onClick: () => notify("Wiederhergestellt.", "ok") } })}>Mit Aktion</Button>
        </div>
      </div>
      <div class="ds-block">
        <h3>Dialoge</h3>
        <div class="ds-stage ds-row">
          <Button onClick={() => setDlg("md")}>Dialog</Button>
          <Button onClick={() => setDlg("sheet")}>Sheet</Button>
          <Button variant="safety" onClick={() => setDlg("safety")}>
            Sicherheitsdialog
          </Button>
          <Button
            onClick={() =>
              void confirm({ title: "Event beenden?", body: <p>Alle Teams sehen das Ende. Das lässt sich nicht zurücknehmen.</p>, confirm: "Beenden", danger: true, input: { label: "Notiz fürs Logbuch" } })
            }
          >
            Bestätigung
          </Button>
        </div>
        <Dialog
          open={dlg === "md"}
          title="Spiel umbenennen"
          description="Der Name erscheint auf Aushang und in der App."
          onClose={() => setDlg(null)}
          footer={
            <>
              <Button onClick={() => setDlg(null)}>Abbrechen</Button>
              <Button variant="primary" onClick={() => setDlg(null)}>
                Speichern
              </Button>
            </>
          }
        >
          <Field label="Name">
            <Input defaultValue="Nachtigall in Sieglar" />
          </Field>
        </Dialog>
        <Sheet open={dlg === "sheet"} title="Filter" onClose={() => setDlg(null)} footer={<Button variant="primary" onClick={() => setDlg(null)}>Anwenden</Button>}>
          <Checkbox label="Nur laufende Events" defaultChecked />
          <Checkbox label="Nur mit SOS" />
        </Sheet>
        <Dialog
          open={dlg === "safety"}
          title="Rückruf senden?"
          safety
          onClose={() => setDlg(null)}
          footer={
            <>
              <Button onClick={() => setDlg(null)}>Abbrechen</Button>
              <Button variant="safety" onClick={() => setDlg(null)}>
                Rückruf senden
              </Button>
            </>
          }
        >
          <p>Alle Teams bekommen sofort die Aufforderung, zum Sammelpunkt zu gehen.</p>
          <Field label="Grund (geht an alle Teams)">
            <Textarea />
          </Field>
        </Dialog>
      </div>
      <div class="ds-block">
        <h3>Menü, Popover, Tooltip</h3>
        <div class="ds-stage ds-row">
          <Menu
            label="Weitere Aktionen"
            align="start"
            items={[
              { id: "edit", label: "Bearbeiten", icon: "edit", shortcut: "E", onSelect: () => notify("Bearbeiten") },
              { id: "copy", label: "Duplizieren", icon: "copy", onSelect: () => notify("Dupliziert") },
              { id: "dis", label: "Archivieren", icon: "download", disabled: true },
              { type: "separator" },
              { id: "del", label: "Löschen", icon: "trash", danger: true, onSelect: () => notify("Gelöscht", "warn") },
            ]}
          />
          <Menu
            label="Ansicht"
            variant="secondary"
            items={[
              { type: "heading", label: "Thema" },
              { id: "n", label: "Nacht", checked: true },
              { id: "t", label: "Tag", checked: false },
              { id: "s", label: "System", checked: false },
            ]}
          >
            Ansicht
          </Menu>
          <Popover trigger={<><Icon name="filter" size={16} /> Filter</>} label="Filter">
            <div class="stack tight" style={{ minWidth: 220 }}>
              <Checkbox label="Nur laufende" defaultChecked />
              <Checkbox label="Nur mit SOS" />
            </div>
          </Popover>
          <Tooltip text="Speichert den Entwurf">
            <Button>Mit Tooltip</Button>
          </Tooltip>
          <IconButton label="Hilfe" icon="help" />
        </div>
      </div>
      <div class="ds-block">
        <h3>Laden und Fortschritt</h3>
        <div class="ds-stage ds-row">
          <Spinner size={16} />
          <Spinner />
          <Spinner size={24} />
          <Loading text="Lädt Teams …" />
        </div>
        <div class="ds-stage ds-grid--wide ds-grid">
          <div class="stack">
            <Progress value={4} max={9} label="Stationen" />
            <Progress value={9} max={9} label="Stationen" />
            <Progress value={0} max={9} label="Stationen" />
          </div>
          <div class="ds-row">
            <ProgressRing value={3} max={9} label="Stationen" />
            <ProgressRing value={9} max={9} label="Stationen" />
          </div>
          <SkeletonRows rows={3} />
          <SkeletonCard />
        </div>
        <div class="ds-stage ds-row">
          <Skeleton width="120px" />
          <Skeleton shape="circle" />
          <Skeleton shape="block" width="200px" />
        </div>
      </div>
      <div class="ds-block">
        <h3>Leer und Fehler</h3>
        <div class="ds-stage ds-grid--wide ds-grid">
          <EmptyState icon="calendar" title="Noch keine Events" action={<Button variant="primary" icon="plus">Event anlegen</Button>}>
            Lege ein Event an und lade Teams per Code ein.
          </EmptyState>
          <ErrorState error={new Error("Server antwortet nicht (Zeitüberschreitung).")} retry={() => notify("Neuer Versuch …")} details={"GET /events\n504 Gateway Timeout"} />
        </div>
      </div>
    </div>
  );
}
