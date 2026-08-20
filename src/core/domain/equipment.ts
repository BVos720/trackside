/**
 * The equipment checklist — what to pack for a weekend, ticked off as it goes
 * in the bag.
 *
 * A photographer's kit barely changes between weekends: the same two bodies,
 * the same three lenses, the same stack of batteries and cards, wet gear if
 * the forecast calls for it, ear protection always. The list itself is not
 * the hard part — remembering to *retype* it every event is, and that is
 * exactly the friction that makes people stop using a checklist after the
 * second weekend. The seeding logic in `../logic/equipment.ts` is what
 * removes it: a new event's checklist starts from the most recent previous
 * event's list, names and categories intact, every item reset to unpacked.
 *
 * One item, one row — not a checklist entity wrapping an array. `Entry`
 * (`./entry.ts`) is the closest sibling: a flat, per-event collection with a
 * boolean and its timestamp, no separate "list" object to keep in sync with
 * its own rows. The same shape works here for the same reason.
 *
 * ── Belongs to an event, never to a circuit or the user's permanent kit ────
 * Like `Entry.eventId`, this is *this weekend's* packing list, not a standing
 * property of the venue or a lifetime gear catalogue. `UserGearItemId` in
 * `./ids.ts` is reserved for a different, later concept — spec §4.1's
 * per-user, votable `SpotGearSuggestion` ("bring a 400mm here"), which needs
 * accounts to mean anything and is not this. This is nothing more than a tick
 * list for one weekend's bag, seeded from the last one so it never starts
 * blank.
 *
 * ── Category is free text, not a fixed enum ─────────────────────────────────
 * "Bodies, lenses, batteries, cards, wet gear, ear protection" is the
 * starting set, but it is not closed the way `ReferenceKind` on `Media` is —
 * that enum is closed because there are exactly three things a reference
 * photo is for and adding a fourth is a rare, deliberate decision. A kit list
 * is the opposite: one photographer packs a drone and ND filters, another
 * packs rain covers and a monopod, and a rigid category enum would mean
 * either rejecting what does not fit or growing a migration every time
 * someone's kit does not match the six categories guessed up front. `Spot.uses`
 * is the closer precedent it should not follow, either — that is a small,
 * closed, safety-adjacent set. `Spot.tags` and `Spot.keyTimes` are the actual
 * precedent: free text, with a suggested vocabulary offered by the UI rather
 * than enforced by the type. `SUGGESTED_EQUIPMENT_CATEGORIES` in
 * `../logic/equipment.ts` is that suggestion list, not a validator.
 */
import type { EntityBase, Utc } from './common';
import { newEntityBase, nowUtc } from './common';
import { type EquipmentItemId, type EventId, newId } from './ids';

export interface EquipmentItem extends EntityBase {
  readonly id: EquipmentItemId;
  readonly eventId: EventId;
  /** "R5 body", "24-70 f/2.8", "spare batteries (x4)" — as typed. */
  readonly name: string;
  /**
   * "Bodies", "Lenses", "Batteries", "Cards", "Wet gear", "Ear protection" —
   * or whatever a photographer's own kit actually breaks into. Free text, not
   * a fixed enum; see the note at the top of this file. Null when the item
   * has not been sorted into a group, which groups it under a single
   * "Uncategorised" bucket in the UI rather than losing it.
   */
  readonly category: string | null;
  /** Ticked into the bag. The whole reason this entity exists. */
  readonly packed: boolean;
  /**
   * When it was ticked, or null.
   *
   * Carried alongside the flag for the same reason `Entry.photographedAt`
   * is: a bare boolean cannot be reconciled between two devices that both
   * ticked the same item, and a column added after rows have already spread
   * across devices is a migration nobody wants (§0.1).
   */
  readonly packedAt: Utc | null;
  /** Ordering within the checklist — grouped by category, then this. */
  readonly sortOrder: number;
}

export function newEquipmentItem(input: {
  eventId: EventId;
  name: string;
  category?: string | null;
  packed?: boolean;
  sortOrder?: number;
  at?: Utc;
}): EquipmentItem {
  const packed = input.packed ?? false;
  const at = input.at ?? nowUtc();
  return {
    id: newId<EquipmentItemId>(),
    eventId: input.eventId,
    name: input.name,
    category: input.category ?? null,
    packed,
    packedAt: packed ? at : null,
    sortOrder: input.sortOrder ?? 0,
    ...newEntityBase(at),
  };
}

/**
 * Tick or untick an item.
 *
 * A function rather than a field assignment at each call site, for the same
 * reason `setPhotographed` is on `Entry`: the flag and its timestamp have to
 * move together, and a `packed` true with a null `packedAt` is a row no later
 * reader can interpret.
 */
export function setPacked(
  item: EquipmentItem,
  packed: boolean,
  at: Utc = nowUtc(),
): EquipmentItem {
  if (item.packed === packed) return item;
  return {
    ...item,
    packed,
    packedAt: packed ? at : null,
    updatedAt: at,
  };
}

/**
 * How much of the bag is packed.
 *
 * Counts live items only — a tombstoned row is not a thing you forgot to
 * pack, and including it would make the total drift up every time a
 * mis-typed item was deleted. Mirrors `photographedCount` on `Entry`.
 */
export function packedCount(items: readonly EquipmentItem[]): {
  packed: number;
  total: number;
} {
  const live = items.filter((i) => i.deletedAt === null);
  return {
    packed: live.filter((i) => i.packed).length,
    total: live.length,
  };
}
