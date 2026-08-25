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
