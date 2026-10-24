/** Aufbau: Container, Stack, Cluster, Karte, Panel, Abschnitts- und Seitenkopf, Kennzahl, Brotkrumen, Kleinteile. */

import type { ComponentChildren, JSX } from "preact";
import { Icon, Lantern, type IconName } from "./icons.tsx";
import { Link } from "./Link.tsx";

type Tag = keyof JSX.IntrinsicElements;

/** Seitenbreite: schmal 640 (Formulare), Seite 1120, breit 1440 (Leitstand, Baukasten). */
export function Container({ width = "page", as: As = "div", class: cls, children }: { width?: "narrow" | "page" | "wide"; as?: Tag; class?: string; children: ComponentChildren }) {
  const Comp = As as "div";
  return <Comp class={`container${width === "page" ? "" : ` container--${width}`}${cls ? ` ${cls}` : ""}`}>{children}</Comp>;
}

/** Senkrechter Stapel mit Abstand aus dem Raster (gap 1 bis 8 = 4 bis 32 px). */
export function Stack({ gap = 3, as: As = "div", class: cls, children }: { gap?: 1 | 2 | 3 | 4 | 6 | 8; as?: Tag; class?: string; children: ComponentChildren }) {
  const Comp = As as "div";
  return <Comp class={`stack stack--${gap}${cls ? ` ${cls}` : ""}`}>{children}</Comp>;
}

/** Waagerechte Reihe, die umbricht. */
export function Cluster({ gap = 2, justify, class: cls, children }: { gap?: 1 | 2 | 3 | 4; justify?: "end" | "between"; class?: string; children: ComponentChildren }) {
  const style = { gap: `var(--space-${gap})` } as JSX.CSSProperties;
  return (
    <div class={`cluster${justify ? ` row ${justify}` : ""}${cls ? ` ${cls}` : ""}`} style={style}>
      {children}
    </div>
  );
}

/** Nur für Screenreader sichtbar. */
export function VisuallyHidden({ children, as: As = "span" }: { children: ComponentChildren; as?: Tag }) {
  const Comp = As as "span";
  return <Comp class="visually-hidden">{children}</Comp>;
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return <hr class={`divider${vertical ? " divider--vertical" : ""}`} aria-orientation={vertical ? "vertical" : undefined} />;
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}

// Flächen

export type CardVariant = "default" | "flat" | "raised" | "interactive" | "selected" | "safety";

/** Karte. Höchstens zwei sichtbare Rahmenebenen: innen mit `raised` und Abstand gliedern. */
export function Card({
  variant = "default",
  as: As = "section",
  selected,
  class: cls,
  children,
  ...rest
}: { variant?: CardVariant; as?: Tag; selected?: boolean; class?: string; children: ComponentChildren } & Omit<JSX.AllHTMLAttributes<HTMLElement>, "class" | "children" | "as">) {
  const Comp = As as "section";
  const names = ["card", variant !== "default" && `card--${variant}`, selected && "card--selected", cls].filter(Boolean).join(" ");
  return (
    <Comp {...(rest as JSX.HTMLAttributes<HTMLElement>)} class={names}>
      {selected && <Icon name="check-circle" size={20} class="card__check" />}
      {children}
    </Comp>
  );
}

/** Kopf einer Karte oder eines Abschnitts: Titel links, Aktionen rechts. */
export function SectionHeader({ title, description, actions, level = 2, id }: { title: string; description?: ComponentChildren; actions?: ComponentChildren; level?: 2 | 3; id?: string }) {
  const H = `h${level}` as "h2";
  return (
    <div class="section-head">
      <div>
        <H id={id}>{title}</H>
        {description && <p>{description}</p>}
      </div>
      {actions && <div class="row">{actions}</div>}
    </div>
  );
}

/** Panel: fester Kopf, scrollender Körper; Container für Container-Queries (Rangliste, Teamzeile, Kennzahlen). */
export function Panel({ title, actions, children, class: cls }: { title: string; actions?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`ui-panel${cls ? ` ${cls}` : ""}`}>
      <header class="ui-panel__head">
        <h2 class="t-subhead">{title}</h2>
        {actions && <div class="row">{actions}</div>}
      </header>
      <div class="ui-panel__body">{children}</div>
    </section>
  );
}

/** Kennzahl-Kachel: Beschriftung oben, Wert groß in Mono, Farbe nur am Wert. */
export function Stat({ label, value, unit, tone, delta }: { label: string; value: ComponentChildren; unit?: string; tone?: "ok" | "warn" | "danger"; delta?: { text: string; icon?: IconName; tone?: "ok" | "warn" | "danger" } }) {
  return (
    <div class={`stat${tone ? ` stat--${tone}` : ""}`}>
      <span class="stat__label">{label}</span>
      <span class="stat__value">
        {value}
        {unit && <span class="stat__unit">{unit}</span>}
      </span>
      {delta && (
        <span class={`stat__delta${delta.tone ? ` stat__delta--${delta.tone}` : ""}`}>
          {delta.icon && <Icon name={delta.icon} size={16} />}
          {delta.text}
        </span>
      )}
    </div>
  );
}

export function StatGrid({ children }: { children: ComponentChildren }) {
  return <div class="stat-grid">{children}</div>;
}

// Kopf

export interface Crumb {
  label: string;
  to?: string;
}

/** Brotkrumen: das letzte Glied ist die aktuelle Seite (kein Link). */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav class="breadcrumb" aria-label="Pfad">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {c.to && !last ? <Link to={c.to}>{c.label}</Link> : <span aria-current={last ? "page" : undefined}>{c.label}</span>}
              {!last && <Icon name="chevron-right" size={16} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Seitenkopf: Eyebrow, Titel (h1) mit Status direkt daneben, Beschreibung, Aktionen rechts (Hauptaktion ganz rechts).
 * Die h1 liegt immer an der linken Kante des Containers.
 */
export function PageHeader({
  title,
  eyebrow,
  status,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  eyebrow?: string;
  /** Status oder Badge direkt am Titel */
  status?: ComponentChildren;
  description?: ComponentChildren;
  breadcrumb?: Crumb[];
  actions?: ComponentChildren;
}) {
  return (
    <header class="page-header">
      <div class="page-header__main">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        {eyebrow && <span class="eyebrow">{eyebrow}</span>}
        <div class="page-header__title">
          <h1>{title}</h1>
          {status}
        </div>
        {description && <p class="page-header__desc">{description}</p>}
      </div>
      {actions && <div class="page-header__actions">{actions}</div>}
    </header>
  );
}

/** Kopfzeile der Ausdrucke: Signet einfarbig, Titel, Datum; nur im Druck sichtbar. */
export function PrintHeader({ title, subtitle, date = new Date() }: { title: string; subtitle?: string; date?: Date }) {
  return (
    <div class="print-head">
      <span class="print-head__brand">
        <Lantern mono />
        Lykora
      </span>
      <span class="print-head__meta">
        <strong>{title}</strong>
        {subtitle && <> · {subtitle}</>}
        <br />
        {date.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })}
      </span>
    </div>
  );
}
