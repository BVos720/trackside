/**
 * Building and seeding an event's equipment checklist.
 *
 * The sibling of `cloneSpots.ts`, built on the same trade for the same
 * reason: don't reference the previous event's rows, copy them, so ticking a
 * box this weekend can never reach back and untick one from a weekend that
 * already happened. Where `cloneSpotsForEvent` exists so a correction made
 * while planning cannot damage the permanent map, `seedChecklistFromPrevious`
 * exists so retyping the kit list is never the reason the checklist gets
 * abandoned — the whole point of the feature. See `../domain/equipment.ts`
 * for the entity itself, `setPacked` and `packedCount`, both re-exported
 * below so this file is a complete surface for a caller who only wants to
 * import one module.
 */
import { fromUtc, nowUtc, type Utc } from '../domain/common';
import { newId, type EventId } from '../domain/ids';
import { parseIsoDate, type Event } from '../domain/event';
import {
  EquipmentCategory,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  newEquipmentItem,
  packedCount,
  setPacked,
  type EquipmentItem,
} from '../domain/equipment';
import type { EquipmentItemId } from '../domain/ids';

// Re-exported so a caller — the add-item dropdown, in particular — only
// needs to import this one module for the whole equipment surface: the
// category values and their labels, the tick/summary helpers, and the type.
export {
  EquipmentCategory,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  packedCount,
  setPacked,
  type EquipmentItem,
};

/** One line to add when building a checklist from scratch. */
export interface NewChecklistItemInput {
  readonly name: string;
  readonly category?: EquipmentCategory | null;
}

/**
 * A fresh checklist for an event, from scratch.
 *
 * The fallback when there is no previous event to seed from — the very first
 * weekend, or one where `mostRecentPreviousEvent` finds nothing. Items keep
 * the order they were given, stamped into `sortOrder` so it survives a
 * round-trip through storage the same way the input order will not.
 */
export function newChecklist(
  eventId: EventId,
  items: readonly NewChecklistItemInput[] = [],
  at: Utc = nowUtc(),
): EquipmentItem[] {
  return items.map((item, index) =>
    newEquipmentItem({
      eventId,
      name: item.name,
      category: item.category ?? null,
      sortOrder: index,
      at,
    }),
  );
}

/** One event's checklist, out of a larger collection. */
export function checklistForEvent(
  items: readonly EquipmentItem[],
  eventId: EventId,
): EquipmentItem[] {
  return items.filter((i) => i.eventId === eventId);
}

/**
 * When an event "occurs", for ordering purposes: its own `startDate` when it
 * has one, and its `createdAt` instant otherwise.
 *
 * Mirrors the fallback `../logic/eventLifecycle.ts` does not need but this
 * does — a dateless event (nothing scheduled yet) still has to sort somewhere
 * relative to the rest, and the moment it was created is the only fact this
 * app has about when that was.
 */
function eventOccursAt(event: Pick<Event, 'startDate' | 'createdAt'>): Date {
  const scheduled = event.startDate ? parseIsoDate(event.startDate) : null;
  return scheduled ?? fromUtc(event.createdAt);
}

/**
 * The most recent event that occurred before `before`, or null when there
 * isn't one.
 *
 * "Before" is by design the caller's whole candidate list — deleted events
 * excluded here, but *not* filtered to the same circuit: the kit for a
 * weekend at Spa is the same kit as the weekend before at the Nordschleife,
 * and scoping this to one circuit would mean every first visit to a new
 * track starts the checklist blank for no reason. A caller that wants
 * circuit-scoped seeding can filter `events` before calling this; nothing
 * here assumes either choice.
 */
export function mostRecentPreviousEvent(
  events: readonly Event[],
  before: Pick<Event, 'id' | 'startDate' | 'createdAt'>,
): Event | null {
  const cutoff = eventOccursAt(before).getTime();
  let best: Event | null = null;
  let bestAt = -Infinity;

  for (const event of events) {
    if (event.deletedAt !== null) continue;
    if (event.id === before.id) continue;
    const at = eventOccursAt(event).getTime();
    if (at >= cutoff) continue;
    if (at > bestAt) {
      best = event;
      bestAt = at;
    }
  }

  return best;
}

/**
 * Seed a new event's checklist from a previous one's.
 *
 * Item names and categories are carried over; tick state is not — a fresh
 * event needs everything packed again, so every copy starts unpacked no
 * matter what the source item said. Each copy gets a fresh id (§0.1: a
 * record two devices could each mint needs a UUID v7, and reusing the
 * source id would make the copy indistinguishable from its original on
 * sync) and is marked local, exactly as `cloneSpotsForEvent` does for spots.
 *
 * Tombstoned source items are dropped rather than carried forward: an item
 * deleted from last weekend's list (bought new gear, retired an old body)
 * was a deliberate correction, and resurrecting it on the next event would
 * undo that correction silently.
 */
export function seedChecklistFromPrevious(
  previousItems: readonly EquipmentItem[],
  eventId: EventId,
  at: Utc = nowUtc(),
): EquipmentItem[] {
  return previousItems
    .filter((item) => item.deletedAt === null)
    .map((source) => ({
      ...source,
      id: newId<EquipmentItemId>(),
      eventId,
      packed: false,
      packedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      syncState: 'local' as const,
    }));
}

/**
 * Build a new event's checklist end to end: find the most recent previous
 * event among `events`, seed from its checklist in `items` if one exists,
 * or fall back to `newChecklist` (empty by default) when there is none.
 *
 * The single entry point a wiring pass needs — it does not, by itself, wire
 * anything in; see the file header.
 */
export function buildChecklistForNewEvent(
  events: readonly Event[],
  items: readonly EquipmentItem[],
  newEvent: Pick<Event, 'id' | 'startDate' | 'createdAt'>,
  eventId: EventId,
  at: Utc = nowUtc(),
): EquipmentItem[] {
  const previousEvent = mostRecentPreviousEvent(events, newEvent);
  if (previousEvent === null) return newChecklist(eventId, [], at);

  const previousItems = checklistForEvent(items, previousEvent.id);
  if (previousItems.length === 0) return newChecklist(eventId, [], at);

  return seedChecklistFromPrevious(previousItems, eventId, at);
}
