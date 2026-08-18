import { describe, expect, it } from 'vitest';

import {
  EMPTY_NETWORK,
  buildWalkNetwork,
  nearestNode,
  routeBetween,
  routeThrough,
} from './route';

/**
 * A short east–west path at roughly Nürburgring latitude.
 *
 * Coordinates are [lon, lat] — GeoJSON order — because that is what the map
 * data hands over. A test that used [lat, lon] would pass while the app routed
 * into the Indian Ocean.
 */
const PATH: [number, number][] = [
  [6.9500, 50.3500],
  [6.9510, 50.3500],
  [6.9520, 50.3500],
  [6.9530, 50.3500],
];

const at = (lon: number, lat: number) => ({ latitude: lat, longitude: lon });

describe('buildWalkNetwork', () => {
  it('links consecutive points in both directions', () => {
    const n = buildWalkNetwork([PATH]);
    expect(n.isEmpty).toBe(false);
    expect(n.nodes.size).toBe(4);
    // Interior nodes have two neighbours, ends have one.
    const degrees = [...n.edges.values()].map((e) => e.length).sort();
    expect(degrees).toEqual([1, 1, 2, 2]);
  });

  it('joins ways that share a coordinate', () => {
    // Two ways meeting at a junction must produce one connected graph, or every
    // route across the junction degrades to a straight line.
    const branch: [number, number][] = [
      [6.9520, 50.3500],
      [6.9520, 50.3510],
    ];
    const n = buildWalkNetwork([PATH, branch]);
    expect(n.nodes.size).toBe(5);
    const route = routeBetween(n, at(6.95, 50.35), at(6.952, 50.351));
    expect(route.legs.some((l) => l.kind === 'network')).toBe(true);
  });

  it('skips non-finite coordinates instead of poisoning the graph', () => {
    const n = buildWalkNetwork([
      [
        [6.95, 50.35],
        [Number.NaN, 50.35],
        [6.952, 50.35],
      ],
    ]);
    for (const edges of n.edges.values()) {
      for (const e of edges) expect(Number.isFinite(e.metres)).toBe(true);
    }
  });

  it('is empty for empty input', () => {
    expect(buildWalkNetwork([]).isEmpty).toBe(true);
  });
});

describe('nearestNode', () => {
  it('finds the closest point on the network', () => {
    const n = buildWalkNetwork([PATH]);
    const near = nearestNode(n, at(6.95205, 50.3501));
    expect(near).not.toBeNull();
    expect(near!.position.longitude).toBeCloseTo(6.952, 4);
  });

  it('returns null for an empty network', () => {
    expect(nearestNode(EMPTY_NETWORK, at(6.95, 50.35))).toBeNull();
  });
});

describe('routeBetween', () => {
  it('falls back to a single direct leg with no network', () => {
    // The honest answer when we know nothing: a bearing, marked as a guess.
    const r = routeBetween(EMPTY_NETWORK, at(6.95, 50.35), at(6.953, 50.35));
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('direct');
    expect(r.offNetworkMetres).toBe(r.metres);
  });

  it('follows the network between two points on it', () => {
    const n = buildWalkNetwork([PATH]);
    const r = routeBetween(n, at(6.9500, 50.3500), at(6.9530, 50.3500));
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('network');
    expect(r.offNetworkMetres).toBe(0);
    expect(r.metres).toBeGreaterThan(0);
  });

  it('brackets a network leg with direct legs when both ends are off it', () => {
    // The real shape of a circuit walk: cross the grass, follow the path,
    // cross the grass again.
    const n = buildWalkNetwork([PATH]);
    const r = routeBetween(n, at(6.9500, 50.3506), at(6.9530, 50.3506));
    expect(r.legs.map((l) => l.kind)).toEqual(['direct', 'network', 'direct']);
    expect(r.offNetworkMetres).toBeGreaterThan(0);
    expect(r.offNetworkMetres).toBeLessThan(r.metres);
  });

  it('does not emit a join leg when already standing on the path', () => {
    const n = buildWalkNetwork([PATH]);
    const r = routeBetween(n, at(6.95001, 50.35), at(6.953, 50.35));
    expect(r.legs.every((l) => l.kind === 'network')).toBe(true);
  });

  it('walks straight rather than taking an absurd detour', () => {
    // A path that loops far away is not a route to somewhere ten metres off.
    const detour: [number, number][] = [
      [6.9500, 50.3500],
      [6.9500, 50.3600],
      [6.9600, 50.3600],
      [6.9600, 50.3500],
    ];
    const n = buildWalkNetwork([detour]);
    const r = routeBetween(n, at(6.95, 50.34990), at(6.95005, 50.34990));
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('direct');
  });

  it('degrades to direct when the two ends are on unconnected networks', () => {
    const island: [number, number][] = [
      [7.0500, 50.4500],
      [7.0510, 50.4500],
    ];
    const n = buildWalkNetwork([PATH, island]);
    const r = routeBetween(n, at(6.95, 50.35), at(7.051, 50.45));
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('direct');
  });

  it('handles a start and end that are the same point', () => {
    const n = buildWalkNetwork([PATH]);
    const r = routeBetween(n, at(6.95, 50.35), at(6.95, 50.35));
    expect(r.metres).toBe(0);
  });
});

describe('routeThrough', () => {
  it('concatenates the legs of each hop', () => {
    const n = buildWalkNetwork([PATH]);
    const r = routeThrough(n, [
      at(6.9500, 50.3500),
      at(6.9520, 50.3500),
      at(6.9530, 50.3500),
    ]);
    expect(r.legs.length).toBeGreaterThanOrEqual(2);
    expect(r.metres).toBeGreaterThan(0);
  });

  it('is empty for fewer than two points', () => {
    const n = buildWalkNetwork([PATH]);
    expect(routeThrough(n, []).metres).toBe(0);
    expect(routeThrough(n, [at(6.95, 50.35)]).legs).toHaveLength(0);
  });
});
