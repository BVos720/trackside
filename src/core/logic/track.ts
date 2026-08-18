/**
 * Placing spots relative to the circuit.
 *
 * A photography position is never *on* the racing surface — you stand beside
 * it, behind whatever separates you from it. A pin dropped on the asphalt is
 * always a mis-tap, so taps are snapped to the verge on the side the user
 * aimed at.
 *
 * Pure geometry with no storage or map dependency, so it is testable without a
 * renderer. The circuit geometry is passed in rather than imported, keeping
 * `core/` free of asset imports (§2.3).
 */
import type { LatLon } from '../domain/common';

/** A circuit centreline: one entry per OSM way, each a list of [lon, lat]. */
export type TrackLines = readonly (readonly (readonly [number, number])[])[];

/**
 * How far from the centreline a snapped spot lands, in metres.
 *
 * Roughly half a track width plus the verge: far enough to read as "beside the
 * track" at the zooms spots are placed at, close enough to still be the
 * position the user meant. Not a claim about where a barrier physically is —
 * that is not in the data.
 */
export const TRACK_OFFSET_METRES = 14;

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Local metres-per-degree, good enough over the span of one circuit. */
function scale(atLat: number) {
  return { x: 111_320 * Math.cos(rad(atLat)), y: 110_540 };
}

export interface SnapResult {
  /** Where the spot should go. */
  readonly position: LatLon;
  /** Nearest point on the centreline. */
  readonly onTrack: LatLon;
  /** Distance from the tap to the centreline, metres. */
  readonly distanceMetres: number;
  /** True when the tap was inside the offset band and was pushed out. */
  readonly moved: boolean;
}

/**
 * Snap a tapped point to the side of the track.
 *
 * Returns the tap unchanged when it is already comfortably clear of the
 * centreline — dragging a spot 200m from the track back to the verge would
 * fight the user rather than help them. Only taps within the offset band are
 * pushed out, and always to the side they were already on.
 *
 * `null` when the circuit has no usable geometry, so the caller can fall back
 * to the raw tap rather than silently dropping the spot.
 */
export function snapBesideTrack(
  tap: LatLon,
  lines: TrackLines,
  offsetMetres: number = TRACK_OFFSET_METRES,
): SnapResult | null {
  const { x: mx, y: my } = scale(tap.latitude);

  // Work in local metres relative to the tap: the maths below is planar, and
  // over a few hundred metres the projection error is far below the precision
  // anyone is placing a spot with.
  const toXY = (lon: number, lat: number) => ({
    x: (lon - tap.longitude) * mx,
    y: (lat - tap.latitude) * my,
  });

  let best: {
    d2: number;
    px: number;
    py: number;
    dirX: number;
    dirY: number;
  } | null = null;

  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toXY(line[i - 1]![0], line[i - 1]![1]);
      const b = toXY(line[i]![0], line[i]![1]);

      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      if (len2 === 0) continue;

      // Projection of the origin (the tap) onto this segment, clamped to it.
      let t = -(a.x * vx + a.y * vy) / len2;
      t = Math.max(0, Math.min(1, t));

      const px = a.x + t * vx;
      const py = a.y + t * vy;
      const d2 = px * px + py * py;

      if (best === null || d2 < best.d2) {
        const len = Math.sqrt(len2);
        best = { d2, px, py, dirX: vx / len, dirY: vy / len };
      }
    }
  }

  if (best === null) return null;

  const distance = Math.sqrt(best.d2);
  const onTrack: LatLon = {
    longitude: tap.longitude + best.px / mx,
    latitude: tap.latitude + best.py / my,
  };

  // Already clear of the track: leave it exactly where it was put.
  if (distance >= offsetMetres) {
    return { position: tap, onTrack, distanceMetres: distance, moved: false };
  }

  /**
   * Which side of the track the tap is on.
   *
   * Cross product of the segment direction with the vector from the nearest
   * point to the tap. The tap is the origin here, so that vector is simply
   * `-(px, py)`. A zero cross product means the tap landed exactly on the
   * centreline, where there is no side to preserve — the left-hand normal is
   * chosen so the result is at least deterministic rather than NaN.
   */
  const toTapX = -best.px;
  const toTapY = -best.py;
  const cross = best.dirX * toTapY - best.dirY * toTapX;
  const side = cross === 0 ? 1 : Math.sign(cross);

  // Left-hand normal of the direction vector, flipped to the tap's side.
  const nx = -best.dirY * side;
  const ny = best.dirX * side;

  return {
    position: {
      longitude: onTrack.longitude + (nx * offsetMetres) / mx,
      latitude: onTrack.latitude + (ny * offsetMetres) / my,
    },
    onTrack,
    distanceMetres: distance,
    moved: true,
  };
}

/** Great-circle distance in metres — re-exported shape for convenience. */
export function metresBetween(a: LatLon, b: LatLon): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
