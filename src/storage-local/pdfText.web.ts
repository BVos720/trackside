/**
 * PDF text extraction — web.
 *
 * A PDF has no notion of a line: it is positioned glyphs. A timetable is only
 * readable as rows, so items are grouped by their y coordinate and ordered by
 * x. That reconstruction is what makes the deterministic parser in
 * core/logic/timetableText.ts possible at all.
 *
 * Metro resolves this file for web. There is a `.ts` sibling for native, which
 * cannot do this yet — see the note there.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

/**
 * Where the pdfjs worker lives.
 *
 * pdfjs 6 requires this. Older versions treated an empty string as "run on the
 * main thread", which is what this used to rely on; 6 throws
 * `No "GlobalWorkerOptions.workerSrc" specified` instead, and the import
 * screen showed that error instead of a timetable.
 *
 * Metro will not produce a worker bundle, so the prebuilt one is copied out of
 * node_modules into `public/` by `npm run pdfworker` (which `postinstall`
 * runs) and served from the site root — the same route the .pmtiles archives
 * take. A CDN would be less setup and would also mean the importer stopped
 * working without a connection, which defeats §1.4.
 */
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/** Rows within this many points of each other are the same visual line. */
const ROW_TOLERANCE = 2;

export async function extractPdfLines(file: Blob): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // Never fetch anything: a timetable is a local file and this must work
    // offline (§1.4).
    disableFontFace: true,
  }).promise;

  const lines: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      // Snap to a tolerance band, or sub-pixel differences split one row into
      // several and every session loses half its text.
      const y = Math.round(item.transform[5] / ROW_TOLERANCE) * ROW_TOLERANCE;
      const bucket = rows.get(y);
      if (bucket) bucket.push({ x: item.transform[4], s: item.str });
      else rows.set(y, [{ x: item.transform[4], s: item.str }]);
    }

    for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const line = items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line !== '') lines.push(line);
    }
  }

  return lines;
}

export const PDF_SUPPORTED = true;
