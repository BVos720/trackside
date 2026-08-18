#!/usr/bin/env node
/**
 * Offline basemap extraction — spec §3.1, §1.4.
 *
 * Pulls a per-venue bounding box out of the Protomaps hosted planet build into
 * a single self-contained .pmtiles archive of a few MB.
 *
 * ── Why this approach ──────────────────────────────────────────────────────
 * Spec §3.1 is explicit that OpenStreetMap's public tile servers must not be
 * used in an application — it violates their usage policy. Self-hosted PMTiles
 * is the sanctioned route, and it is also the only thing that satisfies §1.4:
 * the Nordschleife has extensive dead zones, and an app that needs signal is
 * useless at the moment it matters most.
 *
 * `pmtiles extract` issues HTTP range requests against the planet archive, so
 * it transfers only the tiles inside the bbox — roughly 3 MB and 30-odd
 * requests out of a 128 GB file, rather than downloading the planet.
 *
 * ── Attribution ────────────────────────────────────────────────────────────
 * The output carries the ODbL attribution string in its metadata. Per spec §8
 * that attribution must be *visible in the UI* — "© OpenStreetMap
 * contributors" — not merely present in the file. See MapAttribution in the
 * map screen.
 *
 * Usage:
 *   npm run tiles                 # every venue in venues.json
 *   npm run tiles -- nordschleife # one venue
 */
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const CLI = join(root, 'tools', 'pmtiles', process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');

/** Canonical location. Bundled into the native app via Metro's assetExts. */
const OUT_DIR = join(root, 'assets', 'tiles');

/**
 * Web copy. Expo serves `public/` at the site root, and maplibre-gl needs an
 * HTTP URL it can issue range requests against — it cannot read a bundled
 * native asset. Generated, not committed.
 */
const WEB_DIR = join(root, 'public', 'tiles');

if (!existsSync(CLI)) {
  console.error(`pmtiles CLI not found at ${CLI}`);
  console.error('Download it from https://github.com/protomaps/go-pmtiles/releases');
  console.error('and extract into tools/pmtiles/ (that directory is gitignored).');
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(here, 'venues.json'), 'utf8'));
const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(config.venues);

const unknown = keys.filter((k) => !(k in config.venues));
if (unknown.length > 0) {
  console.error(`Unknown venue(s): ${unknown.join(', ')}`);
  console.error(`Known: ${Object.keys(config.venues).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(WEB_DIR, { recursive: true });

for (const key of keys) {
  const venue = config.venues[key];
  const [west, south, east, north] = venue.bbox;

  // A transposed or zero-area bbox silently produces an archive containing
  // nothing, which looks like a rendering bug much later. Fail here instead.
  if (!(east > west && north > south)) {
    console.error(`${key}: invalid bbox [${venue.bbox}] — expected [west, south, east, north]`);
    process.exit(1);
  }

  const out = join(OUT_DIR, `${key}.pmtiles`);
  console.log(`\n=== ${key} — ${venue.label} ===`);
  console.log(`bbox ${west},${south},${east},${north}`);

  execFileSync(
    CLI,
    [
      'extract',
      config.planetBuild,
      out,
      `--bbox=${west},${south},${east},${north}`,
    ],
    { stdio: 'inherit' },
  );

  const mb = (statSync(out).size / 1024 / 1024).toFixed(2);
  console.log(`wrote ${out} (${mb} MB)`);

  copyFileSync(out, join(WEB_DIR, `${key}.pmtiles`));
  console.log(`copied to public/tiles/${key}.pmtiles for the web target`);
}

console.log('\nDone. Remember: these are committed to the repo on purpose —');
console.log('the app is useless without them where there is no signal (§1.4).');
