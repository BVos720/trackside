/**
 * The user's standing gear locker — bodies and lenses, for D4's event dropdown
 * and the profile screen's Gear section (TASKS-profile.md D2).
 *
 * No per-event `eventId` here, unlike the event-scoped hooks beside it: a `GearItem` belongs to the user, not to any one
 * event (see the file header on `core/domain/gear.ts`), so this hook always
 * loads the same, single locker regardless of which event is active.
 *
 * `addItem`/`remove` live here rather than on the profile screen directly
 * because `App.tsx` calls this hook once at the root and hands the same
 * `items` down to both the profile screen (which writes) and the event
 * screen's gear dropdown (which only reads) — adding a body here updates the
 * dropdown's list immediately, no remount required.
 */
import { useCallback, useEffect, useState } from 'react';

import { newGearItem, type GearItem, type GearKind } from '../../core/domain/gear';
import type { UserGearItemId } from '../../core/domain/ids';
import { gear as gearRepo } from '../../storage-local/repositories/documentRepositories';
import { LOCAL_USER_ID } from './useSpots';

export function useGear() {
  const [items, setItems] = useState<GearItem[]>([]);

  const reload = useCallback(async () => {
    setItems(await gearRepo.listByUser(LOCAL_USER_ID));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Add one body or lens to the locker. `cropFactor` is ignored (forced
   * `null`) for a lens by `newGearItem` itself — see that function's doc
   * comment. Blank manufacturer/model is a no-op rather than saving an empty
   * row.
   */
  const addItem = useCallback(
    async (input: {
      kind: GearKind;
      manufacturer: string;
      model: string;
      cropFactor?: number | null;
    }) => {
      const manufacturer = input.manufacturer.trim();
      const model = input.model.trim();
      if (manufacturer === '' || model === '') return;
      await gearRepo.save(
        newGearItem({
          userId: LOCAL_USER_ID,
          kind: input.kind,
          manufacturer,
          model,
          cropFactor: input.cropFactor ?? null,
        }),
      );
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: UserGearItemId) => {
      await gearRepo.softDelete(id);
      await reload();
    },
    [reload],
  );

  return { items, addItem, remove, reload };
}
