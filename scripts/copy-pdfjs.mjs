/**
 * Refresh the bundled copies of pdfjs from node_modules.
 *
 * Three copies, two destinations:
 *   • `public/pdf.worker.min.mjs` — served at the site root for web, because
 *     Metro will not produce a worker bundle (see pdfText.web.ts).
 *   • `assets/pdfjs/*.pdfjs` — bundled into the app for the native WebView
 *     bridge, renamed off `.mjs` so Metro treats them as assets rather than
 *     source (see metro.config.js).
 *
 * ── It must never fail the install ────────────────────────────────────────
 * All three destinations are committed, so this exists only to keep them in
 * step when the pdfjs version moves. That makes it a convenience — and a
 * convenience must not be able to abort `npm ci`, which on a CI builder means
 * failing the whole build at "Install dependencies" over files that were
 * already present in the checkout.
 *
 * So each copy is attempted independently and a failure is reported and
 * shrugged off. If pdfjs is genuinely missing, the committed copies are what
 * ship, which is the right outcome rather than a red build.
 *
 * ── A script file, not `node -e` ──────────────────────────────────────────
 * The web worker copy used to be an inline one-liner in package.json, single
 * quotes nested inside double quotes. That survives cmd.exe on Windows and is
 * at the mercy of whichever shell npm picks elsewhere — `sh -c` on macOS and
 * Linux. A file has no quoting to get wrong.
 */
import { copyFileSync, mkdirSync } from 'node:fs';

const copies = [
  [
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    'public/pdf.worker.min.mjs',
    'public',
  ],
  [
    'node_modules/pdfjs-dist/build/pdf.min.mjs',
    'assets/pdfjs/pdf.min.pdfjs',
    'assets/pdfjs',
  ],
  [
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    'assets/pdfjs/pdf.worker.min.pdfjs',
    'assets/pdfjs',
  ],
];

let skipped = 0;

for (const [from, to, dir] of copies) {
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(from, to);
  } catch (error) {
    skipped += 1;
    console.warn(
      `[copy-pdfjs] could not refresh ${to}: ${error.message} — ` +
        'the committed copy will be used.',
    );
  }
}

if (skipped > 0) {
  console.warn(
    `[copy-pdfjs] ${skipped} of ${copies.length} copies skipped. Not an ` +
      'error: these files are committed.',
  );
}

// Always exits 0. See the note above.
