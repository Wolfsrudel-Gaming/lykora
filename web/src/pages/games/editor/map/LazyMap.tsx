/**
 * Paket B: Die Karte (EditorMap mit Leaflet) kommt erst beim Anzeigen als eigener Chunk – Bereiche,
 * Übersicht und Vor-Ort-Seite laden ohne Leaflet und zeigen bis dahin einen leeren Kartenrahmen.
 */

import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { EditorMapProps } from "./EditorMap.tsx";

let loaded: ComponentType<EditorMapProps> | null = null;

export function useEditorMap(): ComponentType<EditorMapProps> | null {
  const [comp, setComp] = useState<ComponentType<EditorMapProps> | null>(() => loaded);
  useEffect(() => {
    if (comp) return;
    let alive = true;
    void import("./EditorMap.tsx").then((m) => {
      loaded = m.EditorMap;
      if (alive) setComp(() => m.EditorMap);
    });
    return () => {
      alive = false;
    };
  }, []);
  return comp;
}

/** Karte oder, solange sie lädt, ein leerer Rahmen in derselben Größe. */
export function LazyEditorMap(props: EditorMapProps) {
  const Map = useEditorMap();
  return Map ? <Map {...props} /> : <div class={`map-wrap ed-map-wrap${props.class ? ` ${props.class}` : ""}`} aria-busy="true" />;
}
