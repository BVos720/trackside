/**
 * Drawing a street circuit by tracing it — TASKS.md F7.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 * A permanent circuit is one closed piece of tarmac and OpenStreetMap knows
 * its shape, which is where every venue in this app comes from. A street
 * circuit is not: it is an ordinary set of public roads that becomes a track
 * for one weekend a year, and no map has it drawn as a circuit. Monaco,
 * Adelaide, Baku and Macau are all just streets the rest of the time.
 *
 * So the person draws it. A finger on a phone is nowhere near accurate enough
 * to be a centreline — it wobbles by tens of metres and cuts every corner —
 * but it is *unambiguous* about which roads are meant, and the roads
 * themselves are already in the data with metre accuracy. Snapping the one to
 * the other gets a usable circuit from a rough gesture.
 *
 * Pure, and takes its network as an argument, so the whole thing can be
 * tested against a handful of made-up streets rather than a venue extract.
 */
import type { LatLon } from '../domain/common';
import { haversineMetres } from './geo';
import { routeThrough, type WalkNetwork, type WalkWay } from './route';

/**
 * Ways a car can be raced along.
 *
 * A subset of what `extract-paths.mjs` collects, which is deliberately wider
 * because it is answering "can somebody walk here". Footways and steps are
 * excellent for reaching a spot and are not a racing surface, and leaving
 * them in would let a traced lap cut through a pedestrian alley that no car
 * will ever use.
 */
const DRIVABLE = new Set([
  'service',
  'residential',
  'living_street',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
]);

export function drivableWays(ways: readonly WalkWay[]): WalkWay[] {
  return ways.filter((w) => w.highway !== undefined && DRIVABLE.has(w.highway));
}

export interface TracedCircuit {
  /** The snapped line, following real roads. */
  readonly coordinates: readonly LatLon[];
  /** Length of the traced lap, metres. */
  readonly metres: number;
  /**
   * How much of it is not on any road, metres.
   *
   * The honesty signal. A trace across a park or over a river will still
   * return a line, because the router joins what it cannot follow with a
   * straight hop — and a caller that showed that as a circuit without saying
   * so would be presenting a guess as a survey.
   */
  readonly offRoadMetres: number;
  /** True when the ends met and the lap was closed. */
  readonly closed: boolean;
}

/**
 * How close the two ends have to be before the lap is treated as a loop.
 *
 * Generous, because the gesture is. Nobody finishing a lap with their finger
 * lands within a few metres of where they started, and a circuit that fails
 * to close is far more annoying than one that closes slightly early — the
 * roads decide the actual geometry either way, so the only thing this
 * threshold controls is whether the last stretch gets routed at all.
 */
const CLOSE_LOOP_M = 250;

/**
 * Turn a drawn line into a lap along real roads.
 *
 * Consecutive drawn points are routed against the network in order, so the
 * result follows the streets the gesture passed near rather than the gesture
 * itself. The drawn points are waypoints, not vertices.
 *
 * Returns null for fewer than two points, because one point is not a line and
 * inventing a lap from it would be fabrication.
 */
export function traceCircuit(
  drawn: readonly LatLon[],
  network: WalkNetwork,
): TracedCircuit | null {
  if (drawn.length < 2) return null;

  const first = drawn[0]!;
  const last = drawn[drawn.length - 1]!;
  const closed = haversineMetres(first, last) <= CLOSE_LOOP_M;

  // Closing the loop before routing rather than after: the last stretch is
  // part of the lap and has to follow roads like the rest of it, and a
  // straight line from the finish back to the start would be the one segment
  // that ignored the whole point of this.
  const points = closed ? [...drawn, first] : [...drawn];

  const route = routeThrough(network, points);

  const coordinates: LatLon[] = [];
  for (const leg of route.legs) {
    for (const c of leg.coordinates) {
      const previous = coordinates[coordinates.length - 1];
      // Legs meet end to end, so every join would otherwise repeat a point.
      if (previous && previous.latitude === c.latitude && previous.longitude === c.longitude) {
        continue;
      }
      coordinates.push(c);
    }
  }

  if (coordinates.length < 2) return null;

  return {
    coordinates,
    metres: route.metres,
    offRoadMetres: route.offNetworkMetres,
    closed,
  };
}

/**
 * Is this trace good enough to offer as a circuit?
 *
 * A fraction rather than a distance, because the same 200m off-road is
 * nothing in a 6km lap and most of a short one. A third is deliberately
 * lenient: pit lanes and paddock roads are frequently missing from OSM, and
 * refusing a trace that is otherwise right because of one unmapped stretch
 * would make the feature useless at exactly the venues it is for.
 */
export function traceIsUsable(trace: TracedCircuit): boolean {
  if (trace.metres <= 0) return false;
  return trace.offRoadMetres / trace.metres <= 1 / 3;
}
