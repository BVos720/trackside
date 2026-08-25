/**
 * PDF text extraction — native.
 *
 * The *picker* works on device (see pickPdf.ts); pulling text out of the file
 * does not. pdfjs needs a DOM and a worker bundle Metro does not produce for
 * React Native, and a stub that returned no lines would be indistinguishable
 * from "this timetable has no sessions in it" — which is why this throws
 * instead.
 *
 * Pasting the text works on device today, and `core/logic/timetableText.ts`
 * parses it identically however it arrived, so nothing downstream cares.
 *
 * If on-device PDF import is wanted, the route is a native text-extraction
 * module or on-device OCR — not pdfjs. See TASKS-pdf-mapping.md P9, which
 * argues OCR became the better candidate once a human assigns the fields: OCR
 * returns text with rough boxes and gets the structure wrong, which is fatal
 * for a parser inferring meaning and survivable when a person assigns it and
 * can edit the result.
 *
 * The types below mirror the web sibling so callers compile on both platforms
 * and branch on `PDF_SUPPORTED` rather than on which file Metro resolved.
 */

/** One run of text, where the PDF put it. Mirrors the web sibling. */
export interface PdfToken {
  readonly x: number;
  readonly width: number;
  readonly text: string;
}

/** One visual line, with its tokens ordered left to right. */
export interface PdfRow {
  readonly page: number;
  readonly y: number;
  readonly tokens: readonly PdfToken[];
}

const unsupported = () =>
  new Error(
    'Reading PDFs on the phone is not supported yet. Open the PDF, copy the ' +
      'text, and use “Read pasted text” — it goes through the same parser.',
  );

export async function extractPdfLines(_bytes: Uint8Array): Promise<string[]> {
  throw unsupported();
}

export async function extractPdfRows(_bytes: Uint8Array): Promise<PdfRow[]> {
  throw unsupported();
}

/** Present so callers share one code path across platforms. */
export function rowText(row: PdfRow): string {
  return row.tokens
    .map((t) => t.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const PDF_SUPPORTED = false;
