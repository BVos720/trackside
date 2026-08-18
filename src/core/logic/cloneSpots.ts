/**
 * Copying spots into an event.
 *
 * "Start from my spots" duplicates your collection into the event rather than
 * pointing at it. The event then owns its copies: moving a pin, retiming it or
 * deleting it while planning a weekend cannot touch the map you have built up
 * over years.
 *
 * ── This is a deliberate trade, made the other way from §4.2 ───────────────
 * The spec's Spot / UserSpotNote split exists to stop duplicate pins, and by
 * that logic an event should hold references. It held them for exactly that
 * reason until the failure mode showed up in use: with references, deleting a
 * spot while tidying a race-weekend map deletes it *everywhere*, permanently,
 * and the thing you lose is the thing the whole app exists to accumulate.
 *
 * §4.2's duplicate-pin problem is about a *shared* map — two hundred
 * photographers each dropping their own Brünnchen pin. Copies inside one
 * person's own event are invisible to everyone else and are never published, so
 * they do not cause that failure. The cost here is real but small and local: a
 * correction made during an event has to be made again on the home map.
 *
 * `eventId` is what keeps the copies from doubling every pin — the default map
 * shows only spots with no event.
 */
import { newId, type EventId, type SpotId } from '../domain/ids';
import type { Spot } from '../domain/spot';
import { nowUtc } from '../domain/common';

/**
 * Clone spots into an event.
 *
 * Each copy gets a fresh id — §0.1's identity rule: a record two devices could
 * both mint needs a UUID v7, and reusing the source id would make the copy
 * indistinguishable from its original on sync.
 *
 * Media is deliberately *not* cloned here. Photos are bytes in the media store,
 * and duplicating them per event would multiply storage for no gain; the copy
 * carries no media until you add some. That is the one place the copy differs
 * from its source, and the UI says so.
 */
export function cloneSpotsForEvent(
  spots: readonly Spot[],
  eventId: EventId,
): Spot[] {
  const at = nowUtc();
  return spots.map((source) => ({
    ...source,
    id: newId<SpotId>(),
    eventId,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    // A copy has never been anywhere; it is local until it syncs on its own.
    syncState: 'local' as const,
  }));
}

/**
 * The spots visible for a given context.
 *
 * `null` is the default map — the permanent collection. An event id shows only
 * that event's own copies, so the two never appear on the map together.
 */
export function spotsForContext(
  spots: readonly Spot[],
  eventId: EventId | null,
): Spot[] {
  return spots.filter((s) => (s.eventId ?? null) === eventId);
}
