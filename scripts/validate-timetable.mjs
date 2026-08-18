/**
 * Run the deterministic parser over whole timetable PDFs.
 *
 * The unit tests use hand-picked extracts, which risks proving the parser
 * handles exactly the lines it was written against. This runs it over every
 * line of a real document and prints what came out, so the coverage is
 * measured rather than assumed.
 *
 *   node scripts/validate-timetable.mjs <file.pdf> [...]
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseTimetableLines } from '../src/core/logic/timetableText.ts';

/** Group positioned glyphs back into visual rows — a PDF has no notion of one. */
async function linesOf(file) {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(file)),
    useSystemFonts: true,
  }).promise;

  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str });
    }
    for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const line = items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line !== '') out.push(line);
    }
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const lines = await linesOf(file);
  const { sessions, skipped } = parseTimetableLines(lines);

  const onTrack = sessions.filter((s) => s.onTrack);
  const days = [...new Set(sessions.map((s) => s.day).filter(Boolean))];
  const kinds = {};
  for (const s of sessions) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;

  console.log(`\n═══ ${basename(file)} ═══`);
  console.log(`lines: ${lines.length}  sessions: ${sessions.length}  on track: ${onTrack.length}  skipped: ${skipped.length}`);
  console.log(`days (${days.length}): ${days.join(' | ')}`);
  console.log(`kinds: ${JSON.stringify(kinds)}`);

  console.log('\n  on-track sessions:');
  for (const s of onTrack.slice(0, 14)) {
    console.log(`    ${s.start}-${s.end}  ${String(s.durationMinutes).padStart(3)}m  ${s.kind.padEnd(11)} ${s.title.slice(0, 62)}`);
  }
  if (onTrack.length > 14) console.log(`    … ${onTrack.length - 14} more`);

  if (skipped.length > 0) {
    console.log('\n  skipped:');
    for (const l of skipped.slice(0, 6)) console.log(`    ${l.slice(0, 78)}`);
  }
}
