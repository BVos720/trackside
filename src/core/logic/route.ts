/**
 * Walking routes across a circuit.
 *
 * Circuits are not street networks. Between the car park and a photo position
 * there is usually *some* path — a service road, a spectator walkway, a
 * gravel track — and then a last stretch across grass or through a gap in a
 * bank that no map has ever recorded. A router that only knows roads sends you
 * the long way round; one that only draws straight lines sends you through a
 * fence.
 *
 * So a route here is a sequence of legs of two kinds:
 *
 *   `network` — following extracted ways, which are real and walkable
 *   `direct`  — a straight line, which is a *hint*, not a path
 *
 * The direct legs are the honest part. They say "get from here to there however
 * the ground allows", and the UI draws them dashed so they never read as an
 * instruction. Presenting a straight line across a field in the same style as a
 * footpath would be the app claiming knowledge it does not have — the same
 * failure as inferring access permission, which §0.2 forbids outright.
 *
 * ── Why not a routing engine ──────────────────────────────────────────────
 * Valhalla or GraphHopper would route better, on networks with millions of
 * edges and turn restrictions and one-way streets. A circuit's walkable network
 * is a few thousand segments, undirected, with no turn costs, and it has to
 * work with no signal in the middle of the Eifel. Dijkstra over an in-memory
 * graph runs in under a millisecond at that size and ships as part of the
 * bundle.
 */
import type { LatLon } from '../domain/common';
import { haversineMetres } from './geo';

export type { LatLon };

export type LegKind = 'network' | 'direct';

export interface RouteLeg {
  readonly kind: LegKind;
  readonly coordinates: readonly LatLon[];
  readonly metres: number;
}

export interface Route {
  readonly legs: readonly RouteLeg[];
  readonly metres: number;
  /** Metres covered off the network — the part we are guessing at. */
  readonly offNetworkMetres: number;
  /**
   * True when the only route found still crosses a barrier.
   *
   * The barrier that matters is the racing surface. A route flagged here is not
   * a suggestion the UI may present quietly — it means "there is no way to get
   * there that does not involve crossing the track", which is a thing to say
   * out loud, not to draw as a dashed line and hope.
   */
  readonly blocked: boolean;
}

/**
 * Node key precision.
 *
 * 6 decimal places is ~0.11 m at the equator. Ways that share a junction in OSM
 * share the exact node, so they round to the same key and the graph connects.
 * Coarser rounding would weld genuinely separate paths together — a footbridge
 * to the road beneath it — and produce routes that walk through the air.
 */
const KEY_PRECISION = 6;

const keyOf = (lat: number, lon: number): string =>
  `${lat.toFixed(KEY_PRECISION)},${lon.toFixed(KEY_PRECISION)}`;

interface Edge {
  readonly to: string;
  /** Real ground distance. What gets reported to the user. */
  readonly metres: number;
  /** What the search minimises. Metres, weighted by how bad the way is. */
  readonly cost: number;
}

/**
 * How much worse a metre is on each kind of way.
 *
 * The Nordschleife's infield is threaded with public Eifel roads, and the
 * shortest route between two spots is often along one. Walking a fast road with
 * no pavement is unpleasant at best and dangerous at worst, and it is not what
 * anyone would actually do when a footpath runs parallel a hundred metres away.
 *
 * These are multipliers on distance, not prohibitions: a road that is the only
 * way through still gets used, it just has to be genuinely shorter to win. That
 * is the difference between "prefer paths" and "never use roads", and only the
 * first survives contact with a real venue.
 *
 * The numbers are judgement, not measurement — which is why they are one table
 * with a comment rather than scattered through the search.
 */
const WAY_COST: Record<string, number> = {
  // Made for walking.
  footway: 1,
  path: 1,
  pedestrian: 1,
  steps: 1.2, // fine on foot, slow with a bag of gear
  track: 1.1,

  // Shared with vehicles, but slow ones.
  service: 1.4,
  living_street: 1.4,
  residential: 1.6,
  unclassified: 1.8,

  // Real roads. Used when there is nothing else.
  tertiary: 2.4,
  tertiary_link: 2.4,
  secondary: 3.2,
  secondary_link: 3.2,
};

