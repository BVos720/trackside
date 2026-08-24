/**
 * Choosing a photo — web.
 *
 * A file input, and no resize. The native sibling downscales because phone
 * storage is finite and the originals are enormous; the browser preview holds
 * blobs in memory for one session (see mediaStore.web.ts) and they are gone on
 * reload, so there is nothing to save by shrinking them.
 */
export interface PickedImage {
  readonly blob: Blob;
  readonly contentType: string;
  readonly previewUri: string;
  /**
   * Whether the returned bytes are known to carry no EXIF block. Always false
   * here — see the note at the return below. Kept in step with the native
   * sibling's field so callers do not have to know which platform they are on.
   */
  readonly metadataStripped: boolean;
}

export const IMAGE_PICKER_SUPPORTED = true;

/** Null when the user backed out of the dialog. */
export async function pickImage(): Promise<PickedImage | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;

  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        blob: file,
        contentType: file.type || 'image/jpeg',
        previewUri: URL.createObjectURL(file),
        /*
         * The file is handed through untouched, so its EXIF is intact.
         *
         * Web has no equivalent of the native re-encode: the bytes reach the
         * media store exactly as the browser handed them over, GPS and
         * timestamp included. That is survivable only because nothing is
         * served beyond the device yet, and because this flag is what a share
         * path checks before it is (§5.1, §9.4).
         *
         * A canvas round trip would strip it — draw, then read back through
         * `toBlob` — and is the obvious fix when a sharing path is built.
         * Claiming the strip before writing it would be worse than not having
         * it at all, because the flag would then read "safe to publish".
         */
        metadataStripped: false,
      });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
