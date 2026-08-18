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
  readonly metres: number;
}

export interface WalkNetwork {
  readonly nodes: ReadonlyMap<string, LatLon>;
  readonly edges: ReadonlyMap<string, readonly Edge[]>;
  readonly isEmpty: boolean;
}

/** A network with nothing in it — every route degrades to a direct line. */
export const EMPTY_NETWORK: WalkNetwork = {
  nodes: new Map(),
  edges: new Map(),
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
  ways: readonly (readonly (readonly [number, number])[])[],
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
  const link = (a: string, b: string, metres: number) => {
    if (a === b) return;
    adjacency(a).push({ to: b, metres });
    adjacency(b).push({ to: a, metres });
  };

  for (const way of ways) {
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

      link(ka, kb, haversineMetres(nodes.get(ka)!, nodes.get(kb)!));
    }
  }

  return { nodes, edges, isEmpty: nodes.size === 0 };
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

  const dist = new Map<string, number>([[fromKey, 0]]);
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
      const next = top.cost + edge.metres;
      const known = dist.get(edge.to);
      if (known === undefined || next < known) {
        dist.set(edge.to, next);
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
  return { keys, metres: dist.get(toKey) ?? 0 };
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
): Route {
  const straight = directLeg(from, to);

  const asDirect = (): Route => ({
    legs: [straight],
    metres: straight.metres,
    offNetworkMetres: straight.metres,
  });

  if (network.isEmpty) return asDirect();

  const startNode = nearestNode(network, from);
  const endNode = nearestNode(network, to);
  if (!startNode || !endNode) return asDirect();

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

  // A network route that is far longer than walking straight is not a route,
  // it is a detour nobody would take.
  if (straight.metres > 0 && metres > straight.metres * MAX_DETOUR_RATIO) {
    return asDirect();
  }
  if (legs.length === 0) return asDirect();

  return { legs, metres, offNetworkMetres: offNetwork };
}

/** Route through an ordered list of points, concatenating the legs. */
export function routeThrough(
  network: WalkNetwork,
  points: readonly LatLon[],
): Route {
  const legs: RouteLeg[] = [];
  let metres = 0;
  let offNetworkMetres = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const segment = routeBetween(network, points[i]!, points[i + 1]!);
    legs.push(...segment.legs);
    metres += segment.metres;
    offNetworkMetres += segment.offNetworkMetres;
  }

  return { legs, metres, offNetworkMetres };
}
