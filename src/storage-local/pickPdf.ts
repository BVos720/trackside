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
import { File } from 'expo-file-system';

export interface PickedPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
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

  /*
   * `File.bytes()`, not `readAsStringAsync`.
   *
   * expo-file-system 57 does not merely deprecate the legacy reader — importing
   * it from the package root gives a shim that *throws*, so picking a PDF on
   * device failed with "Method readAsStringAsync is deprecated" rather than
   * doing anything. It also returns bytes directly, which removes the base64
   * round trip and the decoder that went with it.
   */
  const bytes = await new File(asset.uri).bytes();

  return { name: asset.name ?? 'timetable.pdf', bytes };
}

export const PICKER_SUPPORTED = true;
