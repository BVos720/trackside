#!/usr/bin/env node
/**
 * Circuit centreline extraction from OpenStreetMap — spec §8.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The Protomaps basemap generalises OSM for general-purpose cartography, and
 * in doing so it reclassifies the circuit. Querying the generated tiles around
 * the Nürburgring returns `kind_detail: "raceway"` for the GP-Strecke only —
 * the entire 20.8km Nordschleife comes through as unnamed `tertiary` and
 * `track` segments, indistinguishable from the Eifel lanes around it, because
 * it is a public toll road.
 *
 * Styling the circuit off the basemap would therefore draw the GP circuit and
 * silently omit the Nordschleife. So the circuit is sourced separately, from
 * raw OSM, and shipped as its own GeoJSON layer the app fully controls.
 *
 * Spec §8 endorses exactly this: circuit layout artwork must not be scraped
 * from venue websites, but deriving geometry from OSM is fine. The data is
 * ODbL, so the visible "© OpenStreetMap contributors" attribution the map
 * already renders covers it.
 *
 * Usage:
 *   npm run circuits                 # every venue
 *   npm run circuits -- nordschleife
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buffer, mask, union, featureCollection } from '@turf/turf';

/**
 * How far beyond the circuit the map remains visible, in metres.
 *
 * Everything outside this corridor is masked out. The number is a judgement
 * about relevance, not about geography: a photographer's world at an event is
 * the track and the immediate ground either side of it, and the villages
 * kilometres away are noise.
 *
 * At 300m this keeps the fence line, the marshal post, the path behind it, and
 * most of the spectator areas and car parks that hang off the circuit, while
 * still cutting the surrounding countryside.
 *
 * Changing this requires regenerating the scenery too — buildings and trees are
 * clipped to the corridor, so a wider mask without a rerun leaves a visible
 * band of bare ground: `npm run circuits && npm run scenery`.
 */
const CORRIDOR_METRES = 300;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT_DIR = join(root, 'assets', 'circuits');

const OVERPASS = 'https://overpass-api.de/api/interpreter';

const config = JSON.parse(readFileSync(join(here, 'venues.json'), 'utf8'));
const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(config.venues);

mkdirSync(OUT_DIR, { recursive: true });

/**
 * `highway=raceway` identifies racing surface in OSM, including the
 * Nordschleife.
 *
 * Karting circuits are excluded. Both venues have one inside the main loop —
 * at Spa it is a 1.1km way tagged `sport=karting` and named "Kart" — and
 * rendered at the same weight as the circuit it reads as part of the track.
 * OSM distinguishes them cleanly with `sport`: the real layout is
 * `sport=motor`, so a single negated tag filter separates them at query time.
 *
 * Pit lanes are deliberately kept. They are `sport=motor` and genuinely
 * relevant — spec §5.3 has `pitlaneWalk` as a session kind, and knowing where
 * the pit lane runs matters when planning one.
 */
function query([west, south, east, north]) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:120];(way["highway"="raceway"]["sport"!="karting"](${bbox}););out geom;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass is free, shared and volunteer-run, and it rate-limits and times out.
 *
 * This script previously failed outright on the first 504, which left the venue
 * half-extracted — tiles present, circuit missing — and that is a confusing
 * state to debug later. The scenery script already backed off; this one needs
 * the same treatment.
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