/** Unknown ways are treated as ordinary roads rather than as footpaths. */
const DEFAULT_WAY_COST = 1.8;

/** A way with its classification, as the extractor stores it. */
export interface WalkWay {
  readonly coordinates: readonly (readonly [number, number])[];
  /** OSM `highway` value. Missing falls back to DEFAULT_WAY_COST. */
  readonly highway?: string;
}

export interface WalkNetwork {
  readonly nodes: ReadonlyMap<string, LatLon>;
  readonly edges: ReadonlyMap<string, readonly Edge[]>;
  /**
   * Which connected island each node belongs to.
   *
   * A real path network is never one piece: a car park aisle behind a fence, a
   * track on the far side of the circuit, a footpath reached only through a
   * tunnel nobody mapped. Routing has to know, because snapping the two ends of
   * a journey onto *different* islands finds no path and silently falls back to
   * a straight line — with the whole network sitting right there unused.
   */
  readonly componentOf: ReadonlyMap<string, number>;
  readonly isEmpty: boolean;
}

/** A network with nothing in it — every route degrades to a direct line. */
export const EMPTY_NETWORK: WalkNetwork = {
  nodes: new Map(),
  edges: new Map(),
  componentOf: new Map(),
  isEmpty: true,
};

/**
 * Build an undirected graph from way geometry.
 *
 * Input is `[lon, lat]` pairs per way, matching GeoJSON order — the same shape
 * `trackLinesFor` returns, so extracted data feeds straight in without a
 * transform step that could silently swap the axes.
 */
export function buildWalkNetwork(
  /**
   * Either bare coordinate lists or ways carrying their `highway` class.
   *
   * Both are accepted so callers that do not care about surface — and the
   * geometry tests — stay simple; untyped ways all cost the same.
   */
  ways: readonly (
    | readonly (readonly [number, number])[]
    | WalkWay
  )[],
): WalkNetwork {
  const nodes = new Map<string, LatLon>();
  const edges = new Map<string, Edge[]>();

  const adjacency = (key: string): Edge[] => {
    const existing = edges.get(key);
    if (existing) return existing;
    const created: Edge[] = [];
    edges.set(key, created);
    return created;
  };

  // Undirected: a path is walkable both ways.
  const link = (a: string, b: string, metres: number, weight: number) => {
    if (a === b) return;
    const cost = metres * weight;
    adjacency(a).push({ to: b, metres, cost });
    adjacency(b).push({ to: a, metres, cost });
  };

  for (const entry of ways) {
    const typed = Array.isArray(entry) ? null : (entry as WalkWay);
    const way = typed ? typed.coordinates : (entry as readonly (readonly [number, number])[]);
    const weight = typed
      ? (WAY_COST[typed.highway ?? ''] ?? DEFAULT_WAY_COST)
      : 1;

    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i]!;
      const b = way[i + 1]!;
      const [alon, alat] = a;
      const [blon, blat] = b;
      if (!Number.isFinite(alat) || !Number.isFinite(alon)) continue;
      if (!Number.isFinite(blat) || !Number.isFinite(blon)) continue;

      const ka = keyOf(alat, alon);
      const kb = keyOf(blat, blon);
      if (!nodes.has(ka)) nodes.set(ka, { latitude: alat, longitude: alon });
      if (!nodes.has(kb)) nodes.set(kb, { latitude: blat, longitude: blon });

      link(ka, kb, haversineMetres(nodes.get(ka)!, nodes.get(kb)!), weight);
    }
  }

  // Label the islands once, here, rather than on every route.
  const componentOf = new Map<string, number>();
  let component = 0;
  for (const start of nodes.keys()) {
    if (componentOf.has(start)) continue;
    const stack = [start];
    componentOf.set(start, component);
    while (stack.length > 0) {
      const key = stack.pop()!;
      for (const edge of edges.get(key) ?? []) {
        if (componentOf.has(edge.to)) continue;
        componentOf.set(edge.to, component);
        stack.push(edge.to);
      }
    }
    component++;
  }

  return { nodes, edges, componentOf, isEmpty: nodes.size === 0 };
}

