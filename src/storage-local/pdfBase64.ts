/**
 * PDF bytes to base64, for the WebView bridge.
 *
 * Its own module so it can be tested. The bridge itself imports
 * `react-native-webview`, which this Vitest config cannot load — see the note
 * at the top of pickImage.test.ts — and this is the one part of that file
 * where a quiet bug would be indistinguishable from a broken document.
 */

/**
 * Chunked, and that is the whole point.
 *
 * `String.fromCharCode(...bytes)` on a whole PDF spreads a few hundred
 * thousand arguments across the call stack and throws a `RangeError`. Which
 * would surface as "the PDF could not be read" on every file above some size
 * nobody could name — working for a one-page entry list and failing on the
 * ten-page NLS one, which is exactly the sort of threshold bug that gets
 * blamed on the document.
 *
 * 0x8000 is comfortably under every engine's argument limit and large enough
 * that the loop is not the cost.
 */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return globalThis.btoa(binary);
}

/**
 * base64 back to bytes.
 *
 * ── Why this exists, and it is not for PDFs ──────────────────────────────
 * React Native implements almost none of the Blob API. Its Blob has
 * `size`, `type` and `slice()` — and nothing else. In particular there is no
 * `arrayBuffer()`, which is what mediaStore called to get the bytes of a
 * photo before writing it. That call returned undefined and threw, so a
 * reference photo has never once been saved on a device.
 *
 * The way to the bytes is FileReader, which RN does implement, and which
 * hands back a data URL. This turns the base64 half of that back into the
 * bytes the file system wants.
 *
 * Chunked for the same reason `bytesToBase64` is: building the array one
 * character at a time is fine, but doing it through a growing string is not.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Strip the `data:...;base64,` prefix a FileReader data URL carries.
 *
 * Returns null rather than guessing when the shape is wrong. A data URL
 * without that marker is not base64 — it is percent-encoded text — and
 * decoding it as base64 would produce plausible-looking rubbish and write a
 * corrupt file, which is worse than refusing.
 */
export function base64FromDataUrl(dataUrl: string): string | null {
  const marker = ';base64,';
  const at = dataUrl.indexOf(marker);
  return at === -1 ? null : dataUrl.slice(at + marker.length);
}
