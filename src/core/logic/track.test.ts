import { describe, expect, it } from 'vitest';
import {
  TRACK_OFFSET_METRES,
  metresBetween,
  snapBesideTrack,
  type TrackLines,
} from './track';

/**
 * A straight run of track heading due east at 50°N.
 *
 * Due east means "north of the line" and "south of the line" are unambiguous,
 * which is what makes the side assertions below meaningful.
 */
const EAST_WEST: TrackLines = [
  [
    [6.9, 50.35],
    [6.91, 50.35],
    [6.92, 50.35],
  ],
];

describe('snapBesideTrack', () => {
  it('pushes a tap on the centreline off to one side', () => {
    const r = snapBesideTrack({ latitude: 50.35, longitude: 6.91 }, EAST_WEST);
    expect(r).not.toBeNull();
    expect(r!.moved).toBe(true);
    // Landed the offset distance away rather than staying on the asphalt.
    expect(metresBetween(r!.position, r!.onTrack)).toBeCloseTo(
      TRACK_OFFSET_METRES,
      0,
    );
  });

  it('keeps a tap on the north side to the north', () => {
    // ~5m north of the line: inside the band, so it gets pushed out — but the
    // side it was on must be preserved, or the pin jumps across the track.
    const tap = { latitude: 50.35 + 5 / 110_540, longitude: 6.91 };
    const r = snapBesideTrack(tap, EAST_WEST)!;
    expect(r.moved).toBe(true);
    expect(r.position.latitude).toBeGreaterThan(50.35);
  });

  it('keeps a tap on the south side to the south', () => {
    const tap = { latitude: 50.35 - 5 / 110_540, longitude: 6.91 };
    const r = snapBesideTrack(tap, EAST_WEST)!;
    expect(r.moved).toBe(true);
    expect(r.position.latitude).toBeLessThan(50.35);
  });

  it('leaves a tap that is already clear of the track exactly where it was', () => {
    // 200m north. Snapping this back to the verge would fight the user, who
    // may well be marking a spot on a hillside well away from the barrier.
    const tap = { latitude: 50.35 + 200 / 110_540, longitude: 6.91 };
    const r = snapBesideTrack(tap, EAST_WEST)!;
    expect(r.moved).toBe(false);
    expect(r.position).toEqual(tap);
    expect(r.distanceMetres).toBeGreaterThan(190);
  });

  it('measures distance to the nearest point on the line, not to a vertex', () => {
    // Directly between two vertices: a vertex-only search would report the
    // distance to 6.90 or 6.92 instead of the perpendicular.
    const tap = { latitude: 50.35 + 60 / 110_540, longitude: 6.915 };
    const r = snapBesideTrack(tap, EAST_WEST)!;
    expect(r.distanceMetres).toBeCloseTo(60, 0);
    expect(r.onTrack.longitude).toBeCloseTo(6.915, 5);
  });

  it('picks the nearest of several ways', () => {
    const lines: TrackLines = [
      [
        [6.9, 50.4],
        [6.92, 50.4],
      ],
      [
        [6.9, 50.35],
        [6.92, 50.35],
      ],
    ];
    const r = snapBesideTrack({ latitude: 50.3501, longitude: 6.91 }, lines)!;
    expect(r.onTrack.latitude).toBeCloseTo(50.35, 4);
  });

  it('returns null for empty geometry rather than inventing a position', () => {
    expect(snapBesideTrack({ latitude: 50.35, longitude: 6.91 }, [])).toBeNull();
    expect(snapBesideTrack({ latitude: 50.35, longitude: 6.91 }, [[]])).toBeNull();
  });

  it('never lands closer to the track than the offset when it moves', () => {
    // Sweep across the band from one side to the other.
    for (let d = -13; d <= 13; d += 1) {
      const tap = { latitude: 50.35 + d / 110_540, longitude: 6.913 };
      const r = snapBesideTrack(tap, EAST_WEST)!;
      if (!r.moved) continue;
      expect(metresBetween(r.position, r.onTrack)).toBeGreaterThan(
        TRACK_OFFSET_METRES - 0.5,
      );
    }
  });
});
