// jsdom has no `matchMedia`: a stand-in whose matching queries the tests set.
type Listener = () => void;

const matching = new Set<string>();
const listeners = new Map<string, Set<Listener>>();

/** Makes a media query match or not, and tells its listeners. */
export function setMedia(query: string, matches: boolean): void {
  if (matching.has(query) === matches) return;
  if (matches) matching.add(query);
  else matching.delete(query);
  for (const listener of listeners.get(query) ?? []) listener();
}

export function resetMedia(): void {
  for (const query of [...matching]) setMedia(query, false);
}

export function installMedia(): void {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return matching.has(query);
      },
      addEventListener: (_type: string, listener: Listener) => {
        const set = listeners.get(query) ?? new Set();
        set.add(listener);
        listeners.set(query, set);
      },
      removeEventListener: (_type: string, listener: Listener) => {
        listeners.get(query)?.delete(listener);
      },
    }) as unknown as MediaQueryList;
}
