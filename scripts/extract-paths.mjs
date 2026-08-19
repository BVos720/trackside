#!/usr/bin/env node
/**
 * The walkable network around a circuit, from OpenStreetMap — spec §3.3, §8.
 *
 * This is what the navigator routes over: the service roads, spectator
 * walkways, forest tracks and lanes that actually connect a car park to a
 * photo position. The basemap draws roads, but drawing is not routing — we need
 * the geometry as data to build a graph from.
 *
 * ── What counts as walkable, and what does not ─────────────────────────────
 * Included: footway, path, track, service, residential, unclassified, tertiary,
 * secondary, pedestrian, steps, living_street. These are things a person on
 * foot can use, and around a circuit most of them are exactly the access roads
 * marshals and spectators use.
 *
 * Excluded, deliberately:
 *
 *   motorway / trunk and their links — walking on these is illegal and unsafe,
 *     and at Le Mans the Mulsanne is public road that becomes a circuit; routing
 *     a photographer down it would be actively dangerous.
 *   raceway — the racing surface. Spec §0.2 and the spot placement rules both
 *     treat "on track" as never a valid position; it must not be a valid route
 *     either.
 *   private / no access — routing across someone's yard is the navigation
 *     equivalent of inferring access permission, which §0.2 forbids.
 *
 * ── What this data does not know ──────────────────────────────────────────
 * Whether a gate is locked. Whether a marshal will let you through. Whether the
 * path floods. The router treats every included way as passable, so the app
 * must present routes as suggestions, never as instructions — which is why
 * `route.ts` keeps direct legs visually distinct and why nothing here writes
 * an access classification.
 *
 * Usage:
 *   npm run paths
 *   npm run paths -- nordschleife spa-francorchamps
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT_DIR = join(root, 'assets', 'circuits');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/**
 * How far beyond the circuit to collect paths, in degrees of latitude.
 *
 * The corridor mask cuts the map 300m from the track, but routing needs more
 * than the visible area: the car park you walk in from is often outside it, and
 * a network clipped at the mask edge would dead-end exactly where the journey
 * starts. ~0.012° is roughly 1.3km.
 */
const PAD_DEG = 0.012;

/**
 * How far from the racing surface a way has to be before it is dropped.
 *
 * The bbox covers a rectangle around the whole venue, which at the Nürburgring
 * is 11 x 12 km of the Eifel — every village lane inside it comes back from
 * Overpass. Unclipped that is 6000 ways and 2.5 MB for one circuit, and a graph
 * big enough to make routing visibly slow, all to describe roads nobody walks
 * to from a photo position.
 *
 * 900 m is well beyond the 300 m visual corridor, so car parks, approach roads
 * and the paddock stay in. Past that you are driving, not walking, and this app
 * does not plan drives.
 */
const CORRIDOR_M = 900;

/**
 * Geometry simplification tolerance, metres.
 *
 * OSM ways carry far more detail than a walking route needs — a curve mapped
 * every two metres becomes fifty graph nodes describing one bend. Collapsing
 * points that sit within 4 m of the line between their neighbours cuts the node
 * count hard without moving any route by more than a stride.
 */
const SIMPLIFY_M = 4;

/** Highway values a person on foot can use. See the note at the top. */
const WALKABLE = [
  'footway',
  'path',
  'pedestrian',
  'steps',
  'track',
  'service',
  'residential',
  'living_street',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
];

/** Access tags that mean "not for you". */
const BLOCKED_ACCESS = new Set(['private', 'no']);

const config = JSON.parse(readFileSync(join(here, 'venues.json'), 'utf8'));
const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(config.venues);

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass is free, shared and volunteer-run, and it rate-limits.
 *
 * Same backoff as the other extractors: retry with a widening delay rather than
 * hammering, and pause between venues.
 */
async function overpass(q, attempt = 1) {
  const r = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
    // Overpass answers 406 to Node's default User-Agent. The other extractors
    // send this same string; keep them identical so throttling is attributable.
    headers: { 'User-Agent': 'trackside-dev/0.1 (motorsport photo planner)' },
  });

  if (!r.ok) {
    if (attempt >= 4) {
      throw new Error(`Overpass ${r.status} after ${attempt} attempts`);
    }
    const wait = attempt * 20_000;
    console.log(`   Overpass ${r.status}; retrying in ${wait / 1000}s…`);
    await sleep(wait);
    return overpass(q, attempt + 1);
  }
  return r.json();
}

