/**
 * Choosing a PDF from the device — native.
 *
 * Opens the system document picker, then reads the chosen file into memory.
 * The web sibling (`pickPdf.web.ts`) does the same job with a file input, so
 * the timetable screen only ever sees `{ name, bytes }` and does not branch on
 * platform.
 *
 * ── Read into memory, deliberately ─────────────────────────────────────────
 * A race programme is a few hundred kilobytes and is parsed once. Streaming it
 * would mean holding a file handle across an async parse for no benefit, and
 * `copyToCacheDirectory` already means the URI stays valid long enough — some
 * providers hand back a content:// URI that is revoked the moment the picker
 * closes.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export interface PickedPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Base64 → bytes, without pulling in a polyfill for `atob`. */
function decodeBase64(input: string): Uint8Array {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);

  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of clean) {
    value = (value << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

/** Null when the user backed out of the picker. */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    // Without this the URI can be revoked as soon as the picker closes, and
    // the read fails with a permission error that looks like a corrupt file.
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: 'base64',
  });

  return { name: asset.name ?? 'timetable.pdf', bytes: decodeBase64(base64) };
}

export const PICKER_SUPPORTED = true;
