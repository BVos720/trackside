/**
 * Media byte storage on device — spec §2.4.
 *
 * Bytes live on the filesystem under app storage; the `Media` row holds only
 * the key. Object storage (S3/R2) replaces this later with no change above
 * `storage-local/`.
 *
 * ── Deliberately not implemented yet ───────────────────────────────────────
 * Photo capture on device needs expo-image-picker and expo-file-system, plus
 * the EXIF handling spec §5.1 requires: parse coordinates to help place the
 * pin, keep the untouched original local-only, and strip all metadata before
 * anything is exposed beyond the device. Reference photos are the largest
 * privacy surface in this app (§9.4), so that path is written deliberately
 * rather than stubbed out and forgotten.
 *
 * Until then this throws rather than silently returning a key that resolves to
 * nothing — a fake success here would look like a broken gallery much later.
 */
export interface ILocalMediaStore {
  put(file: Blob, contentType: string): Promise<string>;
  getUri(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  readonly durable: boolean;
}

const NOT_IMPLEMENTED =
  'On-device media storage is not implemented yet — see src/storage-local/mediaStore.ts';

export const mediaStore: ILocalMediaStore = {
  durable: true,

  async put() {
    throw new Error(NOT_IMPLEMENTED);
  },
  async getUri() {
    return null;
  },
  async delete() {
    // No-op: nothing has been written yet, so nothing can be removed.
  },
};
