/**
 * Choosing a photo from the device — native.
 *
 * The web sibling does the same job with a file input, so the caller only ever
 * sees `{ blob, contentType }` and does not branch on platform.
 *
 * ── Why the bytes are read here rather than passed as a URI ───────────────
 * `IMediaStore.put` takes a Blob, deliberately: it is the one shape both a
 * browser and a phone can produce, and it is what keeps `mediaStore.web.ts`
 * and `mediaStore.ts` interchangeable behind the port (§2.4). Reading the
 * picked file here is what lets everything above this line stay ignorant of
 * where photos come from.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * How large a stored reference photo is allowed to be.
 *
 * ── Downscaled on purpose, and this reverses part of §5.1 ─────────────────
 * The spec says to keep the untouched original local-only. Branco's decision,
 * and it is the right one for what these photos are: a reference shot's job is
 * to show where to stand — the gap in the fence, which side of the path, the
 * post number — and 1600px on the long edge answers that on any phone screen,
 * including pinched in. The originals are 12–50MP straight off a phone, so
 * storing them whole means a few hundred megabytes of app storage to say
 * something a few hundred kilobytes already says.
 *
 * Full resolution is not being thrown away as a principle, only deferred: when
 * there is a backend to hold it — and possibly a paid tier to pay for it — the
 * originals go there and this stays the local cache. That is why the field is
 * `storageKey` behind a port (§2.4) rather than a path: swapping where the
 * bytes live is a change confined to `storage-local/`.
 *
 * The photographer's real photographs are on their camera. This is a notebook.
 */
const MAX_EDGE = 1600;

/**
 * JPEG quality for the stored copy.
 *
 * 0.7 is where compression stops being visible on the kind of subject these
 * photos have — fences, gravel, tarmac, trees — and well before it starts
 * costing legibility of a marshal post number, which is the detail most worth
 * preserving.
 */
const QUALITY = 0.7;

export interface PickedImage {
  readonly blob: Blob;
  readonly contentType: string;
  /** The picker's own URI, for showing it before it is written. */
  readonly previewUri: string;
}

export const IMAGE_PICKER_SUPPORTED = true;

/**
 * Null when the user backed out, or when permission was refused.
 *
 * Permission is requested rather than assumed: Android will hand back an empty
 * result for a denied permission, which is indistinguishable from a cancel and
 * would look like a broken button.
 */
export async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // No editing step. A reference photo's job is to show where to stand, and
    // a crop applied in a hurry removes exactly the context that makes it
    // useful — the path, the fence line, the post number.
    allowsEditing: false,
    // Quality is applied at the resize below instead, on the already-scaled
    // image. Compressing here as well would be two lossy passes for one result.
    quality: 1,
    exif: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const stored = await downscale(asset.uri, asset.width, asset.height);

  /*
   * `fetch` on a file:// URI is how a local file becomes a Blob in React
   * Native. It looks like a network call and is not one — there is no other
   * route to a Blob without a base64 round trip, which doubles the memory for
   * a large photo and gains nothing.
   */
  const response = await fetch(stored);
  const blob = await response.blob();

  return {
    blob,
    contentType: 'image/jpeg',
    // The picker's own URI, not the resized copy: this is only for showing the
    // photo before it is written, and the original is already on disk.
    previewUri: asset.uri,
  };
}

/**
 * Scale the long edge down to `MAX_EDGE` when the image is bigger than that,
 * and re-encode unconditionally otherwise.
 *
 * ── Why this always runs the manipulator, even at native size ─────────────
 * §5.1/§9.4 require EXIF (GPS, timestamp, device) gone from every stored
 * reference photo, not just the ones big enough to trigger a resize. This
 * SDK's `ImageManipulator` has no metadata/EXIF option to set (checked
 * `SaveOptions` — only `base64`, `compress`, `format`); what strips EXIF is
 * that `renderAsync`/`saveAsync` re-encode from a decoded pixel buffer
 * (`UIImage` on iOS, `Bitmap` on Android — see their native modules), which
 * carries no EXIF block to begin with. That only happens as a side effect of
 * actually running the pipeline, so an image already under `MAX_EDGE` must
 * still be pushed through it — just with a no-op resize (its own dimensions)
 * instead of a real one.
 *
 * Returns the original URI unchanged if the manipulator throws. That is a
 * deliberate fallback for keeping the reference photo at all (a spot you
 * cannot find again is worse than one with EXIF intact) — but it means the
 * caller cannot assume the returned image is always stripped; see the
 * exif-strip decision helper below for what's guaranteed vs. what still
 * wants on-device verification.
 */
async function downscale(
  uri: string,
  width: number | undefined,
  height: number | undefined,
): Promise<string> {
  try {
    const targetSize = resizeTargetFor(width, height);

    const context = ImageManipulator.manipulate(uri);
    // Only the long edge is constrained; the other follows, so the aspect
    // ratio is preserved without needing to know the orientation. When the
    // image is already within MAX_EDGE, `targetSize` reproduces its own
    // dimensions — a no-op resize whose only job is to force the re-encode.
    context.resize(targetSize);

    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      compress: QUALITY,
      format: SaveFormat.JPEG,
    });
    return saved.uri;
  } catch {
    return uri;
  }
}

/**
 * The `resize()` target for `downscale`'s manipulator pass.
 *
 * Pure and exported for testing: it is the one piece of this module's
 * decision-making that doesn't touch a native API, so it is what stands in
 * for "does every input get forced through the re-encode that strips EXIF."
 * Above `MAX_EDGE` this shrinks the long edge as before; at or below it,
 * it targets the image's own current size, which is a no-op resize that
 * still forces `renderAsync`/`saveAsync` to run.
 */
export function resizeTargetFor(
  width: number | undefined,
  height: number | undefined,
): { width?: number; height?: number } {
  const w = width ?? 0;
  const h = height ?? 0;
  const longest = Math.max(w, h);
  const longEdgeIsWidth = w >= h;

  if (longest > 0 && longest <= MAX_EDGE) {
    // No-op target: reproduce the image's own dimensions so the manipulator
    // still runs (and still re-encodes, dropping EXIF) without changing
    // what's stored.
    return longEdgeIsWidth ? { width: w || undefined } : { height: h || undefined };
  }

  return longEdgeIsWidth ? { width: MAX_EDGE } : { height: MAX_EDGE };
}