/** Is this way something a person on foot may use? */
function isWalkable(tags = {}) {
  if (!WALKABLE.includes(tags.highway)) return false;
  if (BLOCKED_ACCESS.has(tags.access)) return false;
  // `foot=no` is explicit and overrides a permissive highway value.
  if (BLOCKED_ACCESS.has(tags.foot)) return false;
  return true;
}

/**
 * Metres between two lat/lon points.
 *
 * Duplicated from core/logic/geo.ts on purpose: the scripts are plain Node with
 * no TypeScript build step, and importing across that boundary would mean
 * compiling core/ just to run an extractor. The formula is stable enough that
 * the duplication costs nothing.
 */
function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A coarse spatial index over the circuit centreline.
 *
 * Testing every way point against every track point is 6000 x 50 x 1764
 * distance calculations. Bucketing the track into ~1 km cells and checking only
 * the nine cells around a query point makes it cheap enough to ignore.
 */
function trackIndex(trackPoints) {
  const CELL = 0.01; // degrees, ~1.1 km of latitude
  const cells = new Map();
  for (const [lon, lat] of trackPoints) {
    const key = `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push([lon, lat]);
    else cells.set(key, [[lon, lat]]);
  }

  return (lon, lat) => {
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lon / CELL);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [plon, plat] of cells.get(`${cy + dy},${cx + dx}`) ?? []) {
          const d = haversine(lat, lon, plat, plon);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
}

/**
 * Ramer–Douglas–Peucker, with the perpendicular distance measured in metres.
 *
 * Iterative rather than recursive: a 4000-point way would blow the stack, and
 * Le Mans has several.
 */
/**
 * Simplify a way without ever deleting a junction.
 *
 * ── The bug this exists to prevent ─────────────────────────────────────────
 * Plain Douglas–Peucker keeps a way's endpoints and its sharpest bends, and
 * throws away everything else. In OSM a junction is a *shared node*: a footpath
 * that joins a road halfway along ends on a node that is interior to the road's
 * geometry. Simplification saw no bend there and deleted the road's copy of it.
 *
 * The router keys graph nodes on coordinates, so the footpath's endpoint no
 * longer matched anything on the road and the two stopped being connected. At
 * Spa that shattered 427 ways into 180 disconnected islands, and every route
 * quietly degraded to a straight line — the network was there, and nothing
 * could cross it.
 *
 * So junctions are computed across all ways *before* simplifying, and each way
 * is simplified in runs between them. Bends still collapse; connections cannot.
 */
function simplifyPreserving(coords, toleranceM, isJunction) {
  if (coords.length < 3) return coords;

  // Indices that must survive: the ends, and every shared node.
  const anchors = [0];
  for (let i = 1; i < coords.length - 1; i++) {
    if (isJunction(coords[i])) anchors.push(i);
  }
  anchors.push(coords.length - 1);

  const out = [coords[0]];
  for (let a = 0; a < anchors.length - 1; a++) {
    const run = coords.slice(anchors[a], anchors[a + 1] + 1);
    const thinned = simplify(run, toleranceM);
    // Drop the first point of each run: it is the previous run's last.
    for (let i = 1; i < thinned.length; i++) out.push(thinned[i]);
  }
  return out;
}

function simplify(coords, toleranceM) {
  if (coords.length < 3) return coords;

  const keep = new Array(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;

  const stack = [[0, coords.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;

    const [ax, ay] = coords[first];
    const [bx, by] = coords[last];

    for (let i = first + 1; i < last; i++) {
      const [px, py] = coords[i];
      // Work in a local metric frame: a degree of longitude shrinks with
      // latitude, so treating the two axes as equal would under-simplify
      // north-south ways and over-simplify east-west ones.
      const kx = Math.cos((py * Math.PI) / 180) * 111320;
      const ky = 110540;
      const AX = (bx - ax) * kx;
      const AY = (by - ay) * ky;
      const PX = (px - ax) * kx;
      const PY = (py - ay) * ky;

      const lenSq = AX * AX + AY * AY;
      let dist;
      if (lenSq === 0) {
        dist = Math.hypot(PX, PY);
      } else {
        const t = Math.max(0, Math.min(1, (PX * AX + PY * AY) / lenSq));
        dist = Math.hypot(PX - t * AX, PY - t * AY);
      }

      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return coords.filter((_, i) => keep[i]);
}

/** Total length of a coordinate list, metres. */
function lengthOf(coords) {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return sum;
}

for (const key of keys) {
  const venue = config.venues[key];
  if (!venue) {
    console.error(`Unknown venue "${key}"`);
    process.exitCode = 1;
    continue;
  }

  const [w, s, e, n] = venue.bbox;
  // Overpass bbox order is south,west,north,east — the opposite of ours.
  const bbox = `${s - PAD_DEG},${w - PAD_DEG},${n + PAD_DEG},${e + PAD_DEG}`;

  console.log(`\n${key} — walkable network`);

  // The circuit geometry is already on disk; reuse it as the clip reference
  // rather than asking Overpass again for something we have.
  const circuitPath = join(OUT_DIR, `${key}.json`);
  let distanceToTrack = null;
  try {
    const circuit = JSON.parse(readFileSync(circuitPath, 'utf8'));
    const points = [];
    for (const feat of circuit.features ?? []) {
      if (feat.geometry?.type !== 'LineString') continue;
      for (const c of feat.geometry.coordinates) points.push(c);
    }
    if (points.length > 0) distanceToTrack = trackIndex(points);
  } catch {
    // No circuit file yet. Keep everything rather than silently shipping an
    // empty network — run `npm run circuits` first for a clipped result.
    console.log('   no circuit geometry found; keeping the full bbox');
  }

  const query = `
    [out:json][timeout:180];
    (
      way["highway"~"^(${WALKABLE.join('|')})$"](${bbox});
    );
    out geom;
  `;

  const json = await overpass(query);
  const elements = json.elements ?? [];

  const features = [];
  let skippedAccess = 0;
  let skippedShort = 0;
  let skippedFar = 0;
  let pointsBefore = 0;
  let pointsAfter = 0;

  /**
   * How many ways touch each coordinate.
   *
   * Counted over the ways we are actually keeping, at the same 6-decimal
   * rounding the output uses, so a node shared in OSM is shared here too.
   * Anything touched twice is a junction and is protected from simplification.
   */
  const nodeUses = new Map();
  const nodeKey = ([lon, lat]) => `${lon},${lat}`;

  const kept = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    if (!isWalkable(el.tags)) {
      skippedAccess++;
      continue;
    }

    const coords = el.geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);
    if (coords.length < 2) continue;

    // A 3-metre stub is a driveway apron or a mapping artefact. It adds nodes
    // to the graph without adding anywhere to walk.
    if (lengthOf(coords) < 5) {
      skippedShort++;
      continue;
    }

    // Keep a way if any part of it comes near the circuit. Testing every point
    // rather than just the ends matters for long roads that run past the venue:
    // an end-point test would drop the road along the back straight.
    if (distanceToTrack) {
      const near = coords.some(
        ([lon, lat]) => distanceToTrack(lon, lat) <= CORRIDOR_M,
      );
      if (!near) {
        skippedFar++;
        continue;
      }
    }

    kept.push({ tags: el.tags, coords });

    // Count each coordinate once per way, so a way that doubles back on itself
    // does not mark its own point as a junction with nothing.
    const seen = new Set();
    for (const c of coords) {
      const key = nodeKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      nodeUses.set(key, (nodeUses.get(key) ?? 0) + 1);
    }
  }

  const isJunction = (c) => (nodeUses.get(nodeKey(c)) ?? 0) > 1;

  for (const el of kept) {
    const coords = el.coords;
    pointsBefore += coords.length;
    const simplified = simplifyPreserving(coords, SIMPLIFY_M, isJunction);
    pointsAfter += simplified.length;

    features.push({
      type: 'Feature',
      properties: {
        highway: el.tags.highway,
        // Kept for display and debugging only. Nothing routes on the name.
        name: el.tags.name ?? null,
        surface: el.tags.surface ?? null,
      },
      geometry: { type: 'LineString', coordinates: simplified },
    });
  }

  const totalMetres = features.reduce(
    (sum, f) => sum + lengthOf(f.geometry.coordinates),
    0,
  );

  const out = {
    type: 'FeatureCollection',
    // Provenance, per §8: this is OSM data and must be attributed.
    attribution: '© OpenStreetMap contributors (ODbL)',
    generated: new Date().toISOString(),
    metrics: {
      ways: features.length,
      metres: Math.round(totalMetres),
    },
    features,
  };

  const path = join(OUT_DIR, `${key}.paths.json`);
  writeFileSync(path, JSON.stringify(out));
  console.log(
    `   ${features.length} ways, ${(totalMetres / 1000).toFixed(1)} km,` +
      ` ${pointsAfter} points (from ${pointsBefore})`,
  );
  console.log(
    `   skipped ${skippedAccess} by access/type, ${skippedShort} stubs,` +
      ` ${skippedFar} beyond ${CORRIDOR_M} m of the track`,
  );
  console.log(`   → ${path}`);

  // Be a good citizen between venues.
  if (keys.length > 1) await sleep(8000);
}
