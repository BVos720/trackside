#!/usr/bin/env node
/**
 * Buildings and woodland scatter, from OpenStreetMap — spec §3.3, §8.
 *
 * Two things the generalised basemap cannot give us:
 *
 * 1. **Real building heights.** The Protomaps `buildings` layer carries a
 *    `height` field, but around the Nürburgring it is almost entirely null, so
 *    extruding from it produces either invisible buildings or a uniform fake
 *    height. Raw OSM has `height` on some and `building:levels` on many more,
 *    and levels convert to metres reliably. Grandstands and pit buildings are
 *    exactly the structures whose real massing matters for sightlines.
 *
 * 2. **Tree positions.** MapLibre has no way to fill a polygon with a scatter
 *    of symbols, so the points have to exist as data. These are generated on a
 *    jittered grid inside real OSM woodland, clipped to the circuit corridor.
 *
 * ── What is real here and what is not ──────────────────────────────────────
 * Building footprints and heights are OSM facts. Woodland *extent* is an OSM
 * fact. Individual tree positions are NOT — they are generated to convey
 * "there is forest here", the way hatching conveys a material on a drawing.
 * Nothing may treat a generated tree point as the location of a real tree, and
 * in particular the viewshed (§3.4) must come from the DSM, never from these.
 *
 * Usage:
 *   npm run scenery
 *   npm run scenery -- nordschleife
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  area,
  booleanPointInPolygon,
  bbox as turfBbox,
  centroid,
  intersect,
  featureCollection,
} from '@turf/turf';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT_DIR = join(root, 'assets', 'circuits');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Metres per storey, for converting `building:levels` where `height` is absent. */
const METRES_PER_LEVEL = 3;

/**
 * Upper bound on generated tree points per venue.
 *
 * Symbols are cheap — these are billboards with overlap and placement checks
 * disabled, so MapLibre does no collision work on them — but they are not free,
 * and a phone rendering terrain plus extrusions has a budget. 14k is dense
 * enough to read as woodland rather than as scattered markers.
 */
const MAX_TREES = 14000;

/** Nominal spacing of the scatter grid, metres. */
const TREE_SPACING_M = 26;

/**
 * Field scatter — grass tufts and low plants in meadow and grassland.
 *
 * Sparser than the trees: this is ground texture that only appears at close
 * zoom, and open fields cover far more area than the woodland does, so the same
 * spacing would produce an unusable number of symbols.
 *
 * No rocks. Meadows around these circuits are grazing and hay, not scree.
 */
const FIELD_SPACING_M = 42;
const MAX_FIELD_PLANTS = 6000;

const config = JSON.parse(readFileSync(join(here, 'venues.json'), 'utf8'));
const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(config.venues);

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass is a free, shared, volunteer-run service and it rate-limits.
 *
 * This script issues several queries in a row, which reliably earns a 429 with
 * no backoff. Retrying with a widening delay and pausing between venues keeps
 * us within what the service asks of clients — and getting throttled out
 * halfway through leaves a venue with buildings but no trees, which is worse
 * than being slow.
 */
async function overpass(q, attempt = 1) {
  const r = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
    headers: { 'User-Agent': 'trackside-dev/0.1 (motorsport photo planner)' },
  });

  if (r.status === 429 || r.status === 504) {
    if (attempt > 5) throw new Error(`Overpass ${r.status} after ${attempt} attempts`);
    const wait = 8000 * attempt;
    console.log(`  Overpass ${r.status}; waiting ${wait / 1000}s then retrying…`);
    await sleep(wait);
    return overpass(q, attempt + 1);
  }

  if (!r.ok) throw new Error(`Overpass ${r.status} ${r.statusText}`);
  return r.json();
}

const ringOf = (w) => w.geometry.map((p) => [p.lon, p.lat]);

function closeRing(ring) {
  const [a] = ring;
  const z = ring[ring.length - 1];
  return a[0] === z[0] && a[1] === z[1] ? ring : [...ring, a];
}

