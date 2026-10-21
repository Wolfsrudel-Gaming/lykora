import { useEffect, useState } from "preact/hooks";

/** Kleiner Zustandsbehälter mit Abonnenten, ohne Framework. */
export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((prev: T) => Partial<T>)): void;
  subscribe(fn: (state: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<(state: T) => void>();
  return {
    get: () => state,
    set(next) {
      const patch = typeof next === "function" ? next(state) : next;
      state = { ...state, ...patch };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  const [state, setState] = useState(store.get());
  useEffect(() => {
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);
  return state;
}
