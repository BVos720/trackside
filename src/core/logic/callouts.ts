/**
 * Deciding which callouts to draw, and which to stack.
 *
 * A circuit has spots metres apart — Brünnchen alone can hold half a dozen
 * positions — and at any zoom where the lap fits on screen their labels land on
 * top of each other. Overlapping cards are worse than useless: you cannot read
 * either one, and you cannot tell how many are hiding underneath.
 *
 * So callouts that would collide become a single stack showing the front card
 * with a count. That is honest about what is there — "six spots here" — instead
 * of silently drawing five of them behind the sixth.
 *
 * ── The stack sits between its members, and points at all of them ──────────
 * A stack is anchored at the midpoint of the spots it covers, with a leader
 * line to each one. The obvious alternative — anchoring on one member and
 * hiding the rest — puts a card over a specific pin while describing several,
 * so the four spots it is also standing for are invisible and unaccounted for.
 *
 * The midpoint is not itself a place anything is, which for a tool whose job is
 * telling you where to stand would normally be unacceptable. The leader lines
 * are what make it safe: every real position still has a line ending on it, so
 * the card is clearly a label for a group rather than a marker for a location.
 * Without those lines this would be the app pointing at empty ground.
 *
 * ── Why the geometry lives in core/ ────────────────────────────────────────
 * This is screen-space maths with no map, DOM or React in it, which means it
 * can be tested directly and shared by the web and native map screens. The two
 * platforms position callouts through entirely different mechanisms; having
 * them disagree about *which* callouts exist would be a bug nobody would find
 * until they were side by side.
 */

/** A point already projected to screen space. */
export interface PlacedPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface CalloutCluster<T extends PlacedPoint> {
  /**
   * Where the card goes: the midpoint of the members for a stack, and the
   * member itself when there is only one.
   */
  readonly x: number;
  readonly y: number;
  /** Members, front-most first. Each keeps its own position for a leader line. */
  readonly items: readonly T[];
}

export interface ClusterOptions {
  /** Viewport size in the same units as the points. */
  readonly width: number;
  readonly height: number;
  /** Callout card size, used both for culling and for the overlap test. */
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** Extra separation required between two cards, in pixels. */
  readonly gap?: number;
  /** Stop after this many clusters. */
  readonly maxClusters?: number;
}

/**
 * Would two cards at these anchors overlap?
 *
 * Cards sit above their anchor and are horizontally centred on it, so the test
 * is an axis-aligned box overlap in that frame.
 */
function overlaps(
  a: { x: number; y: number },
  b: { x: number; y: number },
  cardWidth: number,
  cardHeight: number,
  gap: number,
): boolean {
  return (
    Math.abs(a.x - b.x) < cardWidth + gap &&
    Math.abs(a.y - b.y) < cardHeight + gap
  );
}

/**
 * Cull off-screen points, then group the rest into non-overlapping clusters.
 *
 * Points are processed nearest-the-bottom first, because a card sits above its
 * anchor: the lowest anchor on screen is the one whose card is least likely to
 * be pushed off the top edge, so it makes the better seed for a stack.
 *
 * Grouping tests against the *seed* rather than the running midpoint. A moving
 * target would let a stack creep across the screen one member at a time, ending
 * up describing spots nowhere near it.
 */
export function clusterCallouts<T extends PlacedPoint>(
  points: readonly T[],
  options: ClusterOptions,
): CalloutCluster<T>[] {
  const { width, height, cardWidth, cardHeight } = options;
  const gap = options.gap ?? 4;
  const maxClusters = options.maxClusters ?? Infinity;

  // Cull generously: a card whose anchor is just off screen may still have
  // most of its body visible, and popping it in only once the anchor crosses
  // the edge reads as flickering.
  const margin = Math.max(cardWidth, cardHeight);
  const visible = points.filter(
    (p) =>
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= -margin &&
      p.x <= width + margin &&
      p.y >= -margin &&
      p.y <= height + margin,
  );

  // Bottom-up, then left-to-right so the result is stable frame to frame —
  // an unstable order makes stacks reshuffle while panning.
  const ordered = [...visible].sort((a, b) =>
    b.y !== a.y ? b.y - a.y : a.x - b.x,
  );

  const groups: { seed: PlacedPoint; items: T[] }[] = [];

  for (const point of ordered) {
    const hit = groups.find((g) =>
      overlaps(g.seed, point, cardWidth, cardHeight, gap),
    );
    if (hit) {
      hit.items.push(point);
      continue;
    }
    if (groups.length >= maxClusters) continue;
    groups.push({ seed: point, items: [point] });
  }

  return groups.map(({ items }) => {
    if (items.length === 1) {
      const only = items[0]!;
      return { x: only.x, y: only.y, items };
    }
    // Midpoint of the extent rather than the mean: with five spots along a
    // straight and one off on its own, the mean sits among the five and the
    // outlier's leader line crosses the whole card. The extent centre keeps
    // the lines splayed either side, as in the sketch.
    const xs = items.map((i) => i.x);
    const ys = items.map((i) => i.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      items,
    };
  });
}
