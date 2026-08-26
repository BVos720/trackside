/**
 * Wipe everything and start from nothing.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Testing this app means reaching states that take a while to build: an event
 * with a timetable and an entry list, a map with spots on it, a plan with
 * stops. When one of those states is what triggers a bug, the only way to try
 * a fix is to get back to a clean device — and on iOS that means deleting and
 * re-sideloading the app, which is minutes of work between every attempt.
 *
 * This turns that into a button. It is not a feature for the people who use
 * the app; it is a tool for the person building it, and it is why the caller
 * keeps it behind a developer section rather than in ordinary settings.
 *
 * ── It is not a "delete my data" feature ──────────────────────────────────
 * Every domain deletion in this app is a tombstone (spec §0.1) so that a
 * future sync can carry the fact of the deletion to another device. This does
 * the opposite: it destroys the records outright, tombstones included, leaving
 * nothing that could ever be reconciled. That is correct for wiping a test
 * device and wrong for anything a user does deliberately, which is the whole
 * reason the two must not share a code path.
 *
 * If a real "delete everything I have" feature is ever wanted, it should be
 * built on the repositories' own soft deletes, not on this.
 */
import { kv } from './kv';
import { mediaStore } from './mediaStore';

/**
 * Delete every record and every stored photo.
 *
 * Photos go first. If the wipe is interrupted between the two — the app is
 * killed, the process is suspended — the surviving state is rows pointing at
 * photos that are gone, which every read path already tolerates: `getUri`
 * returns null for a missing file and the gallery shows no preview. The
 * reverse order would leave orphaned bytes with nothing naming them, taking up
 * space that nothing would ever clean up.
 *
 * Does not throw. Both stores swallow their own "already gone" cases, and a
 * partial wipe is still progress toward the empty state the caller wanted.
 * The caller is expected to send the user back to a known screen afterwards,
 * because anything already rendered is now holding records that no longer
 * exist.
 */
export async function resetApp(): Promise<void> {
  await mediaStore.clear();
  await kv.clear();
}