for (const key of keys) {
  const venue = config.venues[key];
  if (!venue) {
    console.error(`Unknown venue: ${key}`);
    process.exit(1);
  }

  console.log(`\n=== ${key} — ${venue.label} ===`);

  const data = await overpass(query(venue.bbox));
  const ways = data.elements.filter((e) => e.type === 'way' && e.geometry);

  const features = ways.map((w) => ({
    type: 'Feature',
    id: w.id,
    properties: {
      osmId: w.id,
      name: w.tags?.name ?? null,
      // Retained so the app can distinguish the layouts later. Not interpreted
      // here — which layout a way belongs to is a circuit-data question, and
      // spec §0.2 reserves that for human sourcing.
      ref: w.tags?.ref ?? null,
      oneway: w.tags?.oneway ?? null,
    },
    geometry: {
      type: 'LineString',
      coordinates: w.geometry.map((p) => [p.lon, p.lat]),
    },
  }));

  const clustered = keepMainCluster(features);
  features.length = 0;
  features.push(...clustered);

  let west = 180, south = 90, east = -180, north = -90, points = 0;
  for (const f of features) {
    for (const [lon, lat] of f.geometry.coordinates) {
      points++;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  // A circuit that occupies a tiny corner of the extract almost always means
  // the query matched a kart track or one layout and missed the main loop —
  // which is precisely the bug that produced a Nordschleife-shaped hole.
  const [bw, bs, be, bn] = venue.bbox;
  const coverage =
    ((east - west) * (north - south)) / ((be - bw) * (bn - bs));

  console.log(`ways: ${features.length}, points: ${points}`);
  console.log(
    `bbox: ${west.toFixed(4)},${south.toFixed(4)} .. ${east.toFixed(4)},${north.toFixed(4)}`,
  );
  const metrics = circuitMetrics(features);
  console.log(
    `covers ${(coverage * 100).toFixed(1)}% of the extract area | surface ${(metrics.surfaceMetres / 1000).toFixed(2)}km | site ${(metrics.widthMetres / 1000).toFixed(2)} x ${(metrics.heightMetres / 1000).toFixed(2)}km`,
  );
  if (coverage < 0.05) {
    console.warn(
      '  WARNING: circuit occupies <5% of the extract — check the main loop was matched.',
    );
  }

  // `.json` rather than `.geojson`: Metro resolves JSON modules natively on
  // both web and native, so the circuit can be a plain import with no
  // per-platform asset handling. At tens of KB that is the simplest option.
  const out = join(OUT_DIR, `${key}.json`);
  writeFileSync(
    out,
    JSON.stringify({
      type: 'FeatureCollection',
      // ODbL. The map renders visible attribution; this records provenance.
      attribution: '© OpenStreetMap contributors',
      metrics,
      features,
    }),
  );
  console.log(`wrote ${out}`);

  /**
   * Corridor mask — everything further than CORRIDOR_METRES from the circuit.
   *
   * Built as an inverted polygon: an outer ring covering the whole extract,
   * with the dissolved corridor punched out as holes. Rendered as an opaque
   * fill on top of every other layer, it hides the surrounding world in one
   * pass — including place labels outside the corridor, which is why no
   * point-in-polygon filtering is needed for those.
   */
  const buffered = features.map((f) =>
    buffer(f, CORRIDOR_METRES, { units: 'meters' }),
  ).filter(Boolean);

  // Dissolve the 98 per-way buffers into one corridor, or the overlapping
  // rings punch holes in each other and the mask comes out shredded.
  let corridor = buffered[0];
  for (let i = 1; i < buffered.length; i++) {
    corridor = union(featureCollection([corridor, buffered[i]])) ?? corridor;
  }

  /**
   * Outer ring, far beyond the tile extract.
   *
   * A small pad is not enough. The camera centre is bounded to the extract, but
   * at 65° of pitch the view reaches to the horizon — tens of kilometres past
   * the edge — and any terrain beyond the mask's outer ring keeps rendering.
   * One degree is roughly 111km, which covers the furthest the camera can see
   * from inside the bounds at the shallowest permitted zoom.
   */
  const [w, s, e, n] = venue.bbox;
  const pad = 1.0;
  const masked = mask(corridor, {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [w - pad, s - pad],
        [e + pad, s - pad],
        [e + pad, n + pad],
        [w - pad, n + pad],
        [w - pad, s - pad],
      ]],
    },
  });

  const maskOut = join(OUT_DIR, `${key}.mask.json`);
  writeFileSync(maskOut, JSON.stringify(masked));
  console.log(`wrote ${maskOut} (corridor ${CORRIDOR_METRES}m)`);

  // ── kerbs ────────────────────────────────────────────────────────────────
  const kerbs = cornerSegments(features);
  const kerbOut = join(OUT_DIR, `${key}.kerbs.json`);
  writeFileSync(
    kerbOut,
    JSON.stringify({ type: 'FeatureCollection', features: kerbs }),
  );
  console.log(`wrote ${kerbOut} (${kerbs.length} corner segments)`);
  await sleep(2000);
}

/**
 * Measure the circuit.
 *
 * `surfaceMetres` is the summed length of every extracted way, which is NOT lap
 * distance: pit lanes, service loops and parallel layout variants all count once
 * each. It is an upper bound and a sanity check, not a spec figure — comparing
 * it against the published lap length is the fastest way to notice that a
 * public-road section is missing.
 *
 * `widthMetres`/`heightMetres` are the site's extent, which is the number that
 * actually matters to someone deciding whether to walk from one corner to
 * another.
 */
