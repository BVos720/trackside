/**
 * Geographic maths — spec §2.3 constraint 4.
 *
 * Haversine and bearing arithmetic in plain application code. No spatial
 * library, no PostGIS type reaches the domain layer. PostGIS stays server-side
 * in Milestone 3 where spatial indexes genuinely matter; at the scale of one
 * circuit's spots, iterating in JavaScript is faster than any index lookup.
 *
 * ── A warning that belongs here rather than anywhere else ──────────────────
 * Nothing in this file may be used to populate `WalkEdge.minutes`. Straight-
 * line distance is not walking time at a racetrack; see the header of
 * ../domain/walkEdge.ts for why that mistake is unrecoverable.
 */
import type { LatLon } from '../domain/common';

const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;
const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Normalise a bearing to [0, 360).
 *
 * Handles negative inputs correctly, which `%` alone does not: in JavaScript
 * `-10 % 360` is `-10`, not `350`.
 */
export function normaliseBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Normalise an angular difference to (-180, 180].
 *
 * This is the form wanted when asking "how far apart are these two directions,
 * and which side" — a difference of 350° is really -10°.
 */
export function normaliseSigned(degrees: number): number {
  const wrapped = normaliseBearing(degrees);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Great-circle distance in metres. */
export function haversineMetres(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial great-circle bearing from `a` to `b`, in degrees true.
 *
 * Note this is the *initial* bearing; over the distances involved at a single
 * circuit the difference from the final bearing is negligible, but the name is
 * accurate for anyone who later reuses this over longer spans.
 */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normaliseBearing(toDegrees(Math.atan2(y, x)));
}

/** Smallest absolute angle between two bearings, 0–180. */
export function angularDistance(from: number, to: number): number {
  return Math.abs(normaliseSigned(to - from));
}

/** Rendered in place of a compass point when the bearing is not a number. */
export const UNKNOWN_COMPASS_POINT = '—';

/**
 * The 16-point compass label for a bearing — for display only.
 *
 * Non-finite input yields `UNKNOWN_COMPASS_POINT` rather than a label.
 *
 * This guard is not theoretical: without it, `NaN` flows through
 * `normaliseBearing` unchanged, `points[NaN]` evaluates to `undefined`, and the
 * function returns `undefined` while still typechecking as `string` — which
 * reached the screen as the literal text "undefined" next to a bearing readout.
 * An honest dash is the right answer for an unknown direction, matching how the
 * rest of the app renders undocumented data (§0.2).
 */
export function compassPoint(degrees: number): string {
  if (!Number.isFinite(degrees)) return UNKNOWN_COMPASS_POINT;

  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ] as const;
  const index = Math.round(normaliseBearing(degrees) / 22.5) % 16;
  return points[index] ?? UNKNOWN_COMPASS_POINT;
}

/**
 * Is this position inside a venue's bounding box?
 *
 * Used to decide whether "add my current location" makes sense. At home in
 * Breda that button would drop a spot two hundred kilometres from the circuit
 * you are looking at, so it only appears when you are actually there.
 *
 * ── Deliberately a box, not the corridor ──────────────────────────────────
 * The tighter test would be the 300m corridor the map already draws. This uses
 * the wider extract bounds on purpose: the car park, the campsite and the walk
 * in are all outside the corridor and all places you would legitimately mark a
 * spot from. Being generous here costs a spot you can move; being strict costs
 * the feature exactly when it is useful.
 *
 * `bounds` is [[west, south], [east, north]] — the same order the venue table
 * and `pmtiles extract` use, so no axis juggling at the call site.
 */
export function withinBounds(
  point: LatLon,
  bounds: readonly [readonly [number, number], readonly [number, number]],
): boolean {
  const { latitude, longitude } = point;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  const [[west, south], [east, north]] = bounds;
  return (
    longitude >= west &&
    longitude <= east &&
    latitude >= south &&
    latitude <= north
  );
}
