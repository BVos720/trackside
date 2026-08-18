/**
 * PDF text extraction — native.
 *
 * Deliberately unimplemented. pdfjs needs a DOM and a worker bundle that Metro
 * does not produce for React Native, and shipping a stub that silently returned
 * no lines would look identical to "this timetable has no sessions in it".
 *
 * Pasting the text works on device today, which covers the case that matters:
 * §5.14 puts document import in planning mode at a desk, not trackside.
 *
 * If on-device PDF import is wanted later, `react-native-pdf-lib` or a native
 * text-extraction module is the route — not pdfjs.
 */
export async function extractPdfLines(_file: Blob): Promise<string[]> {
  throw new Error(
    'PDF import is not available on device yet — paste the timetable text instead.',
  );
}

export const PDF_SUPPORTED = false;