function circuitMetrics(features) {
  let W = 180, E = -180, S = 90, N = -90, surface = 0;
  for (const f of features) {
    const c = f.geometry.coordinates;
    for (let i = 0; i < c.length; i++) {
      W = Math.min(W, c[i][0]); E = Math.max(E, c[i][0]);
      S = Math.min(S, c[i][1]); N = Math.max(N, c[i][1]);
      if (i > 0) {
        const latScale = Math.cos((c[i][1] * Math.PI) / 180);
        const dx = (c[i][0] - c[i - 1][0]) * latScale * 111320;
        const dy = (c[i][1] - c[i - 1][1]) * 110540;
        surface += Math.hypot(dx, dy);
      }
    }
  }
  const midScale = Math.cos((((S + N) / 2) * Math.PI) / 180);
  return {
    surfaceMetres: Math.round(surface),
    widthMetres: Math.round((E - W) * midScale * 111320),
    heightMetres: Math.round((N - S) * 110540),
  };
}

/**
 * Keep only the circuit, discarding unrelated racing surface in the same bbox.
 *
 * A venue's extract rectangle usually contains more than the circuit. Le Mans
 * has a separate motorsport facility about 4km west of la Sarthe — three
 * unnamed `highway=raceway` ways, 2.4km in total — and pulling those in tripled
 * the circuit's bounding box. Since the opening camera is fitted to that box,
 * the map would have opened zoomed out with the actual track small in one
 * corner.
 *
 * Single-link clustering: ways within `gapMetres` of each other are the same
 * circuit, and the cluster with the greatest total length wins. That is a safer
 * rule than "nearest the bbox centre", because a venue's extract is padded
 * asymmetrically and the circuit is not necessarily central.
 *
 * The gap is tied to the corridor width rather than picked freely. Two ways
 * further apart than twice the corridor are ways whose masks will not merge,
 * so keeping both renders the venue as disconnected islands floating in black
 * — which is exactly what Le Mans looked like. Defining the cluster in terms
 * of what the mask will actually join makes that impossible by construction.
 */
function keepMainCluster(features, gapMetres = CORRIDOR_METRES * 2) {
  if (features.length < 2) return features;

  const stats = features.map((f) => {
    const c = f.geometry.coordinates;
    const lat = c[0][1];
    const latScale = Math.cos((lat * Math.PI) / 180);
    let W = 180, E = -180, S = 90, N = -90, len = 0;
    for (let i = 0; i < c.length; i++) {
      W = Math.min(W, c[i][0]); E = Math.max(E, c[i][0]);
      S = Math.min(S, c[i][1]); N = Math.max(N, c[i][1]);
      if (i > 0) {
        const dx = (c[i][0] - c[i - 1][0]) * latScale * 111320;
        const dy = (c[i][1] - c[i - 1][1]) * 110540;
        len += Math.hypot(dx, dy);
      }
    }
    return { W, E, S, N, len, latScale };
  });

  /** Gap between two axis-aligned boxes, in metres. */
  const gap = (a, b) => {
    const dx = Math.max(0, Math.max(a.W - b.E, b.W - a.E)) * a.latScale * 111320;
    const dy = Math.max(0, Math.max(a.S - b.N, b.S - a.N)) * 110540;
    return Math.hypot(dx, dy);
  };

  // Union-find over "close enough to be the same circuit".
  const parent = features.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (gap(stats[i], stats[j]) <= gapMetres) parent[find(i)] = find(j);
    }
  }

  const byRoot = new Map();
  features.forEach((f, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, { idx: [], len: 0 });
    const g = byRoot.get(r);
    g.idx.push(i);
    g.len += stats[i].len;
  });

  const groups = [...byRoot.values()].sort((a, b) => b.len - a.len);
  const main = groups[0];
  const dropped = features.length - main.idx.length;
  if (dropped > 0) {
    const otherLen = groups.slice(1).reduce((t, g) => t + g.len, 0);
    console.log(
      `  dropped ${dropped} way(s) in ${groups.length - 1} unrelated cluster(s), ${Math.round(otherLen)}m total`,
    );
  }
  return main.idx.map((i) => features[i]);
}

