import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ErrorNotice, Loading } from "./components.tsx";

/** Lädt eine Seite erst bei Bedarf nach (eigener Chunk), z. B. den Leitstand mit Karte. */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  return function LazyPage(props: P) {
    const [Comp, setComp] = useState<ComponentType<P> | null>(() => loaded);
    const [error, setError] = useState<unknown>(null);
    useEffect(() => {
      if (Comp) return;
      pending ??= load().then((c) => (loaded = c));
      pending.then((c) => setComp(() => c)).catch((e) => {
        pending = null;
        setError(e);
      });
    }, [Comp]);
    if (error) return <ErrorNotice error={new Error("Seite konnte nicht geladen werden. Netz prüfen und neu laden.")} retry={() => location.reload()} />;
    return Comp ? <Comp {...props} /> : <Loading />;
  };
}
