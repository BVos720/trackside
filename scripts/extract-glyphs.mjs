#!/usr/bin/env node
/**
 * Label glyphs, bundled — spec §1.4.
 *
 * Everything else in this app works with no signal: tiles, circuit geometry,
 * routing, the plan. Labels did not. MapLibre fetches glyph ranges from a URL
 * as it needs them, and the style pointed at protomaps.github.io — so in the
 * Eifel, where there is no coverage, the map drew every road and named none of
 * them. That is the one gap that undermines the premise rather than trimming a
 * feature: a corner you cannot identify is a corner you cannot plan for.
 *
 * ── Which stacks, and why three ───────────────────────────────────────────
 * The Protomaps basemap layers bring their own fonts: Regular for most place
 * names, Italic for water. This app's own layers use Medium. Bundling only the
 * one this file first knew about left the others failing quietly against a dead
 * network — the same bug in a smaller costume, and only visible once the first
 * fix removed the noise hiding it.
 *
 * Devanagari is deliberately absent. It appears only as a fallback inside the
 * basemap's stacks, and `normaliseFontStacks` in style.ts collapses every layer
 * to a single bundled stack, so a composite name is never requested.
 *
 * Non-Latin is not bundled either. Japanese labels at Suzuka and Fuji would
 * need most of the CJK ranges — tens of megabytes to name two circuits nobody
 * is walking this season. They fall back to Latin script or stay unnamed:
 * documented, rather than silently broken.
 *
 * ── Why the stacks are renamed ────────────────────────────────────────────
 * Saved without spaces. MapLibre substitutes the stack name straight into the
 * glyph URL, and a space becomes %20 — which some file URI handlers decode and
 * others do not. The name is only a lookup key; the protobuf inside does not
 * care what the directory is called.
 *
 * Usage:
 *   npm run glyphs
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SOURCE = 'https://protomaps.github.io/basemaps-assets/fonts';

/** Remote stack name → the folder it is saved as. */
const STACKS = [
  ['Noto Sans Regular', 'NotoSansRegular'],
  ['Noto Sans Medium', 'NotoSansMedium'],
  ['Noto Sans Italic', 'NotoSansItalic'],
];

/**
 * Unicode ranges to bundle.
 *
 * 0-255 is ASCII plus Latin-1, covering Dutch, German, French and the accents
 * in "Nürburgring" and "Francorchamps". 256-511 is Latin Extended-A, needed for
 * Czech, Polish and Hungarian entrants and place names. Around 200 KB a stack —
 * small enough that leaving them out was never a size decision, only an
 * oversight.
 */
const RANGES = ['0-255', '256-511'];

let total = 0;

for (const [remote, local] of STACKS) {
  const nativeDir = join(root, 'assets', 'glyphs', local);
  const webDir = join(root, 'public', 'fonts', local);
  mkdirSync(nativeDir, { recursive: true });
  mkdirSync(webDir, { recursive: true });

  for (const range of RANGES) {
    const url = `${SOURCE}/${encodeURIComponent(remote)}/${range}.pbf`;
    process.stdout.write(`${local} ${range} … `);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'trackside-dev/0.1 (motorsport photo planner)' },
    });
    if (!res.ok) {
      console.error(`\nFailed: ${res.status} for ${url}`);
      process.exitCode = 1;
      continue;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(nativeDir, `${range}.pbf`), bytes);
    writeFileSync(join(webDir, `${range}.pbf`), bytes);
    total += bytes.length;
    console.log(`${(bytes.length / 1024).toFixed(0)} KB`);
  }
}

console.log(`\n${(total / 1024 / 1024).toFixed(2)} MB total`);
console.log('→ assets/glyphs/  and  public/fonts/');
console.log(
  '\nCommitted to the repo on purpose: the app is useless without them\n' +
    'where there is no signal (§1.4), exactly like the .pmtiles archives.',
);

if (!existsSync(join(root, 'assets', 'glyphs', 'NotoSansRegular', '0-255.pbf'))) {
  console.error('The essential Latin range is missing — the map will be mute.');
  process.exitCode = 1;
}