/**
 * Find the corners of a circuit by curvature.
 *
 * ── These are derived, not sourced. Read this before trusting them. ────────
 * Everything else in this file comes from OSM. Kerbs do not: OSM does not map
 * racetrack kerbing, so there is no data to extract. These segments are
 * inferred from where the centreline actually bends, which puts them where
 * kerbs generally are — at corner apexes — without being a survey of where the
 * kerbing physically starts and stops.
 *
 * That distinction matters for this app more than it would elsewhere. An apex
 * is a real photographic subject, and a kerb drawn 20 metres from where the
 * paint is could send someone to the wrong side of a corner. They are a visual
 * cue for reading the shape of the lap, nothing more, and nothing downstream
 * may treat them as position data.
 *
 * Method: walk each way, measure the heading change per metre at every vertex,
 * and keep runs where it exceeds a threshold. Straights fall below it, and the
 * Nordschleife's long fast curves — Schwedenkreuz, Kesselchen — sit between,
 * which is why the threshold is on turn rate rather than total angle.
 */
export function cornerSegments(features) {
  /**
   * Degrees of heading change per metre above which a vertex counts as corner.
   *
   * Turn rate is the inverse of radius: 180/(π·R) degrees per metre. So this
   * threshold is really a slowest-corner setting —
   *
   *   0.55 °/m ≈ 104m radius   (tight and medium corners only)
   *   0.22 °/m ≈ 260m radius   (includes fast sweepers)
   *   0.14 °/m ≈ 400m radius   (includes near-straight kinks)
   *
   * At 0.55 the fast corners were all missing: Eau Rouge, Raidillon,
   * Blanchimont, Schwedenkreuz and Kesselchen are kerbed in reality but sit
   * well above 104m radius. 0.22 brings them in while leaving true straights —
   * Döttinger Höhe, the Kemmel — clean.
   */
  const TURN_RATE_THRESHOLD = 0.22;

  /**
   * Distance either side of a vertex used to measure heading change.
   *
   * Measuring between adjacent vertices makes the result a function of however
   * finely that stretch happens to be mapped: closely-spaced nodes on a
   * straight produce spurious curvature, and a sparsely-mapped sweeper produces
   * almost none. Comparing chords ~25m either side smooths the node noise and
   * estimates the real radius, which is what makes the lower threshold safe.
   */
  const CURVATURE_WINDOW_M = 25;
  /** Discard runs shorter than this; isolated spikes are usually node noise. */
  const MIN_RUN_VERTICES = 3;
  /** A corner shorter than this is a kink in the mapping, not a kerbed apex. */
  const MIN_CORNER_METRES = 25;

  /**
   * Corners tighter than this get no kerbing.
   *
   * The kerb is drawn with MapLibre's `line-offset`, which offsets each vertex
   * along its normal. Where the offset distance exceeds the local radius the
   * offset geometry folds through itself and renders as a tangle of loops
   * spilling outside the track — visible at the Karussell and in the Hatzenbach
   * esses, both of which are far tighter than this.
   *
   * Dropping them is the honest option: a hairpin genuinely is kerbed, but a
   * folded ribbon of red and white sprawling across the map is worse than
   * nothing, and offsetting tight polylines correctly needs proper mitred
   * geometry generated at build time rather than a paint property.
   *
   * ── Why 40, not the offset's own reach ─────────────────────────────────────
   * `kerbOffset` in ui/map/style.ts reaches 29m at z18, the closest zoom the app
   * allows (VENUE_VIEW maxZoom). A radius floor equal to that reach is not
   * enough — the fold happens exactly *at* offset == radius, and anything close
   * to it still renders as a pinched, near-degenerate ribbon rather than a clean
   * one. 40m keeps offset/radius at 29/40 ≈ 0.73, comfortably inside the safe
   * side of that ratio, while only dropping the tightest 10–20% of corners per
   * venue. Re-check this margin if `kerbOffset`'s stops ever change.
   */
  const MIN_CORNER_RADIUS_M = 40;
  /** Ways shorter than this are connectors and slip roads, not racing line. */
  const MIN_WAY_METRES = 60;

  /**
   * Pit lanes are excluded.
   *
   * They run parallel to the track through the corners at either end of the
   * pit straight, and kerbing every raceway way independently produced a set
   * of concentric red/white arcs stacked outside the corner — the pit lane's
   * kerbs, the support pit lane's kerbs, and the track's, all offset from
   * different centrelines.
   *
   * Pit lanes are kept in the circuit geometry itself (spec §5.3 has
   * `pitlaneWalk` as a session kind); they simply do not get kerbing.
   */
  const isPitLane = (name) => name != null && /pit\s*lane/i.test(name);

  const out = [];

  for (const feature of features) {
    if (isPitLane(feature.properties?.name)) continue;

    const pts = feature.geometry.coordinates;
    if (pts.length < 4) continue;

    const latScale = Math.cos((pts[0][1] * Math.PI) / 180);
    const metres = (a, b) => {
      const dx = (b[0] - a[0]) * latScale * 111320;
      const dy = (b[1] - a[1]) * 110540;
      return Math.hypot(dx, dy);
    };
    const heading = (a, b) =>
      Math.atan2((b[0] - a[0]) * latScale, b[1] - a[1]) * (180 / Math.PI);

    /**
     * Skip short *unnamed* connector ways — slip roads, paddock links, the
     * stubs joining layouts. They bend sharply by nature and were being kerbed
     * as though they were corners.
     *
     * The name check matters more than it looks. Spa maps each corner as its own
     * short way: La Source is 57m and the Chicane 39m, so a flat length cutoff
     * silently deleted the two most recognisable corners on the circuit. A way
     * carrying a name is a documented part of the layout regardless of length.
     */
    const named = feature.properties?.name != null;
    let wayLength = 0;
    for (let i = 1; i < pts.length; i++) wayLength += metres(pts[i - 1], pts[i]);
    if (!named && wayLength < MIN_WAY_METRES) continue;

    // Cumulative distance along the way, so the window can be found by distance
    // rather than by vertex count.
    const along = [0];
    for (let i = 1; i < pts.length; i++) {
      along[i] = along[i - 1] + metres(pts[i - 1], pts[i]);
    }

    const isCorner = new Array(pts.length).fill(false);
    /** Local turn rate per vertex, kept so tight corners can be rejected. */
    const turnRate = new Array(pts.length).fill(0);
    for (let i = 1; i < pts.length - 1; i++) {
      // Walk out to roughly CURVATURE_WINDOW_M either side.
      let a = i;
      while (a > 0 && along[i] - along[a] < CURVATURE_WINDOW_M) a--;
      let b = i;
      while (b < pts.length - 1 && along[b] - along[i] < CURVATURE_WINDOW_M) b++;
      if (a === i || b === i) continue;

      const h1 = heading(pts[a], pts[i]);
      const h2 = heading(pts[i], pts[b]);
      let delta = Math.abs(h2 - h1);
      if (delta > 180) delta = 360 - delta;

      const run = along[b] - along[a];
      if (run <= 0) continue;
      turnRate[i] = delta / run;
      if (turnRate[i] > TURN_RATE_THRESHOLD) isCorner[i] = true;
    }

    let start = -1;
    for (let i = 0; i <= pts.length; i++) {
      if (isCorner[i]) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        if (i - start >= MIN_RUN_VERTICES) {
          // Extend a vertex either side so the kerb runs into and out of the
          // apex rather than stopping exactly on it.
          const a = Math.max(0, start - 1);
          const b = Math.min(pts.length - 1, i);
          const coords = pts.slice(a, b + 1);

          let length = 0;
          for (let k = 1; k < coords.length; k++) {
            length += metres(coords[k - 1], coords[k]);
          }

          // Tightest point in the run governs whether the offset will fold.
          // radius = 180 / (π · turnRate), turnRate in degrees per metre.
          let peakRate = 0;
          for (let k = start; k < i; k++) {
            if (turnRate[k] > peakRate) peakRate = turnRate[k];
          }
          const minRadius = peakRate > 0 ? 180 / (Math.PI * peakRate) : Infinity;

          if (length >= MIN_CORNER_METRES && minRadius >= MIN_CORNER_RADIUS_M) {
            out.push({
              type: 'Feature',
              properties: {
                derived: true,
                metres: Math.round(length),
                radiusM: Number.isFinite(minRadius) ? Math.round(minRadius) : null,
              },
              geometry: { type: 'LineString', coordinates: coords },
            });
          }
        }
        start = -1;
      }
    }
  }

  return out;
}
