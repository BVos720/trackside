import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_COMPASS_POINT,
  angularDistance,
  bearingDegrees,
  compassPoint,
  haversineMetres,
  normaliseBearing,
  normaliseSigned,
  withinBounds,
} from './geo';

describe('normaliseBearing', () => {
  it('wraps negatives into [0, 360)', () => {
    // The reason this function exists: JavaScript's % keeps the sign, so a
    // bare `-10 % 360` is -10 and every downstream comparison is wrong.
    expect(normaliseBearing(-10)).toBe(350);
    expect(normaliseBearing(-370)).toBe(350);
  });

  it('wraps values at or above 360', () => {
    expect(normaliseBearing(360)).toBe(0);
    expect(normaliseBearing(450)).toBe(90);
  });

  it('leaves in-range values alone', () => {
    expect(normaliseBearing(0)).toBe(0);
    expect(normaliseBearing(180)).toBe(180);
  });
});

describe('normaliseSigned', () => {
  it('expresses a difference as the shorter way round', () => {
    expect(normaliseSigned(350)).toBe(-10);
    expect(normaliseSigned(-350)).toBe(10);
  });

  it('keeps 180 positive rather than flipping to -180', () => {
    expect(normaliseSigned(180)).toBe(180);
  });
});

describe('haversineMetres', () => {
  it('measures one degree of latitude as ~111.2km', () => {
    const d = haversineMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('measures one degree of longitude at the equator as ~111.2km', () => {
    const d = haversineMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('shrinks a degree of longitude with latitude', () => {
    // At 60°N a degree of longitude is about half its equatorial width. This
    // is the behaviour that makes naive flat-earth distance wrong in Europe.
    const equator = haversineMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    const north = haversineMetres(
      { latitude: 60, longitude: 0 },
      { latitude: 60, longitude: 1 },
    );
    expect(north / equator).toBeCloseTo(0.5, 1);
  });

  it('is zero for identical points and symmetric otherwise', () => {
    const a = { latitude: 50.3356, longitude: 6.9475 };
    const b = { latitude: 50.34, longitude: 6.95 };
    expect(haversineMetres(a, a)).toBe(0);
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 9);
  });
});

describe('bearingDegrees', () => {
  it('reports due north as 0', () => {
    expect(
      bearingDegrees({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(0, 6);
  });

  it('reports due east as 90', () => {
    expect(
      bearingDegrees({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeCloseTo(90, 6);
  });

  it('reports due south as 180 and due west as 270', () => {
    expect(
      bearingDegrees({ latitude: 1, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toBeCloseTo(180, 6);
    expect(
      bearingDegrees({ latitude: 0, longitude: 1 }, { latitude: 0, longitude: 0 }),
    ).toBeCloseTo(270, 6);
  });
});

describe('angularDistance', () => {
  it('never exceeds 180 and takes the short way round', () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(10, 350)).toBe(20);
    expect(angularDistance(0, 180)).toBe(180);
  });
});

describe('compassPoint', () => {
  it('labels the cardinals', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
  });

  it('wraps past 360 rather than indexing off the end', () => {
    expect(compassPoint(360)).toBe('N');
    expect(compassPoint(359)).toBe('N');
  });

  it('returns a dash for non-finite input instead of the string "undefined"', () => {
    // Regression: NaN passes through normaliseBearing unchanged, so
    // points[NaN] was `undefined` — returned from a function typed `string`
    // and rendered on screen as the literal text "undefined".
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(compassPoint(bad)).toBe(UNKNOWN_COMPASS_POINT);
    }
  });

  it('always returns a non-empty label for any finite bearing', () => {
    for (let d = -720; d <= 720; d += 0.5) {
      const label = compassPoint(d);
      expect(label).toBeTruthy();
      expect(label).not.toBe(UNKNOWN_COMPASS_POINT);
    }
  });
});

describe('withinBounds', () => {
  /** The Nürburgring extract, [[west, south], [east, north]]. */
  const RING = [
    [6.88, 50.3],
    [7.04, 50.41],
  ] as const;

  const at = (latitude: number, longitude: number) => ({ latitude, longitude });

  it('accepts a position inside the box', () => {
    expect(withinBounds(at(50.3523, 6.9628), RING)).toBe(true);
  });

  it('rejects a position outside it', () => {
    // Breda — where the planning happens, not the shooting.
    expect(withinBounds(at(51.5719, 4.7683), RING)).toBe(false);
  });

  it('accepts the edges, so a spot on the boundary is not lost', () => {
    expect(withinBounds(at(50.3, 6.88), RING)).toBe(true);
    expect(withinBounds(at(50.41, 7.04), RING)).toBe(true);
  });

  it('rejects a position just outside an edge', () => {
    expect(withinBounds(at(50.2999, 6.9), RING)).toBe(false);
    expect(withinBounds(at(50.35, 7.0401), RING)).toBe(false);
  });

  it('rejects non-finite coordinates rather than treating them as inside', () => {
    // A GPS fix can arrive as NaN; that must never enable "add here".
    expect(withinBounds(at(Number.NaN, 6.96), RING)).toBe(false);
    expect(withinBounds(at(50.35, Number.POSITIVE_INFINITY), RING)).toBe(false);
  });
});
