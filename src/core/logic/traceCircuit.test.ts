import { describe, expect, it } from 'vitest';

import { buildWalkNetwork, type WalkWay } from './route';
import { drivableWays, traceCircuit, traceIsUsable } from './traceCircuit';

/**
 * A square of streets, roughly 400m a side at this latitude, plus a footpath
 * cutting the middle. The footpath is the trap: it is a shorter way across
 * and no car will ever use it.
 */
const A = 0.004;
const STREETS: WalkWay[] = [
  { highway: 'residential', coordinates: [[0, 0], [A, 0]] },
  { highway: 'residential', coordinates: [[A, 0], [A, A]] },
  { highway: 'residential', coordinates: [[A, A], [0, A]] },
  { highway: 'residential', coordinates: [[0, A], [0, 0]] },
  { highway: 'footway', coordinates: [[0, 0], [A, A]] },
];

const net = () => buildWalkNetwork(drivableWays(STREETS));
const at = (lon: number, lat: number) => ({ longitude: lon, latitude: lat });

describe('drivableWays', () => {
  it('keeps roads and drops footpaths', () => {
    // Footways are excellent for reaching a spot and are not a racing
    // surface; leaving them in lets a lap cut through a pedestrian alley.
    const kept = drivableWays(STREETS);
    expect(kept).toHaveLength(4);
    expect(kept.every((w) => w.highway === 'residential')).toBe(true);
  });

  it('drops ways with no highway tag at all', () => {
    expect(drivableWays([{ coordinates: [[0, 0], [1, 1]] }])).toHaveLength(0);
  });
});

describe('traceCircuit', () => {
  it('refuses a single point', () => {
    // One point is not a line, and inventing a lap from it is fabrication.
    expect(traceCircuit([at(0, 0)], net())).toBeNull();
  });

  it('snaps a rough line onto the streets', () => {
    // Drawn well off the road, as a finger would be.
    const trace = traceCircuit([at(0.0005, -0.0004), at(A - 0.0005, 0.0004)], net());
    expect(trace).not.toBeNull();
    expect(trace!.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it('closes the lap when the ends nearly meet', () => {
    const trace = traceCircuit(
      [at(0, 0), at(A, 0), at(A, A), at(0, A), at(0.0002, 0.0002)],
      net(),
    );
    expect(trace!.closed).toBe(true);
  });

  it('leaves an open line open', () => {
    const trace = traceCircuit([at(0, 0), at(A, 0)], net());
    expect(trace!.closed).toBe(false);
  });

  it('routes the closing stretch along roads rather than straight back', () => {
    // The one segment that must not ignore the point of the feature.
    const open = traceCircuit([at(0, 0), at(A, 0), at(A, A), at(0, A)], net())!;
    const closedTrace = traceCircuit(
      [at(0, 0), at(A, 0), at(A, A), at(0, A), at(0.0001, 0.0001)],
      net(),
    )!;
    expect(closedTrace.metres).toBeGreaterThan(open.metres);
  });

  it('never repeats a point where two legs meet', () => {
    const trace = traceCircuit([at(0, 0), at(A, 0), at(A, A)], net())!;
    for (let i = 1; i < trace.coordinates.length; i++) {
      const a = trace.coordinates[i - 1]!;
      const b = trace.coordinates[i]!;
      expect(a.latitude === b.latitude && a.longitude === b.longitude).toBe(false);
    }
  });

  it('reports distance covered off the roads', () => {
    // The honesty signal: a caller showing a guess as a survey is the failure
    // this exists to prevent.
    const trace = traceCircuit([at(0, 0), at(A, 0)], net())!;
    expect(trace.offRoadMetres).toBeGreaterThanOrEqual(0);
    expect(trace.metres).toBeGreaterThan(0);
  });

  it('returns something even with no roads at all', () => {
    // A straight hop, honestly labelled as entirely off-road, beats null —
    // the caller can then say why rather than showing nothing.
    const empty = buildWalkNetwork([]);
    const trace = traceCircuit([at(0, 0), at(A, A)], empty)!;
    expect(trace.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(trace.offRoadMetres).toBeCloseTo(trace.metres, 0);
  });
});

describe('traceIsUsable', () => {
  it('accepts a trace that mostly follows roads', () => {
    expect(traceIsUsable({ coordinates: [], metres: 6000, offRoadMetres: 300, closed: true })).toBe(
      true,
    );
  });

  it('rejects one that is mostly guesswork', () => {
    expect(
      traceIsUsable({ coordinates: [], metres: 1000, offRoadMetres: 900, closed: true }),
    ).toBe(false);
  });

  it('judges by fraction, not distance', () => {
    // 200m off-road is nothing in a 6km lap and most of a short one.
    const long = { coordinates: [], metres: 6000, offRoadMetres: 200, closed: true };
    const short = { coordinates: [], metres: 400, offRoadMetres: 200, closed: true };
    expect(traceIsUsable(long)).toBe(true);
    expect(traceIsUsable(short)).toBe(false);
  });

  it('rejects a zero-length trace rather than dividing by zero', () => {
    expect(traceIsUsable({ coordinates: [], metres: 0, offRoadMetres: 0, closed: false })).toBe(
      false,
    );
  });
});
