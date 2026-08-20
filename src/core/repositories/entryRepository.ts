/**
 * Entry-list contracts — spec §2.3.
 *
 * Async throughout, caller-supplied ids, tombstones only (§0.1). Same rules as
 * every other repository here; see spotRepository.ts for why each one exists.
 */
import type { Entry } from '../domain/entry';
import type { EntryId, EventId } from '../domain/ids';

export interface IEntryRepository {
  /**
   * One event's field, in the order it was published.
   *
   * Insertion order, not car number: an entry list is grouped by class and
   * that grouping is how you read it in the paddock. Sorting numerically would
   * interleave the classes and make the list harder to work down than the
   * printed one it was copied from.
   */
  listByEvent(eventId: EventId): Promise<Entry[]>;
  get(id: EntryId): Promise<Entry | null>;
  save(entry: Entry): Promise<void>;
  /**
   * Write a parsed list in one go.
   *
   * A parse produces forty rows at once, and forty separate `save` calls means
   * forty read-modify-write cycles over the whole collection — each one
   * queued behind the last, and each one re-serialising every row written so
   * far. One write also makes the import atomic: either the list is there or
   * it is not, never half of it because the app was backgrounded mid-loop.
   */
  saveMany(entries: readonly Entry[]): Promise<void>;
  /**
   * Tick a car off, or un-tick it.
   *
   * On the repository rather than left to `save` because the flag and its
   * timestamp have to move together (see `setPhotographed` in the domain), and
   * because this is the one write that happens with a camera in the other
   * hand — it reads the row itself so the caller does not have to hold one.
   */
  setPhotographed(id: EntryId, photographed: boolean, at?: string): Promise<void>;
  softDelete(id: EntryId, at?: string): Promise<void>;
}
