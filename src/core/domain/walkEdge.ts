/**
 * Walking times between spots — spec §4.1, §0.2, §5.15.
 *
 * ── The single most important data-integrity rule in this project ──────────
 *
 * `minutes` is either walked by a human with a watch, or measured from a
 * recorded GPS trace. It is NEVER estimated from straight-line distance.
 *
 * The reason is specific and not hypothetical: at the Nürburgring a 400m
 * straight-line gap can be a 40-minute walk, because the thing in between is
 * a live racetrack you cannot cross except at a tunnel or bridge. Any
 * haversine-derived number is not merely imprecise, it is wrong by a factor
 * that will strand someone on the far side of the circuit while the session
 * they planned around is running.
 *
 * This is the project's moat as well as its correctness backbone. It cannot be
 * scraped and no competitor will invest in walking a 20.8km loop. Filling it
 * with plausible-looking generated values destroys the one asset the product
 * has, and does so invisibly — a fabricated 12 and a walked 12 are
 * indistinguishable a month later.
 *
 * Where an edge is not known, it does not exist. The planner surfaces the gap
 * as "not yet documented" and asks. It does not interpolate.
 */
import type { EntityBase } from './common';
import type { SpotId, WalkEdgeId } from './ids';

export const WalkEdgeSource = {
  /** Entered by a human who has walked it. */
  Manual: 'manual',
  /**
   * Measured from a recorded GPS trace — spec §5.15, Milestone 2.
   *
   * Legitimate because it is measured rather than fabricated, but held to a
   * lower trust level than `manual`: the recorded walk may have been made
   * carrying nothing, at a jog, or via a shortcut that is closed on a race day.
   */
  Derived: 'derived',
} as const;
export type WalkEdgeSource =
  (typeof WalkEdgeSource)[keyof typeof WalkEdgeSource];

/**
 * A directed walking connection between two spots.
 *
 * Directed on purpose. Uphill and downhill are not the same walk, and at the
 * Nordschleife the difference between climbing to Brünnchen and descending
 * from it is real minutes.
 */
export interface WalkEdge extends EntityBase {
  readonly id: WalkEdgeId;
  readonly fromSpotId: SpotId;
  readonly toSpotId: SpotId;
  /** Measured walking time. Never computed from distance. */
  readonly minutes: number;
  readonly source: WalkEdgeSource;
  /**
   * Traces this edge was measured from. Empty for manual edges.
   * Becomes `WalkTraceId[]` when Milestone 2 introduces the entity.
   */
  readonly derivedFromTraceIds: readonly string[];
  /**
   * Whether this walk is possible while cars are on track.
   *
   * ── Always human-supplied. Never derived, under any circumstance. ─────────
   *
   * Spec §0.2 and §5.15. A GPS trace recorded on a quiet Tuesday proves the
   * walk is physically possible; it proves nothing about whether marshals will
   * let you make it during a live session. These are different questions and
   * only a human who has been moved on can answer the second one.
   *
   * `null` means undocumented, and the planner treats it as "ask", never as
   * "yes".
   */
  readonly possibleDuringLiveSession: boolean | null;
  readonly notes: string | null;
}

/**
 * Decide whether an incoming edge may replace an existing one.
 *
 * Spec §5.15: a derived edge must never overwrite a manual one. The human may
 * have deliberately recorded a slower, correct time — carrying a full bag,
 * taking the route that is actually open on a race day — and silently
 * replacing that with a number measured on an empty track day is a regression
 * disguised as an improvement.
 */
export function mayReplace(existing: WalkEdge, incoming: WalkEdge): boolean {
  if (
    existing.source === WalkEdgeSource.Manual &&
    incoming.source === WalkEdgeSource.Derived
  ) {
    return false;
  }
  return true;
}

/**
 * Flag a derived edge that disagrees sharply with a human-entered one.
 *
 * Spec §5.15 asks for human review rather than automatic reconciliation. A
 * large disagreement usually means the two walks were not the same walk — a
 * different route, a closed gate, a tunnel that is only open on event days —
 * and that is information worth surfacing, not averaging away.
 *
 * Returns true when the two differ by more than `tolerance` (default 25%).
 */
export function conflictsWithManual(
  manual: WalkEdge,
  derived: WalkEdge,
  tolerance = 0.25,
): boolean {
  if (manual.minutes <= 0) return false;
  const delta = Math.abs(derived.minutes - manual.minutes);
  return delta / manual.minutes > tolerance;
}
