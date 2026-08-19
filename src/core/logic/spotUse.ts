/**
 * Filtering the map by what you came to do.
 *
 * The app started as a photography tool, so every position was a camera
 * position and there was nothing to filter. Watching a race is a different job
 * with different requirements — you want a view of more than one corner, some
 * idea of what is happening elsewhere, and somewhere you can stand for four
 * hours — and the positions that satisfy it are mostly not the good camera
 * spots.
 *
 * So the map has a mode, and a spot declares which modes it belongs in. The
 * filter is deliberately trivial; what matters is that it is one function
 * rather than a condition rewritten at each call site, because the map, the
 * spot list, the planner and the navigator all have to agree about what is
 * visible or a stop appears in a plan you cannot see on the map.
 */
import { SpotUse, normaliseUses } from '../domain/spot';
import type { Spot } from '../domain/spot';

/**
 * Does this spot belong in the given mode?
 *
 * Reads through `normaliseUses` rather than the raw field, so a row written
 * before `uses` existed — or one hand-edited to an empty list — answers as a
 * photography spot instead of matching nothing at all.
 */
export function spotServes(spot: Spot, use: SpotUse): boolean {
  return normaliseUses(spot.uses).includes(use);
}

/** The spots worth showing in one mode. */
export function spotsForUse(spots: readonly Spot[], use: SpotUse): Spot[] {
  return spots.filter((s) => spotServes(s, use));
}

/**
 * How many spots each mode would show.
 *
 * For labelling the switch. A mode that is about to show an empty map should
 * say so on the control that gets you there, rather than after the tap — the
 * count is the difference between "there is nothing here" and "the app is
 * broken", and those look identical on a blank map.
 */
export function countByUse(
  spots: readonly Spot[],
): Record<SpotUse, number> {
  const counts: Record<SpotUse, number> = {
    [SpotUse.Photography]: 0,
    [SpotUse.Spectating]: 0,
  };
  for (const spot of spots) {
    for (const use of normaliseUses(spot.uses)) counts[use] += 1;
  }
  return counts;
}

/**
 * Toggle one use on a spot's set, refusing to empty it.
 *
 * The editor's checkboxes go through here. Unticking the last box would leave
 * a spot that matches no mode and drops off every screen, so the last one
 * cannot be untied — the UI shows it as fixed rather than letting the tap do
 * nothing unexplained.
 */
export function toggleUse(
  uses: readonly SpotUse[],
  use: SpotUse,
  on: boolean,
): SpotUse[] {
  const current = normaliseUses(uses);
  if (on) return current.includes(use) ? current : [...current, use];

  const without = current.filter((u) => u !== use);
  return without.length === 0 ? current : without;
}
