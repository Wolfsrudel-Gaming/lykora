/**
 * Lagekarte mit Leaflet und den Kacheln des Spiels (settings.map.tiles, sonst OSM): Spielfeld, Sperrzonen, Stationen, Sammel- und
 * Rettungspunkte, Teams mit Genauigkeitskreis, SOS-Orte und die Laufspur eines Teams.
 * Eigener Chunk, damit Leaflet nur im Leitstand geladen wird.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import { useEffect, useRef } from "preact/hooks";
import { formatAgo, text } from "../../lib/format.ts";
import { areaBounds } from "../../lib/game.ts";
import { setBaseTiles } from "../../lib/map-tiles.ts";
import type { Game, OverviewTeam, Sos, TrackPoint } from "../../lib/types.ts";
import { teamColor } from "../../ui/components.tsx";

export interface MapProps {
  game: Game | null;
  teams: OverviewTeam[];
  sos: Sos[];
  selected: string | null;
  track: TrackPoint[] | null;
  /** Karte auf diesen Punkt setzen; key ändert sich bei jedem neuen Wunsch */
  focus: { lat: number; lon: number; key: number } | null;
  onSelect: (teamId: string) => void;
}

type Area = Game["field"]["boundary"];
type Trigger = Game["stations"][number]["triggers"][number];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function drawArea(area: Area, options: L.PathOptions): L.Path {
  return "polygon" in area ? L.polygon(area.polygon.map((p) => [p.lat, p.lon] as L.LatLngTuple), options) : L.circle([area.center.lat, area.center.lon], { ...options, radius: area.radius });
}

/** Positionen gelten nach fünf Minuten als alt und werden blass. */
const STALE_MS = 5 * 60_000;

