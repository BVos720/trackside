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
 * module — not pdfjs.
 */
export async function extractPdfLines(_bytes: Uint8Array): Promise<string[]> {
  throw new Error(
    'Reading PDFs on the phone is not supported yet. Open the PDF, copy the ' +
      'text, and use “Read pasted text” — it goes through the same parser.',
  );
}

export const PDF_SUPPORTED = false;