/**
 * The best island to route through, and where to join and leave it.
 *
 * One pass over the nodes, tracking the closest node to each endpoint per
 * island, then the island with the least total walking off-network. Picking the
 * globally nearest node for each end independently is what breaks: at Spa the
 * nearest node to one spot was a twelve-metre car park stub, unreachable from
 * anywhere, so a perfectly good route down the service road was never found.
 */
function bestJoin(
  network: WalkNetwork,
  from: LatLon,
  to: LatLon,
  barriers: readonly (readonly (readonly [number, number])[])[] = [],
  /** Reported accuracy of `from`, metres. Widens the "side unknown" band. */
  fromAccuracyMetres = 0,
): {
  start: { key: string; position: LatLon; metres: number };
  end: { key: string; position: LatLon; metres: number };
} | null {
  interface Best {
    fromKey: string;
    fromPos: LatLon;
    fromM: number;
    toKey: string;
    toPos: LatLon;
    toM: number;
  }
  const perComponent = new Map<number, Best>();

  /*
   * With barriers, each end may only join the network on its own side of the
   * track. Walking to the path is a direct leg, and a direct leg across a live
   * circuit is not something to suggest — whereas the network path between the
   * two joins may cross freely, because a mapped way across is a tunnel or a
   * bridge.
   */
  const sides = barriers.length > 0 ? nodeSides(network, barriers) : null;

  /*
   * When the fix is close enough to the track that its side is a coin toss,
   * neither side is asserted and both are allowed to join. Otherwise a position
   * that GPS put on the racing surface makes every route unreachable — which is
   * a refusal caused by measurement error, not by the ground.
   */
  const tolerance = Math.max(SIDE_UNKNOWN_M, fromAccuracyMetres);
  const fromSideKnown =
    sides !== null && distanceToBarrier(from, barriers) > tolerance;

  const fromSide = fromSideKnown ? sideOf(from, barriers) : null;
  const toSide = sides ? sideOf(to, barriers) : null;

  for (const [key, position] of network.nodes) {
    const c = network.componentOf.get(key);
    if (c === undefined) continue;

    const side = sides?.get(key);
    // A null fromSide means "unknown", which admits both sides.
    const reachableFrom =
      sides === null || fromSide === null || side === fromSide;
    const reachableTo = sides === null || side === toSide;
    if (!reachableFrom && !reachableTo) continue;

    const dFrom = reachableFrom ? haversineMetres(from, position) : Infinity;
    const dTo = reachableTo ? haversineMetres(to, position) : Infinity;

    const current = perComponent.get(c);
    if (!current) {
      perComponent.set(c, {
        fromKey: key,
        fromPos: position,
        fromM: dFrom,
        toKey: key,
        toPos: position,
        toM: dTo,
      });
      continue;
    }
    if (dFrom < current.fromM) {
      current.fromKey = key;
      current.fromPos = position;
      current.fromM = dFrom;
    }
    if (dTo < current.toM) {
      current.toKey = key;
      current.toPos = position;
      current.toM = dTo;
    }
  }

  let best: Best | null = null;
  let bestCost = Infinity;
  for (const candidate of perComponent.values()) {
    // A component reachable from only one end cannot carry the journey.
    if (!Number.isFinite(candidate.fromM) || !Number.isFinite(candidate.toM)) {
      continue;
    }
    const cost = candidate.fromM + candidate.toM;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  if (!best) return null;

  return {
    start: { key: best.fromKey, position: best.fromPos, metres: best.fromM },
    end: { key: best.toKey, position: best.toPos, metres: best.toM },
  };
}

/** Nearest graph node to a point, with its distance. */
export function nearestNode(
  network: WalkNetwork,
  point: LatLon,
): { key: string; position: LatLon; metres: number } | null {
  let best: { key: string; position: LatLon; metres: number } | null = null;
  for (const [key, position] of network.nodes) {
    const metres = haversineMetres(point, position);
    if (!best || metres < best.metres) best = { key, position, metres };
  }
  return best;
}

/**
 * A minimal binary min-heap over (key, distance) pairs.
 *
 * Dijkstra with a linear scan for the nearest unsettled node is O(V²). That is
 * fine for a toy graph and hopeless here: the Nürburgring's walkable network is
 * tens of thousands of nodes, where O(V²) is billions of comparisons and the
 * navigator visibly stalls. With a heap it is O(E log V) and runs in
 * milliseconds.
 *
 * Stale entries are left in the heap and skipped on pop rather than being
 * decreased in place — the bookkeeping for decrease-key costs more than the
 * duplicate entries do.
 */
class MinHeap {
  private readonly keys: string[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: string, cost: number): void {
    this.keys.push(key);
    this.costs.push(cost);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent]! <= this.costs[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: string; cost: number } | null {
    if (this.keys.length === 0) return null;
    const key = this.keys[0]!;
    const cost = this.costs[0]!;

    const lastKey = this.keys.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.costs.length && this.costs[left]! < this.costs[smallest]!) {
          smallest = left;
        }
        if (right < this.costs.length && this.costs[right]! < this.costs[smallest]!) {
          smallest = right;
        }
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }

    return { key, cost };
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const c = this.costs[a]!;
    this.costs[a] = this.costs[b]!;
    this.costs[b] = c;
  }
}

