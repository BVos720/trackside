/**
 * Media byte storage for the web preview — spec §2.4.
 *
 * ── What this deliberately does NOT do ─────────────────────────────────────
 * It does not put image bytes in the key/value store. Spec §2.4 is explicit
 * that media bytes never go in the database — it is very hard to undo and
 * becomes fatal once video is involved — so the `Media` row holds only a
 * `storageKey` and the bytes live here, behind the port.
 *
 * The honest consequence on web: blob URLs are per-document, so images picked
 * in the browser survive until reload and no further. That is the correct
 * trade for a preview target. The device implementation writes to
 * expo-file-system and persists properly; the `Media` rows are identical either
 * way, which is the point of the abstraction.
 */
export interface ILocalMediaStore {
  put(file: Blob, contentType: string): Promise<string>;
  getUri(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /** Delete every stored photo. Only `resetApp.ts` calls this. */
  clear(): Promise<void>;
  /** True when bytes survive an app restart. False here; true on device. */
  readonly durable: boolean;
}

const blobs = new Map<string, string>();
let counter = 0;

export const mediaStore: ILocalMediaStore = {
  durable: false,

  async put(file) {
    // Key, not a URL. The row must never contain a blob: URL — those are
    // meaningless in another session and would sync as garbage.
    const key = `web-media-${Date.now()}-${counter++}`;
    blobs.set(key, URL.createObjectURL(file));
    return key;
  },

  async getUri(key) {
    return blobs.get(key) ?? null;
  },

  async delete(key) {
    const url = blobs.get(key);
    if (url) URL.revokeObjectURL(url);
    blobs.delete(key);
  },

  async clear() {
    // Revoke before dropping the map, or every object URL leaks for the rest
    // of the session.
    for (const url of blobs.values()) URL.revokeObjectURL(url);
    blobs.clear();
  },
};
