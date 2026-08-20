/**
 * Equipment checklist state for the event screen.
 *
 * Mirrors useEntries.ts. `saveMany` is used for seeding a new event's
 * checklist from the previous one in one write, for the reason the
 * repository interface gives.
 */
import { useCallback, useEffect, useState } from 'react';

import type { Event } from '../../core/domain/event';
import {
  newEquipmentItem,
  type EquipmentCategory,
  type EquipmentItem,
} from '../../core/domain/equipment';
import type { EquipmentItemId, EventId } from '../../core/domain/ids';
import {
  buildChecklistForNewEvent,
  mostRecentPreviousEvent,
} from '../../core/logic/equipment';
import { equipment as equipmentRepo } from '../../storage-local/repositories/documentRepositories';

/**
 * @param eventId the active event, or null when none is — in which case the
 * list is empty rather than showing another event's checklist (see useEntries).
 */
export function useEquipment(eventId: EventId | null) {
  const [items, setItems] = useState<EquipmentItem[]>([]);

  const reload = useCallback(async () => {
    setItems(eventId ? await equipmentRepo.listByEvent(eventId) : []);
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Add one item to the active event's checklist. No-op with no active event. */
  const addItem = useCallback(
    async (name: string, category: EquipmentCategory | null) => {
      const trimmed = name.trim();
      if (!eventId || trimmed === '') return;
      await equipmentRepo.save(
        newEquipmentItem({
          eventId,
          name: trimmed,
          category,
          sortOrder: items.length,
        }),
      );
      await reload();
    },
    [eventId, items.length, reload],
  );

  const setPacked = useCallback(
    async (id: EquipmentItemId, packed: boolean) => {
      await equipmentRepo.setPacked(id, packed);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: EquipmentItemId) => {
      await equipmentRepo.softDelete(id);
      await reload();
    },
    [reload],
  );

  /**
   * Seed a freshly created event's checklist from the most recent previous
   * one — the entire point of the feature, see core/logic/equipment.ts.
   *
   * Takes the new event explicitly rather than relying on `eventId` above: at
   * the moment a new event is created, this hook's `eventId` still names
   * whichever event was active *before* it — the same reason `attachSpots` in
   * useEvents.ts takes an explicit id rather than trusting `activeId`.
   */
  const seedForNewEvent = useCallback(
    async (
      allEvents: readonly Event[],
      created: Pick<Event, 'id' | 'startDate' | 'createdAt'>,
    ) => {
      const previousEvent = mostRecentPreviousEvent(allEvents, created);
      const previousItems = previousEvent
        ? await equipmentRepo.listByEvent(previousEvent.id)
        : [];
      const seeded = buildChecklistForNewEvent(
        allEvents,
        previousItems,
        created,
        created.id,
      );
      if (seeded.length > 0) await equipmentRepo.saveMany(seeded);
      // Only meaningful if the new event happens to already be the one this
      // hook is watching — harmless otherwise, and it will reload on its own
      // once `eventId` above catches up to it.
      if (created.id === eventId) await reload();
    },
    [eventId, reload],
  );

  return { items, addItem, setPacked, remove, seedForNewEvent, reload };
}
