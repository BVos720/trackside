/**
 * Waypoints: spots gathered into the place they share.
 *
 * A waypoint is one position on the ground; a spot is one way of shooting it.
 * See the note on `Spot.groupId` for why those are separate things. This file
 * turns a flat list of spots into the waypoints the map and the list draw,
 * and answers the questions both of them ask about a group.
 *
 * Pure and total: every function here works on a plain array and returns a
 * plain value, so the same grouping can be reused by the map, the list and a
 * test without any of them agreeing on a store first.
 */
import type { SpotGroupId } from '../domain/ids';
import type { Spot } from '../domain/spot';

/** A place, and every way of shooting it that has been recorded. */
export interface Waypoint {
  /**
   * The group's token, or null for a spot that stands alone.
   *
   * Kept so callers can act on the group — add to it, filter by it — without
   * reaching into `members` to find a value they already had.
   */
  readonly groupId: SpotGroupId | null;
  /**
   * The member the waypoint is drawn and named by.
   *
   * The oldest, not the first in the array: input order is whatever the store
   * happened to return, and a waypoint that renames itself when a list is
   * re-sorted would be a bug that only shows up in the field. Age is stable
   * and it is also the honest answer — the first way you found of shooting a
   * corner is the one you named it for.
   */
  readonly primary: Spot;
  /** Every member, oldest first. Always contains at least `primary`. */
  readonly members: readonly Spot[];
}

/**
 * Oldest first, with a stable tiebreak.
 *
 * Two spots created in the same millisecond are rare but not impossible —
 * duplicating a waypoint can do it — and without the id tiebreak their order
 * would depend on the sort's stability and could differ between the map and
 * the list.
 */
function byAge(a: Spot, b: Spot): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Gather spots into waypoints.
 *
 * Ungrouped spots each become a waypoint of one, so callers never have to
 * handle "grouped" and "loose" as two different shapes — the map draws a list
 * of waypoints and does not care how many ways there are of shooting each.
 *
 * Input order is not preserved: waypoints come back oldest-primary first, for
 * the same stability reason `primary` is the oldest member.
 */
export function groupSpots(spots: readonly Spot[]): Waypoint[] {
  const groups = new Map<SpotGroupId, Spot[]>();
  const loose: Spot[] = [];

  for (const spot of spots) {
    if (spot.groupId === null) {
      loose.push(spot);
      continue;
    }
    const existing = groups.get(spot.groupId);
    if (existing) existing.push(spot);
    else groups.set(spot.groupId, [spot]);
  }

  const out: Waypoint[] = [];

  for (const [groupId, members] of groups) {
    const sorted = [...members].sort(byAge);
    // A group can be left holding one member when the others are deleted. It
    // is still a legitimate waypoint, and keeping its token means adding to it
    // again re-forms the same group rather than a new one.
    out.push({ groupId, primary: sorted[0]!, members: sorted });
  }

  for (const spot of loose) {
    out.push({ groupId: null, primary: spot, members: [spot] });
  }

  return out.sort((a, b) => byAge(a.primary, b.primary));
}

/**
 * The waypoint containing a given spot, or null.
 *
 * Answers "what else is here" from whatever the user just tapped, which is
 * the question the carousel opens with.
 */
export function waypointOf(
  spots: readonly Spot[],
  spotId: Spot['id'],
): Waypoint | null {
  const spot = spots.find((s) => s.id === spotId);
  if (!spot) return null;
  if (spot.groupId === null) {
    return { groupId: null, primary: spot, members: [spot] };
  }
  const members = spots.filter((s) => s.groupId === spot.groupId).sort(byAge);
  return { groupId: spot.groupId, primary: members[0]!, members };
}

/**
 * The best rating in a waypoint, or null when nothing in it is rated.
 *
 * The best rather than the average, because a waypoint is worth visiting for
 * its best photograph. Averaging would punish someone for recording a way of
 * shooting a corner that turned out badly — which is exactly the note most
 * worth keeping.
 */
export function waypointRating(waypoint: Waypoint): number | null {
  let best: number | null = null;
  for (const m of waypoint.members) {
    if (m.rating === null) continue;
    if (best === null || m.rating > best) best = m.rating;
  }
  return best;
}