/** `height=12`, `height=12 m`, or levels × 3. Null when OSM says nothing. */
function heightMetres(tags = {}) {
  const raw = tags.height ?? tags['building:height'];
  if (raw != null) {
    const n = Number.parseFloat(String(raw).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return levels * METRES_PER_LEVEL;
  return null;
}

for (const key of keys) {
  const venue = config.venues[key];
  if (!venue) {
    console.error(`Unknown venue: ${key}`);
    process.exit(1);
  }
  const [w, s, e, n] = venue.bbox;
  const bbox = `${s},${w},${n},${e}`;
  console.log(`\n=== ${key} — ${venue.label} ===`);

  // The corridor produced by extract-circuits.mjs, used to clip both datasets
  // so nothing is generated for terrain that is masked out anyway.
  const maskDoc = JSON.parse(
    readFileSync(join(OUT_DIR, `${key}.mask.json`), 'utf8'),
  );
  // The mask is the inverse of the corridor: outer ring is the world, inner
  // rings are the corridor. The holes are what we want to keep.
  const holes = maskDoc.geometry.coordinates.slice(1);
  const corridor = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: holes.map((h) => [h]) },
  };

  // ── buildings ────────────────────────────────────────────────────────────
  const bJson = await overpass(
    `[out:json][timeout:180];(way["building"](${bbox}););out geom;`,
  );
  const buildings = [];
  let withRealHeight = 0;
  for (const way of bJson.elements) {
    if (!way.geometry || way.geometry.length < 4) continue;
    const ring = closeRing(ringOf(way));
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
    if (!booleanPointInPolygon(centroid(feature), corridor)) continue;

    const h = heightMetres(way.tags);
    if (h !== null) withRealHeight++;
    buildings.push({
      ...feature,
      properties: {
        osmId: way.id,
        kind: way.tags?.building ?? 'yes',
        name: way.tags?.name ?? null,
        // Null where OSM does not say. The style decides what to do with that
        // rather than a fabricated number being baked into the data.
        heightMetres: h,
      },
    });
  }
  console.log(
    `buildings in corridor: ${buildings.length} (${withRealHeight} with OSM height/levels)`,
  );
  writeFileSync(
    join(OUT_DIR, `${key}.buildings.json`),
    JSON.stringify({
      type: 'FeatureCollection',
      attribution: '© OpenStreetMap contributors',
      features: buildings,
    }),
  );

  // ── woodland scatter ─────────────────────────────────────────────────────
  await sleep(3000); // be a good citizen between queries

  /**
   * Relations matter as much as ways here.
   *
   * Large forests are mapped in OSM as multipolygon relations, not single
   * closed ways, and the big Eifel blocks around the Nordschleife are exactly
   * that. Querying ways alone returned a fraction of the woodland: the basemap
   * still painted the ground dark green (it processes relations), so the map
   * showed forest with no trees standing in it.
   */
  const fJson = await overpass(
    `[out:json][timeout:180];(` +
      `way["landuse"="forest"](${bbox});way["natural"="wood"](${bbox});` +
      `relation["landuse"="forest"](${bbox});relation["natural"="wood"](${bbox});` +
      `);out geom;`,
  );

  /**
   * Flatten ways and relation outer members into a flat list of rings.
   *
   * Inner rings (clearings) are ignored. For scattering trees that is a fair
   * simplification — a few trees in a clearing is a far smaller error than an
   * entire forest block missing — and it keeps the geometry handling simple.
   */
  const rings = [];
  for (const el of fJson.elements) {
    if (el.type === 'way' && el.geometry) {
      rings.push(el.geometry);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const mem of el.members) {
        if (mem.role === 'outer' && mem.geometry) rings.push(mem.geometry);
      }
    }
  }

  const woods = [];
  for (const geometry of rings) {
    if (!geometry || geometry.length < 4) continue;
    const way = { geometry };
    const poly = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(ringOf(way))] },
    };
    let clipped = null;
    try {
      clipped = intersect(featureCollection([poly, corridor]));
    } catch {
      clipped = null;
    }
    if (clipped) woods.push(clipped);
  }

  const woodArea = woods.reduce((sum, f) => sum + area(f), 0);
  console.log(
    `woodland in corridor: ${woods.length} polygons, ${(woodArea / 1e6).toFixed(2)} km²`,
  );

  /**
   * Corridor-clipped woodland, for the extruded canopy.
   *
   * The canopy previously came from the basemap's `landuse` layer, which is not
   * clipped to anything — and because `fill-extrusion` is real 3D geometry, the
   * flat corridor mask could not occlude it. Forest outside the corridor stood
   * up through the mask and remained visible in the tilted view.
   *
   * Sourcing the canopy from these already-clipped polygons removes the problem
   * at the data end instead of fighting it in render order.
   */
  writeFileSync(
    join(OUT_DIR, `${key}.woodland.json`),
    JSON.stringify({
      type: 'FeatureCollection',
      attribution: '© OpenStreetMap contributors',
      features: woods,
    }),
  );

  // Deterministic jittered grid: reproducible builds, but not a visible lattice.
  const trees = [];
  const degPerM = 1 / 111320;
  let seed = 1;
  const rand = () => {
    // Small LCG — deterministic across machines, unlike Math.random.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (const wood of woods) {
    const [ww, ws, we, wn] = turfBbox(wood);
    const latScale = Math.cos(((ws + wn) / 2) * (Math.PI / 180));
    const stepLat = TREE_SPACING_M * degPerM;
    const stepLon = stepLat / latScale;

    for (let lat = ws; lat <= wn; lat += stepLat) {
      for (let lon = ww; lon <= we; lon += stepLon) {
        const p = [
          lon + (rand() - 0.5) * stepLon * 0.85,
          lat + (rand() - 0.5) * stepLat * 0.85,
        ];
        /**
         * Woodland gets trees and nothing else.
         *
         * An earlier version mixed shrubs, grass and rocks into the same
         * scatter for variety. It reads wrong: OSM's `landuse=forest` /
         * `natural=wood` polygons are forest, and forest is trees. Ground
         * cover belongs to the lighter meadow and grass polygons, which are
         * left alone deliberately — those are a different landuse and putting
         * woodland dressing on them would be just as wrong in reverse.
         */
        const pt = {
          type: 'Feature',
          properties: { kind: 'tree' },
          geometry: { type: 'Point', coordinates: p },
        };
        if (booleanPointInPolygon(pt, wood)) trees.push(pt);
      }
    }
  }

  // Thin evenly rather than truncating, so density stays uniform across the
  // circuit instead of the last third of the lap having no trees at all.
  let kept = trees;
  if (trees.length > MAX_TREES) {
    const stride = trees.length / MAX_TREES;
    kept = [];
    for (let i = 0; i < trees.length; i += stride) kept.push(trees[Math.floor(i)]);
  }

  // ── field scatter ────────────────────────────────────────────────────────
  await sleep(3000);
  const gJson = await overpass(
    `[out:json][timeout:180];(` +
      `way["landuse"~"^(meadow|grass|farmland)$"](${bbox});` +
      `way["natural"="grassland"](${bbox});` +
      `relation["landuse"~"^(meadow|grass|farmland)$"](${bbox});` +
      `relation["natural"="grassland"](${bbox});` +
      `);out geom;`,
  );

  const fieldRings = [];
  for (const el of gJson.elements) {
    if (el.type === 'way' && el.geometry) fieldRings.push(el.geometry);
    else if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const mem of el.members) {
        if (mem.role === 'outer' && mem.geometry) fieldRings.push(mem.geometry);
      }
    }
  }

  const fields = [];
  for (const geometry of fieldRings) {
    if (!geometry || geometry.length < 4) continue;
    const poly = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(ringOf({ geometry }))] },
    };
    let clipped = null;
    try {
      clipped = intersect(featureCollection([poly, corridor]));
    } catch {
      clipped = null;
    }
    if (clipped) fields.push(clipped);
  }

  const fieldArea = fields.reduce((sum, x) => sum + area(x), 0);
  console.log(
    `fields in corridor: ${fields.length} polygons, ${(fieldArea / 1e6).toFixed(2)} km²`,
  );

  const plants = [];
  for (const field of fields) {
    const [fw, fs, fe, fn] = turfBbox(field);
    const latScale = Math.cos(((fs + fn) / 2) * (Math.PI / 180));
    const stepLat = FIELD_SPACING_M * degPerM;
    const stepLon = stepLat / latScale;

    for (let lat = fs; lat <= fn; lat += stepLat) {
      for (let lon = fw; lon <= fe; lon += stepLon) {
        const p = [
          lon + (rand() - 0.5) * stepLon * 0.85,
          lat + (rand() - 0.5) * stepLat * 0.85,
        ];
        // Mostly grass with the occasional low plant. No rocks: these are
        // grazing meadows, and a field of boulders would be a lie about the
        // ground you would actually be standing on.
        const kind = rand() < 0.78 ? 'grass' : 'shrub';
        const pt = {
          type: 'Feature',
          properties: { kind },
          geometry: { type: 'Point', coordinates: p },
        };
        if (booleanPointInPolygon(pt, field)) plants.push(pt);
      }
    }
  }

  let keptPlants = plants;
  if (plants.length > MAX_FIELD_PLANTS) {
    const stride = plants.length / MAX_FIELD_PLANTS;
    keptPlants = [];
    for (let i = 0; i < plants.length; i += stride) {
      keptPlants.push(plants[Math.floor(i)]);
    }
  }
  console.log(`field plants: ${plants.length}, kept: ${keptPlants.length}`);

  /**
   * No trees in open fields.
   *
   * Woodland and field polygons overlap in OSM more than you would expect. The
   * main cause here is that relation *outer* rings are used without subtracting
   * inner rings, so a clearing inside a forest — often mapped as its own meadow
   * — sits inside the forest outline and was getting conifers scattered across
   * it. Meadows that simply overlap a wood edge do the same.
   *
   * Subtracting the fields from the tree scatter fixes both without needing
   * full multipolygon hole handling: a point in a field is not in a wood, no
   * matter what the outer ring says.
   */
  const treesOutsideFields = kept.filter(
    (pt) => !fields.some((field) => booleanPointInPolygon(pt, field)),
  );
  console.log(
    `trees generated: ${trees.length}, kept: ${kept.length}, outside fields: ${treesOutsideFields.length}`,
  );
  await sleep(3000); // pause before the next venue's queries
  writeFileSync(
    join(OUT_DIR, `${key}.trees.json`),
    JSON.stringify({
      type: 'FeatureCollection',
      note: 'Generated scatter inside real OSM woodland. Individual positions are decorative, not surveyed.',
      features: [...treesOutsideFields, ...keptPlants],
    }),
  );
}