/** Dijkstra between two node keys. */
function shortestPath(
  network: WalkNetwork,
  fromKey: string,
  toKey: string,
): { keys: string[]; metres: number } | null {
  if (fromKey === toKey) return { keys: [fromKey], metres: 0 };

  /*
   * Two numbers per node: the weighted cost the search minimises, and the real
   * distance walked. Reporting cost as a distance would tell someone a 400 m
   * road walk is 1.3 km, which is a lie in the units that matter.
   */
  const dist = new Map<string, number>([[fromKey, 0]]);
  const walked = new Map<string, number>([[fromKey, 0]]);
  const prev = new Map<string, string>();
  const settled = new Set<string>();

  const queue = new MinHeap();
  queue.push(fromKey, 0);

  for (;;) {
    const top = queue.pop();
    if (top === null) return null;
    // A stale entry: this node already came off the heap at a lower cost.
    if (settled.has(top.key)) continue;
    if (top.key === toKey) break;

    settled.add(top.key);
    for (const edge of network.edges.get(top.key) ?? []) {
      if (settled.has(edge.to)) continue;
      const next = top.cost + edge.cost;
      const known = dist.get(edge.to);
      if (known === undefined || next < known) {
        dist.set(edge.to, next);
        walked.set(edge.to, (walked.get(top.key) ?? 0) + edge.metres);
        prev.set(edge.to, top.key);
        queue.push(edge.to, next);
      }
    }
  }

  const keys: string[] = [toKey];
  let cursor = toKey;
  while (cursor !== fromKey) {
    const p = prev.get(cursor);
    if (p === undefined) return null;
    keys.unshift(p);
    cursor = p;
  }
  return { keys, metres: walked.get(toKey) ?? 0 };
}

/**
 * Which way does the turn p → q → r go?
 *
 * Positive is counter-clockwise, negative clockwise, zero collinear. Computed
 * on raw lon/lat: over a few kilometres the projection error is far below the
 * scale of anything being tested, and a proper projection would add a
 * dependency to decide whether two lines cross.
 */
function orientation(p: LatLon, q: LatLon, r: LatLon): number {
  return (
    (q.longitude - p.longitude) * (r.latitude - p.latitude) -
    (q.latitude - p.latitude) * (r.longitude - p.longitude)
  );
}

