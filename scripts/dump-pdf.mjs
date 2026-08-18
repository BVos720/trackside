import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
const maxLines = Number(process.argv[3] ?? 60);

const data = new Uint8Array(readFileSync(file));
const doc = await getDocument({ data, useSystemFonts: true }).promise;

console.log(`pages: ${doc.numPages}`);

for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();

  // Group items into visual lines by their y position — a PDF has no notion of
  // a "row", only positioned glyphs, and a timetable is only readable as rows.
  const rows = new Map();
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], s: item.str });
  }

  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) =>
      items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l !== '');

  console.log(`\n───── page ${p} (${lines.length} lines) ─────`);
  console.log(lines.slice(0, maxLines).join('\n'));
}
