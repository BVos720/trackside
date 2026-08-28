/**
 * Media byte storage on device — spec §2.4.
 *
 * Bytes live on the filesystem under app storage; the `Media` row holds only
 * the key. Object storage (S3/R2) replaces this later with no change above
 * `storage-local/`.
 *
 * ── The row holds a key, never a URI ──────────────────────────────────────
 * The obvious shortcut is to store the picker's `file://` URI in the row and
 * skip the copy. It does not survive: the picker hands back a path in the
 * cache directory, which Android reclaims whenever it wants the space — so the
 * gallery works all weekend and is empty a fortnight later, with no error
 * anywhere to explain it. An absolute device path is also meaningless on any
 * other device, so it would sync as garbage. Copying into our own directory
 * under a key we mint is what makes the bytes ours.
 *
 * ── On EXIF, §5.1 and §9.4 ────────────────────────────────────────────────
 * §5.1 asks for the untouched original to be kept local-only, with all metadata
 * stripped before anything is exposed beyond the device. What is stored here is
 * *not* the untouched original: photos are downscaled at the picker
 * (pickImage.ts) to 1600px on the long edge, a deliberate reversal argued
 * there — full resolution is deferred to a backend rather than abandoned.
 *
 * A useful side effect: re-encoding to JPEG through the manipulator drops the
 * EXIF block, so the stored copy carries no embedded coordinates or timestamps.
 * That is a consequence of resizing, not a privacy control, and must not be
 * relied on as one — the resize is skipped for images already under the limit,
 * so a small photo keeps its metadata intact.
 *
 * A real strip is deliberately absent rather than half-done: nothing in this
 * app can yet expose a photo beyond the device — no account, no sync, no share,
 * every spot `Visibility.Private` — so a strip written now could not be tested
 * against the thing it exists to protect against. **It must exist before the
 * first sharing path does.** Reference photos are the largest privacy surface
 * here: a known place, a known time, and usually the coordinates in the file.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { base64FromDataUrl, base64ToBytes } from './pdfBase64';

export interface ILocalMediaStore {
  put(file: Blob, contentType: string): Promise<string>;
  getUri(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /**
   * Delete every stored photo.
   *
   * Only `resetApp.ts` calls this. Removes the directory wholesale rather
   * than walking keys, because the rows that name those keys are being wiped
   * in the same breath — anything left behind would be bytes nothing can ever
   * refer to again.
   */
  clear(): Promise<void>;
  /** True when bytes survive an app restart. */
  readonly durable: boolean;
}

/** Where photos live, relative to the document directory. */
const FOLDER = 'media';

function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Guess a file extension from the content type.
 *
 * For human legibility only — nothing reads it back, the key is the identifier.
 * It is carried so that a directory of photos is browsable in a file manager
 * rather than a wall of extensionless names.
 */
function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('heic') || contentType.includes('heif')) return 'heic';
  return 'jpg';
}

export const mediaStore: ILocalMediaStore = {
  durable: true,

  async put(file, contentType) {
    /*
     * A random suffix, not a counter.
     *
     * Two photos attached within the same millisecond is entirely normal — the
     * picker returns several at once and they are written in a loop — and a
     * timestamp alone would let the second silently overwrite the first. The
     * same bug the event bundle filenames had, invisible until the day it
     * costs you a picture.
     */
    const key = `media-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}.${extensionFor(contentType)}`;

    /*
     * FileReader, because React Native has no Blob.arrayBuffer().
     *
     * This line used to be
     *
     *   const bytes = new Uint8Array(await file.arrayBuffer());
     *
     * and it threw every single time. RN implements a deliberately minimal
     * Blob — size, type, slice(), and nothing more — so arrayBuffer is simply
     * undefined. A reference photo has therefore never been saved on a phone;
     * it worked on web only because mediaStore.web.ts keeps blobs in memory
     * and never reads their bytes at all.
     *
     * It surfaced as "the preview shows the photo and Save does nothing",
     * which sent us looking at iCloud. The iCloud fix was needed too — the
     * picker refuses to download from it by default — but it was never going
     * to be enough on its own, because the bytes had nowhere to go.
     *
     * FileReader is the route RN does support. A data URL costs a base64
     * round trip, which for a 1600px JPEG at quality 0.7 is a few hundred
     * kilobytes — worth it to write a file that exists.
     */
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the picked photo.'));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });

    const base64 = base64FromDataUrl(dataUrl);
    if (base64 === null) {
      throw new Error('The picked photo came back in an unreadable form.');
    }

    const bytes = base64ToBytes(base64);
    if (bytes.byteLength === 0) {
      // A zero-length write would leave a file that exists and cannot be
      // decoded, which every reader treats as present. Worse than missing.
      throw new Error('The picked photo was empty.');
    }
    const target = new File(mediaDirectory(), key);
    if (!target.exists) target.create();
    target.write(bytes);

    return key;
  },

  async getUri(key) {
    try {
      const target = new File(mediaDirectory(), key);
      return target.exists ? target.uri : null;
    } catch {
      // A missing file is a missing picture, not a crash: the gallery shows
      // "no preview" and the rest of the spot still opens.
      return null;
    }
  },

  async delete(key) {
    try {
      const target = new File(mediaDirectory(), key);
      if (target.exists) target.delete();
    } catch {
      // Already gone is the outcome we wanted.
    }
  },

  async clear() {
    try {
      const dir = new Directory(Paths.document, FOLDER);
      if (dir.exists) dir.delete();
    } catch {
      // Already gone is the outcome we wanted.
    }
  },
};
