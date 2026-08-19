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

  it('ignores a network it would barely touch', () => {
    // Routing picks the island that serves both ends best, so it always finds
    // one. When the destination is far off any of them, the path leg is noise
    // bolted onto a long cross-country walk — a bearing is the honest answer.
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

/**
 * The racing surface, as a barrier.
 *
 * A straight north–south line at lon 6.9515, which the east–west PATH crosses.
 * Standing either side of it, the only lawful way over is a mapped crossing.
 */
const TRACK: [number, number][] = [
  [6.9515, 50.3400],
  [6.9515, 50.3600],
];

describe('routeBetween with barriers', () => {
  it('ignores barriers when none are given', () => {
    const r = routeBetween(EMPTY_NETWORK, at(6.9500, 50.35), at(6.9530, 50.35));
    expect(r.legs[0]!.kind).toBe('direct');
    expect(r.blocked).toBe(false);
  });

  it('flags a straight line that crosses the track', () => {
    // Nothing to route over, so it still returns the bearing — but says so.
    const r = routeBetween(
      EMPTY_NETWORK,
      at(6.9500, 50.35),
      at(6.9530, 50.35),
      [TRACK],
    );
    expect(r.legs[0]!.kind).toBe('direct');
    expect(r.blocked).toBe(true);
  });

  it('does not flag a route that stays on one side', () => {
    const r = routeBetween(
      EMPTY_NETWORK,
      at(6.9500, 50.35),
      at(6.9510, 50.351),
      [TRACK],
    );
    expect(r.blocked).toBe(false);
  });

  it('takes a long way round rather than crossing the track', () => {
    /*
     * The case from the field: an underpass far to the south. Following it is
     * many times the straight-line distance, so MAX_DETOUR_RATIO would normally
     * reject it and draw a line straight over the circuit. With the track as a
     * barrier the detour is the only option, and must win.
     */
    const underpass: [number, number][] = [
      [6.9500, 50.3500],
      [6.9500, 50.3300],
      [6.9530, 50.3300],
      [6.9530, 50.3500],
    ];
    const n = buildWalkNetwork([underpass]);

    const withoutBarrier = routeBetween(n, at(6.95, 50.35), at(6.953, 50.35));
    expect(withoutBarrier.legs).toHaveLength(1);
    expect(withoutBarrier.legs[0]!.kind).toBe('direct');

    const withBarrier = routeBetween(
      n,
      at(6.95, 50.35),
      at(6.953, 50.35),
      [TRACK],
    );
    expect(withBarrier.legs.some((l) => l.kind === 'network')).toBe(true);
    expect(withBarrier.blocked).toBe(false);
    expect(withBarrier.metres).toBeGreaterThan(withoutBarrier.metres * 2.2);
  });

  it('reports blocked when even the network route has to cross', () => {
    // A network on the far side only: joining it still means crossing.
    const farSide: [number, number][] = [
      [6.9530, 50.3500],
      [6.9540, 50.3500],
    ];
    const n = buildWalkNetwork([farSide]);
    const r = routeBetween(n, at(6.9500, 50.35), at(6.9535, 50.35), [TRACK]);
    expect(r.blocked).toBe(true);
  });

  it('allows a network leg to cross — that is what a tunnel is', () => {
    // The crossing way itself passes over the barrier. Network legs are real
    // mapped ways, so this is legitimate and must not be flagged.
    const n = buildWalkNetwork([PATH]);
    const r = routeBetween(n, at(6.9500, 50.35), at(6.9530, 50.35), [TRACK]);
    expect(r.legs.every((l) => l.kind === 'network')).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('does not treat touching the barrier as crossing it', () => {
    // A spot on the verge sits right at the track edge; that is where spots go.
    const r = routeBetween(
      EMPTY_NETWORK,
      at(6.9500, 50.35),
      at(6.9515, 50.35),
      [TRACK],
    );
    expect(r.blocked).toBe(false);
  });
});

describe('an uncertain fix near the track', () => {
  /**
   * A path on each side, joined by a tunnel under the barrier.
   *
   * The barrier runs north–south at lon 6.9515; the tunnel is the only mapped
   * way across.
   */
  const westPath: [number, number][] = [
    [6.9490, 50.3500],
    [6.9510, 50.3500],
  ];
  const tunnel: [number, number][] = [
    [6.9510, 50.3500],
    [6.9520, 50.3500],
  ];
  const eastPath: [number, number][] = [
    [6.9520, 50.3500],
    [6.9540, 50.3500],
  ];
  const net = buildWalkNetwork([westPath, tunnel, eastPath]);

  it('still routes when the fix has landed on the racing surface', () => {
    /*
     * The real failure: GPS is good to 5-25 m and a circuit is about 12 m wide,
     * so a position taken on the verge is reported *on the track*. Judging the
     * side strictly then makes every route unreachable and the app refuses to
     * navigate — a refusal caused by measurement error, not by the ground.
     */
    const onTrack = at(6.9515, 50.35);
    const destination = at(6.9535, 50.35);

    const r = routeBetween(net, onTrack, destination, [TRACK], 15);
    expect(r.legs.some((l) => l.kind === 'network')).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('still trusts a confident fix well clear of the track', () => {
    // 200 m west: no ambiguity, so the side is asserted and honoured.
    const clear = at(6.9490, 50.35);
    const r = routeBetween(net, clear, at(6.9540, 50.35), [TRACK], 5);
    expect(r.legs.some((l) => l.kind === 'network')).toBe(true);
  });

  it('widens the doubt when the fix says it is poor', () => {
    // Same position, but the phone admits to 60 m of error: the side cannot be
    // asserted, so the join is allowed on either side rather than refused.
    const nearish = at(6.95125, 50.35);
    const poor = routeBetween(net, nearish, at(6.9535, 50.35), [TRACK], 60);
    expect(poor.blocked).toBe(false);
  });
});

describe('preferring paths over roads', () => {
  /**
   * Two ways between the same points: a straight fast road, and a footpath that
   * bows north and is genuinely longer on the ground.
   *
   * This is the Nordschleife's infield in miniature — public Eifel roads thread
   * right through it, and the shortest line between two spots is often along
   * one.
   */
  const road: [number, number][] = [
    [6.9500, 50.3500],
    [6.9560, 50.3500],
  ];
  const footpath: [number, number][] = [
    [6.9500, 50.3500],
    [6.9520, 50.3512],
    [6.9540, 50.3512],
    [6.9560, 50.3500],
  ];

  it('takes the longer footpath over a fast road', () => {
    const n = buildWalkNetwork([
      { coordinates: road, highway: 'secondary' },
      { coordinates: footpath, highway: 'footway' },
    ]);
    const r = routeBetween(n, at(6.95, 50.35), at(6.956, 50.35));

    const leg = r.legs.find((l) => l.kind === 'network');
    expect(leg).toBeDefined();
    // Bowing north means passing through the footpath's middle points.
    expect(leg!.coordinates.some((c) => c.latitude > 50.3505)).toBe(true);
  });

  it('reports the real distance walked, not the weighted cost', () => {
    // Weighting is how the search chooses; telling someone a 400 m road walk is
    // 1.3 km would be a lie in the units that matter.
    const n = buildWalkNetwork([{ coordinates: road, highway: 'secondary' }]);
    const r = routeBetween(n, at(6.95, 50.35), at(6.956, 50.35));
    // ~430 m at this latitude; nowhere near the 3.2x weighted figure.
    expect(r.metres).toBeLessThan(600);
    expect(r.metres).toBeGreaterThan(300);
  });

  it('still uses a road when it is the only way', () => {
    // A preference, not a prohibition.
    const n = buildWalkNetwork([{ coordinates: road, highway: 'secondary' }]);
    const r = routeBetween(n, at(6.95, 50.35), at(6.956, 50.35));
    expect(r.legs.some((l) => l.kind === 'network')).toBe(true);
  });

  it('treats untyped ways as neutral, so plain geometry still routes', () => {
    const n = buildWalkNetwork([road]);
    const r = routeBetween(n, at(6.95, 50.35), at(6.956, 50.35));
    expect(r.legs.some((l) => l.kind === 'network')).toBe(true);
  });
});
