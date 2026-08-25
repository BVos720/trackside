/**
 * Copy pdfjs out of node_modules into assets/, for the WebView bridge.
 *
 * Renamed to .pdfjs because Metro treats .mjs as source and would try to
 * parse a 1.2MB minified bundle as a module. See metro.config.js.
 *
 * Run by postinstall, so a fresh clone gets them without the 1.7MB being
 * committed — the same arrangement the pdf worker already uses for web.
 */
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('assets/pdfjs', { recursive: true });

for (const [from, to] of [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'assets/pdfjs/pdf.min.pdfjs'],
  [
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    'assets/pdfjs/pdf.worker.min.pdfjs',
  ],
]) {
  copyFileSync(from, to);
}
