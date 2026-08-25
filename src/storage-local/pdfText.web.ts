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
 *
 * ── Two shapes out of one pass ────────────────────────────────────────────
 * `extractPdfLines` joins each row into a string, which is what the timetable
 * and entry-list parsers read today. `extractPdfRows` returns the same rows
 * with every token's x position intact.
 *
 * The positions were always computed — the old code collected them, sorted by
 * them, and threw them away one line before returning. Keeping them is what
 * makes columns recoverable, and columns are the thing a space-collapsed row
 * cannot give back: whether `3 7 David HART` is car 3 or car 7 is written in
 * the layout and nowhere else. See TASKS-pdf-mapping.md.
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

/** One run of text, where the PDF put it. */
export interface PdfToken {
  /** Left edge, in PDF points from the left of the page. */
  readonly x: number;
  /** Advance width in points. `x + width` is the right edge. */
  readonly width: number;
  readonly text: string;
}

/** One visual line, with its tokens ordered left to right. */
export interface PdfRow {
  /** 1-based, so it can address a page for rendering. */
  readonly page: number;
  /** Baseline, in PDF points from the bottom of the page. */
  readonly y: number;
  readonly tokens: readonly PdfToken[];
}

async function readRows(bytes: Uint8Array): Promise<PdfRow[]> {
  const doc = await getDocument({
    data: bytes,
    useSystemFonts: true,
    // Never fetch anything: a timetable is a local file and this must work
    // offline (§1.4).
    disableFontFace: true,
  }).promise;

  const out: PdfRow[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const rows = new Map<number, PdfToken[]>();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      // Snap to a tolerance band, or sub-pixel differences split one row into
      // several and every session loses half its text.
      const y = Math.round(item.transform[5] / ROW_TOLERANCE) * ROW_TOLERANCE;
      const token: PdfToken = {
        x: item.transform[4],
        width: typeof item.width === 'number' ? item.width : 0,
        text: item.str,
      };
      const bucket = rows.get(y);
      if (bucket) bucket.push(token);
      else rows.set(y, [token]);
    }

    // Descending y: PDF coordinates start at the bottom of the page, so the
    // largest y is the topmost line.
    for (const [y, tokens] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      out.push({ page: p, y, tokens: [...tokens].sort((a, b) => a.x - b.x) });
    }
  }

  return out;
}

/**
 * The text of one row, as the existing parsers expect it.
 *
 * Identical to what this module returned before rows were exposed: tokens
 * joined with a single space, runs collapsed, trimmed. `timetableText.ts` is
 * tested against three real documents in exactly this shape and works — this
 * must not turn into a rewrite of a working parser.
 */
export function rowText(row: PdfRow): string {
  return row.tokens
    .map((t) => t.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rows with their token positions intact. */
export async function extractPdfRows(bytes: Uint8Array): Promise<PdfRow[]> {
  return readRows(bytes);
}

/** Every non-empty row as a single string. */
export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const rows = await readRows(bytes);
  return rows.map(rowText).filter((line) => line !== '');
}

export const PDF_SUPPORTED = true;