/** Do the two segments properly cross? Touching at an endpoint does not count. */
function segmentsCross(
  a1: LatLon,
  a2: LatLon,
  b1: LatLon,
  b2: LatLon,
): boolean {
  const d1 = orientation(b1, b2, a1);
  const d2 = orientation(b1, b2, a2);
  const d3 = orientation(a1, a2, b1);
  const d4 = orientation(a1, a2, b2);

  // Strict signs only. A route that merely touches the track — a path ending at
  // the barrier, which is what a spot on the verge looks like — is legitimate;
  // it is passing through that is not.
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Does this straight line cross any barrier?
 *
 * Barriers arrive as `[lon, lat]` polylines — the same shape `trackLinesFor`
 * returns, so the circuit centreline feeds straight in.
 */
export function crossesBarrier(
  from: LatLon,
  to: LatLon,
  barriers: readonly (readonly (readonly [number, number])[])[],
): boolean {
  for (const line of barriers) {
    for (let i = 0; i < line.length - 1; i++) {
      const b1 = { longitude: line[i]![0], latitude: line[i]![1] };
      const b2 = { longitude: line[i + 1]![0], latitude: line[i + 1]![1] };
      if (segmentsCross(from, to, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Which side of the circuit a point is on.
 *
 * ── Why a side, and not just "does this leg cross" ────────────────────────
 * Refusing legs that cross the track is not enough on its own. The router picks
 * which island to walk by distance, and the nearest node to where you are
 * standing is frequently *across the circuit* — so the join leg crossed, the
 * whole route was rejected, and it fell back to a straight line over the track.
 * That is exactly the failure this was meant to prevent.
 *
 * Knowing the side lets the join be constrained to nodes you can actually reach
 * on foot, which is what lets a tunnel route be found at all: the network path
 * may cross as much as it likes, because a mapped way across *is* the tunnel.
 *
 * ── The method ────────────────────────────────────────────────────────────
 * A ray cast due east, counting how many track segments it crosses. Odd means
 * enclosed by the lap, even means outside. It needs no polygon: a circuit's
 * centreline is a closed loop however many LineStrings OSM split it into, and
 * counting crossings works on the segments directly.
 */
/** Metres from a point to the nearest point on a line segment. */
function distanceToSegment(p: LatLon, a: LatLon, b: LatLon): number {
  // Local metric frame: a degree of longitude shrinks with latitude, so the
  // two axes cannot be treated alike.
  const kx = Math.cos((p.latitude * Math.PI) / 180) * 111320;
  const ky = 110540;

  const ax = (a.longitude - p.longitude) * kx;
  const ay = (a.latitude - p.latitude) * ky;
  const bx = (b.longitude - p.longitude) * kx;
  const by = (b.latitude - p.latitude) * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax, ay);

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Metres from a point to the nearest barrier. */
export function distanceToBarrier(
  point: LatLon,
  barriers: readonly (readonly (readonly [number, number])[])[],
): number {
  let best = Infinity;
  for (const line of barriers) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = { longitude: line[i]![0], latitude: line[i]![1] };
      const b = { longitude: line[i + 1]![0], latitude: line[i + 1]![1] };
      const d = distanceToSegment(point, a, b);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * How close to the track a position has to be before its side is unknowable.
 *
 * A circuit is about twelve metres across and a phone's fix is good to five or
 * twenty-five. Standing on the verge, the reported position lands on the
 * racing surface — or on the far side of it — often enough to matter, and the
 * router then refuses every route because it believes you are somewhere you
 * cannot walk from.
 *
 * Inside this distance the app does not know which side you are on, so it stops
 * pretending to. Callers pass their own accuracy and the larger of the two
 * wins: a good fix trusts itself, a poor one admits it cannot tell.
 */
const SIDE_UNKNOWN_M = 20;

function sideOf(
  point: LatLon,
  barriers: readonly (readonly (readonly [number, number])[])[],
): boolean {
  // Far enough east to be outside any venue's extract.
  const far: LatLon = { latitude: point.latitude, longitude: point.longitude + 5 };

  let crossings = 0;
  for (const line of barriers) {
    for (let i = 0; i < line.length - 1; i++) {
      const b1 = { longitude: line[i]![0], latitude: line[i]![1] };
      const b2 = { longitude: line[i + 1]![0], latitude: line[i + 1]![1] };
      if (segmentsCross(point, far, b1, b2)) crossings++;
    }
  }
  return crossings % 2 === 1;
}

/**
 * Node → side, computed once per network and barrier set.
 *
 * The test is O(track segments) per node, which for the Nordschleife is 1,700
 * segments across 10,000 nodes. Fine once; ruinous on every GPS fix, which is
 * how often a route is recomputed while walking.
 */
const sideCache = new WeakMap<
  WalkNetwork,
  { barriers: unknown; sides: Map<string, boolean> }
>();

function nodeSides(
  network: WalkNetwork,
  barriers: readonly (readonly (readonly [number, number])[])[],
): Map<string, boolean> {
  const cached = sideCache.get(network);
  if (cached && cached.barriers === barriers) return cached.sides;

  const sides = new Map<string, boolean>();
  for (const [key, position] of network.nodes) {
    sides.set(key, sideOf(position, barriers));
  }
  sideCache.set(network, { barriers, sides });
  return sides;
}

/** Any *direct* leg of this route that crosses a barrier. Network legs are
 * real ways — a bridge or a tunnel is exactly how you legitimately cross. */
function routeCrossesBarrier(
  legs: readonly RouteLeg[],
  barriers: readonly (readonly (readonly [number, number])[])[],
): boolean {
  for (const leg of legs) {
    if (leg.kind !== 'direct') continue;
    for (let i = 0; i < leg.coordinates.length - 1; i++) {
      if (crossesBarrier(leg.coordinates[i]!, leg.coordinates[i + 1]!, barriers)) {
        return true;
      }
    }
  }
  return false;
}

function directLeg(from: LatLon, to: LatLon): RouteLeg {
  return {
    kind: 'direct',
    coordinates: [from, to],
    metres: haversineMetres(from, to),
  };
}

/**
 * How far off the network a point has to be before it is worth joining at all.
 *
 * Inside this radius the node is effectively where you are standing, and
 * emitting a two-metre "walk to the path" leg is noise. Outside it, the join is
 * a real part of the journey and gets drawn.
 */
const SNAP_TOLERANCE_M = 12;

/**
 * When the network detour is not worth it.
 *
 * If following paths is more than this multiple of the straight-line distance,
 * walking straight is the better instruction. Standing 40m from a spot with a
 * service road that loops 600m round to it, nobody takes the road.
 */
const MAX_DETOUR_RATIO = 2.2;

/**
 * When the network is not worth joining at all.
 *
 * Routing now picks the island that best serves both ends rather than the
 * nearest node to each, which is what makes real paths get used. The cost is
 * that it will always find *some* island — so a destination with no connected
 * route still comes back with a path leg bolted onto a long cross-country walk.
 *
 * If most of the journey is off-network anyway, that leg is noise: thirty
 * metres of service road at one end does not change how you cross the next
 * fourteen kilometres. Past this share, the honest answer is a bearing.
 */
const MAX_OFF_NETWORK_SHARE = 0.65;

/**
 * Route from one point to another across the walkable network.
 *
 * Always returns something: with no network, or no connected path, the result
 * is a single direct leg. That is the honest answer — "I do not know a path,
 * here is the bearing" — and it keeps every caller free of a null branch that
 * would otherwise be hit exactly when the user is furthest from help.
 */
export function routeBetween(
  network: WalkNetwork,
  from: LatLon,
  to: LatLon,
  /**
   * Lines the route may not cross on a direct leg — the racing surface.
   *
   * This is what makes underpasses get used. Walking round to a tunnel is
   * routinely five or ten times the straight-line distance, so the detour
   * limit below would throw it away and draw a line over the track instead.
   * With the track as a barrier the straight line stops being an option at all,
   * and the long way wins because it is the only way.
   */
  barriers: readonly (readonly (readonly [number, number])[])[] = [],
  /**
   * Reported accuracy of `from`, metres.
   *
   * Only meaningful for a live GPS fix; a tapped position is exact and leaves
   * this at zero. See SIDE_UNKNOWN_M.
   */
  fromAccuracyMetres = 0,
): Route {
  const straight = directLeg(from, to);
  const straightBlocked =
    barriers.length > 0 && crossesBarrier(from, to, barriers);

  const asDirect = (): Route => ({
    legs: [straight],
    metres: straight.metres,
    offNetworkMetres: straight.metres,
    blocked: straightBlocked,
  });

  if (network.isEmpty) return asDirect();

  // Both ends must land on the same island, or there is no path to find.
  const join = bestJoin(network, from, to, barriers, fromAccuracyMetres);
  if (!join) return asDirect();
  const { start: startNode, end: endNode } = join;

  const path = shortestPath(network, startNode.key, endNode.key);
  if (!path) return asDirect();

  const legs: RouteLeg[] = [];
  let offNetwork = 0;

  // Join the network, unless already effectively on it.
  if (startNode.metres > SNAP_TOLERANCE_M) {
    const leg = directLeg(from, startNode.position);
    legs.push(leg);
    offNetwork += leg.metres;
  }

  const coordinates = path.keys
    .map((k) => network.nodes.get(k))
    .filter((n): n is LatLon => n !== undefined);
  if (coordinates.length > 1) {
    legs.push({ kind: 'network', coordinates, metres: path.metres });
  }

  // Leave the network for the destination — the last stretch across grass.
  if (endNode.metres > SNAP_TOLERANCE_M) {
    const leg = directLeg(endNode.position, to);
    legs.push(leg);
    offNetwork += leg.metres;
  }

  const metres = legs.reduce((sum, l) => sum + l.metres, 0);

  if (legs.length === 0) return asDirect();

  const routeBlocked = routeCrossesBarrier(legs, barriers);
  const found: Route = {
    legs,
    metres,
    offNetworkMetres: offNetwork,
    blocked: routeBlocked,
  };

  /*
   * When walking straight would cross the track, the comfort limits do not
   * apply. A route that goes the long way round to an underpass is not "a
   * detour nobody would take" — it is the only lawful way across, and the
   * alternative is telling someone to walk onto a live circuit.
   *
   * The one exception is a route that crosses anyway: if even the network path
   * has to cut across, there is nothing to prefer it for.
   */
  if (straightBlocked) return routeBlocked ? asDirect() : found;

  // Unobstructed: the usual limits decide whether the network is worth it.
  if (straight.metres > 0 && metres > straight.metres * MAX_DETOUR_RATIO) {
    return asDirect();
  }
  if (metres > 0 && offNetwork / metres > MAX_OFF_NETWORK_SHARE) {
    return asDirect();
  }

  return found;
}

/** Route through an ordered list of points, concatenating the legs. */
export function routeThrough(
  network: WalkNetwork,
  points: readonly LatLon[],
  barriers: readonly (readonly (readonly [number, number])[])[] = [],
): Route {
  const legs: RouteLeg[] = [];
  let metres = 0;
  let offNetworkMetres = 0;
  let blocked = false;

  for (let i = 0; i < points.length - 1; i++) {
    const segment = routeBetween(network, points[i]!, points[i + 1]!, barriers);
    legs.push(...segment.legs);
    metres += segment.metres;
    offNetworkMetres += segment.offNetworkMetres;
    // One impassable hop makes the whole journey one, since you still have to
    // make it.
    blocked = blocked || segment.blocked;
  }

  return { legs, metres, offNetworkMetres, blocked };
}
