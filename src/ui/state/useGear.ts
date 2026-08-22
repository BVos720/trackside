/**
 * The user's standing gear locker — bodies and lenses, for D4's event dropdown.
 *
 * Mirrors useEquipment.ts's shape (reload/useEffect/useCallback), but there is
 * no per-event `eventId` here: a `GearItem` belongs to the user, not to any one
 * event (see the file header on `core/domain/gear.ts`), so this hook always
 * loads the same, single locker regardless of which event is active.
 *
 * Adding/editing gear itself is not this hook's job — that is the profile
 * screen's Gear section (`TASKS-profile.md` D2), which has no add/edit UI of
 * its own yet. This hook only reads the locker for the dropdown to search and
 * toggle against.
 */
import { useCallback, useEffect, useState } from 'react';

import type { GearItem } from '../../core/domain/gear';
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

  return { items, reload };
}
