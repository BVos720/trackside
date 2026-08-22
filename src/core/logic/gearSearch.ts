/**
 * Free-text search over a user's gear locker — D4's "dropdown … needs to
 * have a search bar."
 *
 * Matching on manufacturer and model *together*, not as separate fields: a
 * `GearItem` is "Canon" / "EOS R6 Mark II", and the task's own examples ask
 * for "r6", "canon r6" and "EOS R6" to all find it. Splitting the query into
 * words and requiring every word to appear somewhere in the combined,
 * lower-cased "manufacturer model" string is what makes all three work with
 * one rule, rather than three special cases:
 *
 *   - "r6"        → one word, found inside "eos r6 mark ii".
 *   - "canon r6"  → two words, both found ("canon" in manufacturer, "r6" in
 *                   model) — order across fields does not matter.
 *   - "EOS R6"    → case folds away before matching.
 *
 * A pure filter over rows already in memory — this is offline, local gear,
 * never a lookup against anything external (see the file header on
 * `../domain/gear.ts`).
 */
import type { GearItem } from '../domain/gear';

/** Lower-cased, collapsed to single spaces, for stable substring matching. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Filter `items` down to the ones whose manufacturer+model match every word
 * in `query`. An empty (or whitespace-only) query returns `items` unchanged,
 * in their original order — this is a filter, not a re-sort.
 */
export function searchGear(
  items: readonly GearItem[],
  query: string,
): GearItem[] {
  const words = normalise(query)
    .split(' ')
    .filter((w) => w.length > 0);
  if (words.length === 0) return [...items];

  return items.filter((item) => {
    const haystack = normalise(`${item.manufacturer} ${item.model}`);
    return words.every((word) => haystack.includes(word));
  });
}