export function MapView({ game, teams, sos, selected, track, focus, onSelect }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ field: L.LayerGroup; teams: L.LayerGroup; track: L.LayerGroup; sos: L.LayerGroup } | null>(null);
  const fitted = useRef(false);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 19 });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    setBaseTiles(m, undefined);
    m.setView([51.16, 10.45], 6);
    layers.current = {
      field: L.layerGroup().addTo(m),
      track: L.layerGroup().addTo(m),
      teams: L.layerGroup().addTo(m),
      sos: L.layerGroup().addTo(m),
    };
    map.current = m;
    // Der Kartenbereich ändert seine Größe mit dem Layout (Reiter, Fenster, Drehen).
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  // Kacheln des Spiels (eigenes Kartenpaket des Servers oder fremde Adresse), sonst OpenStreetMap
  const tiles = game?.settings?.map?.tiles;
  useEffect(() => {
    if (map.current) setBaseTiles(map.current, tiles);
  }, [tiles]);

  // Spielfeld, Sperrzonen, Stationen, Sammel- und Rettungspunkte
  useEffect(() => {
    const m = map.current;
    const group = layers.current?.field;
    if (!m || !group) return;
    group.clearLayers();
    if (!game) return;
    const lang = game.meta.languages[0] ?? "de";
    drawArea(game.field.boundary, { className: "lf-boundary", interactive: false, fill: false }).addTo(group);
    for (const zone of game.field.restrictedZones ?? []) {
      drawArea(zone.area, { className: "lf-zone" })
        .bindTooltip(`Sperrzone: ${esc(text(zone.name, lang) || zone.id)}`, { sticky: true })
        .addTo(group);
    }
    game.stations.forEach((s, i) => {
      const gps = s.triggers.find((t): t is Extract<Trigger, { type: "gps" }> => t.type === "gps");
      const loc = s.location ?? gps?.location;
      if (!loc) return;
      const name = text(s.name, lang) || s.id;
      const cls = `mk-station${s.final ? " final" : ""}${s.visibility === "hidden" ? " hidden" : ""}`;
      L.marker([loc.lat, loc.lon], {
        icon: L.divIcon({ className: cls, html: `<span>${s.final ? "★" : i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: `Station ${i + 1}: ${name}`,
        alt: `Station ${name}`,
        keyboard: false,
      })
        .bindTooltip(esc(name), { direction: "top", offset: [0, -12] })
        .addTo(group);
    });
    const ap = game.field.assemblyPoint;
    L.marker([ap.location.lat, ap.location.lon], {
      icon: L.divIcon({ className: "mk-assembly", html: ASSEMBLY_SVG, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: `Sammelpunkt: ${text(ap.name, lang) || "Sammelpunkt"}`,
      keyboard: false,
      zIndexOffset: 500,
    })
      .bindTooltip(`Sammelpunkt: ${esc(text(ap.name, lang) || "Sammelpunkt")}`, { direction: "top", offset: [0, -14] })
      .addTo(group);
    for (const rp of game.field.rescuePoints ?? []) {
      L.marker([rp.location.lat, rp.location.lon], {
        icon: L.divIcon({ className: "mk-rescue", html: RESCUE_SVG, iconSize: [24, 24], iconAnchor: [12, 12] }),
        title: `Rettungspunkt: ${text(rp.name, lang)}`,
        keyboard: false,
      })
        .bindTooltip(`Rettungspunkt: ${esc(text(rp.name, lang) || rp.id || "")}`, { direction: "top", offset: [0, -12] })
        .addTo(group);
    }
    if (!fitted.current) {
      m.fitBounds(areaBounds(game.field.boundary), { padding: [24, 24] });
      fitted.current = true;
    }
  }, [game]);

  // Teams
  useEffect(() => {
    const m = map.current;
    const group = layers.current?.teams;
    if (!m || !group) return;
    group.clearLayers();
    const now = Date.now();
    const placed: L.LatLngTuple[] = [];
    for (const t of teams) {
      if (!t.position) continue;
      const color = teamColor(t.color, t.id);
      const ll: L.LatLngTuple = [t.position.lat, t.position.lon];
      placed.push(ll);
      const stale = t.position.at ? now - Date.parse(t.position.at) > STALE_MS : false;
      const sos = t.openSos > 0;
      if (t.position.accuracy) {
        L.circle(ll, { radius: t.position.accuracy, className: "lf-accuracy", color, weight: 1, fillColor: color, fillOpacity: 0.08, interactive: false }).addTo(group);
      }
      const cls = `mk-team${sos ? " sos" : ""}${stale ? " stale" : ""}${t.id === selected ? " selected" : ""}`;
      const label = `${esc(t.name)}${sos ? ' <b class="mk-sos">SOS</b>' : ""}${stale && t.position.at ? ` <i>${esc(formatAgo(t.position.at, now))}</i>` : ""}`;
      L.marker(ll, {
        icon: L.divIcon({ className: cls, html: `<span class="mk-dot" style="background:${color}"></span><span class="mk-label">${label}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
        title: `Team ${t.name}`,
        alt: `Team ${t.name}`,
        riseOnHover: true,
        zIndexOffset: sos ? 2000 : t.id === selected ? 1000 : 0,
      })
        // Leaflet meldet auch die Eingabetaste auf dem fokussierten Marker als click.
        .on("click", () => select.current(t.id))
        .addTo(group);
    }
    // Ohne Spielfeld (Rolle ohne Prüfrecht) die Teams ins Bild holen.
    if (!fitted.current && !game && placed.length) {
      m.fitBounds(L.latLngBounds(placed), { padding: [40, 40], maxZoom: 17 });
      fitted.current = true;
    }
  }, [teams, selected]);

  // Offene SOS an ihrem gemeldeten Ort
  useEffect(() => {
    const group = layers.current?.sos;
    if (!group) return;
    group.clearLayers();
    for (const s of sos) {
      if (s.resolved_at || s.lat === null || s.lon === null) continue;
      if (s.accuracy) L.circle([s.lat, s.lon], { radius: s.accuracy, className: "lf-sos-area", interactive: false }).addTo(group);
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: "mk-sos-point", html: `<span>SOS</span><span class="mk-label">${esc(s.team_name)}</span>`, iconSize: [44, 24], iconAnchor: [22, 12] }),
        title: `SOS von ${s.team_name}`,
        zIndexOffset: 3000,
      })
        .on("click", () => select.current(s.team_id))
        .addTo(group);
    }
  }, [sos]);

  // Laufspur
  useEffect(() => {
    const group = layers.current?.track;
    if (!group) return;
    group.clearLayers();
    if (!track?.length) return;
    const team = teams.find((t) => t.id === selected);
    const color = team ? teamColor(team.color, team.id) : "#F2A33A";
    const line = track.map((p) => [p.lat, p.lon] as L.LatLngTuple);
    L.polyline(line, { className: "lf-track", color, weight: 4, opacity: 0.9 }).addTo(group);
    L.circleMarker(line[0]!, { radius: 5, className: "lf-track-start", color, fillColor: color, fillOpacity: 1, weight: 2 })
      .bindTooltip("Beginn der Spur")
      .addTo(group);
  }, [track, selected]);

  useEffect(() => {
    if (focus && map.current) map.current.setView([focus.lat, focus.lon], Math.max(map.current.getZoom(), 17));
  }, [focus?.key]);

  return (
    <div class="map-wrap">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
        <defs>
          <pattern id="lyk-tape" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="16" fill="#C8201A" />
            <rect x="8" width="8" height="16" fill="#FFFFFF" />
          </pattern>
        </defs>
      </svg>
      <div ref={el} class="map" role="region" aria-label="Lagekarte" />
    </div>
  );
}

const ASSEMBLY_SVG =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="3" fill="#00843D" stroke="#fff" stroke-width="2"/><path d="M14 5v5M14 18v5M5 14h5M18 14h5M11 8l3-3 3 3M11 20l3 3 3-3M8 11l-3 3 3 3M20 11l3 3-3 3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="2.5" fill="#fff"/></svg>';
const RESCUE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#00843D" stroke="#fff" stroke-width="2"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="4"/></svg>';
