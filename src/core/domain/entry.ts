/**
 * The entry list — which cars are running, and which ones you have shot.
 *
 * An entry is one car at one event: number, class, team, drivers. The point of
 * holding them is `photographed`: over a weekend you are trying to come away
 * with every car, and the only way to know what is still missing is a list you
 * can tick off between sessions.
 *
 * ── Belongs to an event, never to a circuit ────────────────────────────────
 * The same reasoning as `EventDay.eventId`: an entry list is *this weekend's*
 * field, not a standing property of the venue. #7 is Toyota at a WEC round and
 * somebody else's Cup car at an NLS round three weeks later. A list attached
 * to the circuit would merge the two, and the tick you made on one would
 * appear on the other.
 *
 * There is no `eventId: null` case, unlike spots. A spot with no event is a
 * place you know, which is meaningful on its own; an entry with no event is a
 * car in no race.
 */
import type { EntityBase, Utc } from './common';
import { newEntityBase, nowUtc } from './common';
import { type EntryId, type EventId, newId } from './ids';

export interface Entry extends EntityBase {
  readonly id: EntryId;
  readonly eventId: EventId;
  /**
   * Car number exactly as printed, as text.
   *
   * A string and not a number, which matters more than it looks. "07" and "7"
   * are different cars in the same race and would collide the moment either is
   * parsed to an integer; a leading zero is not decoration. Numbers also carry
   * letters in club racing ("1X", "24A"), and sorting is by class order on the
   * published list rather than numerically anyway.
   */
  readonly number: string;
  /** "Hypercar", "LMGT3", "SP9 Pro". Null when the list did not say. */
  readonly className: string | null;
  readonly team: string | null;
  /**
   * Driver names in the order printed.
   *
   * A list rather than a string because an endurance car has three or four and
   * "who was in it" is a real question when captioning a frame afterwards. No
   * attempt is made to split them into given/family names — entry lists write
   * them every way there is, and a wrong split is worse than none.
   */
  readonly drivers: readonly string[];
  /** Ticked off. The whole reason this entity exists. */
  readonly photographed: boolean;
  /**
   * When it was ticked, or null.
   *
   * Carried from the first write rather than added later: a bare boolean
   * cannot be reconciled between two devices that both ticked the same car,
   * and per §0.1 a column added after rows have spread across devices is a
   * migration nobody wants. It also answers "which session did I get it in",
   * which the flag alone cannot.
   */
  readonly photographedAt: Utc | null;
  /**
   * The line this was parsed from, verbatim. Null when typed by hand.
   *
   * Kept for the same reason `TextSession.source` is: the confirmation step
   * shows what was read, and a number that came out wrong is only fixable if
   * the original text is still there to compare against.
   */
  readonly source: string | null;
}

export function newEntry(input: {
  eventId: EventId;
  number: string;
  className?: string | null;
  team?: string | null;
  drivers?: readonly string[];
  photographed?: boolean;
  source?: string | null;
  at?: Utc;
}): Entry {
  return {
    id: newId<EntryId>(),
    eventId: input.eventId,
    number: input.number,
    className: input.className ?? null,
    team: input.team ?? null,
    drivers: input.drivers ?? [],
    photographed: input.photographed ?? false,
    photographedAt: null,
    source: input.source ?? null,
    ...newEntityBase(input.at),
  };
}

/**
 * Tick or untick an entry.
 *
 * A function rather than a field assignment at each call site, because the flag
 * and its timestamp have to move together — a `photographed` true with a null
 * `photographedAt`, or a stale time under a cleared flag, is a row that no
 * later reader can interpret.
 */
export function setPhotographed(
  entry: Entry,
  photographed: boolean,
  at: Utc = nowUtc(),
): Entry {
  if (entry.photographed === photographed) return entry;
  return {
    ...entry,
    photographed,
    photographedAt: photographed ? at : null,
    updatedAt: at,
  };
}

/**
 * How far through the field you are.
 *
 * Counts live entries only — a tombstoned row is not a car you failed to
 * photograph, and including it would make the total drift up every time a
 * mis-parsed line was deleted.
 */
export function photographedCount(entries: readonly Entry[]): {
  photographed: number;
  total: number;
} {
  const live = entries.filter((e) => e.deletedAt === null);
  return {
    photographed: live.filter((e) => e.photographed).length,
    total: live.length,
  };
}
