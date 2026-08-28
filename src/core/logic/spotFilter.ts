/**
 * Searching and sorting waypoints — TASKS.md F2/F5.
 *
 * Operates on `Waypoint`, not `Spot`, because that is what the list and the
 * map actually show: filtering the underlying spots would let a waypoint half
 * appear, matching on one way of shooting it and vanishing on another.
 *
 * Pure and total, so the list, the map and a test can agree on what "3 stars
 * and up, named Brünnchen" means without any of them sharing a store first.
 */
import { waypointRating, type Waypoint } from './spotGroups';

export type SpotSort = 'recent' | 'oldest' | 'name' | 'rating';

export interface SpotFilter {
  /** Free text matched against names. Empty means everything. */
  readonly query: string;
  /**
   * Lowest acceptable rating, or null for no rating filter.
   *
   * An unrated waypoint never satisfies this. "3 and up" is a question about
   * quality, and treating "not rated" as passing would fill the answer with
   * the very spots you have not judged yet — see `Spot.rating`.
   */
  readonly minRating: number | null;
  /** Hidden waypoints are decluttered, not deleted, so they are opt-in. */
  readonly includeHidden: boolean;
}

export const NO_FILTER: SpotFilter = {
  query: '',
  minRating: null,
  includeHidden: false,
};

/**
 * Case- and accent-insensitive contains.
 *
 * Accent-folding matters here specifically: the circuits are German, Belgian
 * and Japanese, and a search for "brunnchen" must find "Brünnchen". Someone
 * typing a corner name on a phone at a track will not reach for the umlaut.
 */
function matches(haystack: string, needle: string): boolean {
  const fold = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLocaleLowerCase();
  return fold(haystack).includes(fold(needle));
}

/**
 * Does any way of shooting this place match the text?
 *
 * Any, not the primary's alone: ways can be named for what they are ("wide
 * from the bank", "long lens"), and a search that only read the waypoint's
 * own name would hide the way you were actually looking for.
 */
function nameMatches(waypoint: Waypoint, query: string): boolean {
  const q = query.trim();
  if (q === '') return true;
  return waypoint.members.some((m) => matches(m.name, q));
}

/** Hidden only when every way is — the same rule the map draws by. */
function isHidden(waypoint: Waypoint): boolean {
  return waypoint.members.every((m) => m.isHidden);
}

export function filterWaypoints(
  waypoints: readonly Waypoint[],
  filter: SpotFilter = NO_FILTER,
): Waypoint[] {
  return waypoints.filter((w) => {
    if (!filter.includeHidden && isHidden(w)) return false;
    if (!nameMatches(w, filter.query)) return false;
    if (filter.minRating !== null) {
      const rating = waypointRating(w);
      if (rating === null || rating < filter.minRating) return false;
    }
    return true;
  });
}

/**
 * Sort, always returning a new array.
 *
 * Every comparator falls back to age, so the order is total and a re-sort
 * cannot shuffle equal items — a list that reorders itself under your thumb
 * while you are reading it is worse than one sorted the way you did not want.
 */
export function sortWaypoints(
  waypoints: readonly Waypoint[],
  sort: SpotSort,
): Waypoint[] {
  const byAge = (a: Waypoint, b: Waypoint) =>
    a.primary.createdAt < b.primary.createdAt
      ? -1
      : a.primary.createdAt > b.primary.createdAt
        ? 1
        : a.primary.id < b.primary.id
          ? -1
          : a.primary.id > b.primary.id
            ? 1
            : 0;

  const out = [...waypoints];

  switch (sort) {
    case 'oldest':
      return out.sort(byAge);
    case 'recent':
      return out.sort((a, b) => -byAge(a, b));
    case 'name':
      return out.sort((a, b) => {
        const n = a.primary.name.localeCompare(b.primary.name, undefined, {
          sensitivity: 'base',
          numeric: true,
        });
        return n !== 0 ? n : byAge(a, b);
      });
    case 'rating':
      return out.sort((a, b) => {
        // Unrated last rather than lowest. It is an absence of judgement, not
        // a bad one, and burying it under the one-star spots would be a claim
        // nobody made.
        const ra = waypointRating(a);
        const rb = waypointRating(b);
        if (ra === null && rb === null) return byAge(a, b);
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb !== ra ? rb - ra : byAge(a, b);
      });
  }
}

/** Filter then sort, which is the order every caller wants. */
export function arrangeWaypoints(
  waypoints: readonly Waypoint[],
  filter: SpotFilter = NO_FILTER,
  sort: SpotSort = 'recent',
): Waypoint[] {
  return sortWaypoints(filterWaypoints(waypoints, filter), sort);
}
