/**
 * Web implementation of the key/value port — see kv.ts for why it exists.
 *
 * Backed by localStorage. Metro picks this file over `kv.ts` for the web
 * target, which keeps expo-sqlite's WASM build out of the browser bundle.
 *
 * Async despite localStorage being synchronous, per spec §2.3 constraint 2: the
 * signature has to match the port so calling code never learns which target it
 * is on, and so the UI is already written against latency.
 */
export interface IKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Delete every key. Only `resetApp.ts` calls this. */
  clear(): Promise<void>;
}

/** Guards against private-mode Safari, where localStorage throws on write. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const kv: IKeyValueStore = {
  async get(key) {
    return storage()?.getItem(key) ?? null;
  },
  async set(key, value) {
    try {
      storage()?.setItem(key, value);
    } catch {
      // Quota exceeded or storage disabled. Losing a write is bad, but throwing
      // here would take the map screen down with it; the caller keeps its
      // in-memory copy either way.
    }
  },
  async remove(key) {
    storage()?.removeItem(key);
  },
  async clear() {
    // Everything this app writes lives under its own origin, so clearing the
    // lot is the same wipe the device store performs. Nothing else shares it.
    try {
      storage()?.clear();
    } catch {
      // Storage disabled. Nothing was stored, so nothing needs clearing.
    }
  },
};
