/**
 * Entry-list state for the event screen — spec §5.3, same rule as the
 * timetable: nothing is written until the user confirms it.
 *
 * Mirrors useSessions.ts. `saveMany` is used for a parse rather than one
 * `save` per row for the reason the repository interface gives: forty rows is
 * forty read-modify-write cycles otherwise, each queued behind the last.
 */
import { useCallback, useEffect, useState } from 'react';

import { newEntry, type Entry } from '../../core/domain/entry';
import type { EntryId, EventId } from '../../core/domain/ids';
import type { TextEntry } from '../../core/logic/entryList';
import { entries as entryRepo } from '../../storage-local/repositories/documentRepositories';

/**
 * @param eventId the active event, or null when none is — in which case the
 * list is empty rather than showing another event's field (see useSessions).
 */
export function useEntries(eventId: EventId | null) {
  const [rows, setRows] = useState<Entry[]>([]);

  const reload = useCallback(async () => {
    setRows(eventId ? await entryRepo.listByEvent(eventId) : []);
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Write a confirmed parse. No-op with no active event — see `Entry.eventId`. */
  const addParsed = useCallback(
    async (parsed: readonly TextEntry[]) => {
      if (!eventId || parsed.length === 0) return;
      await entryRepo.saveMany(
        parsed.map((p) =>
          newEntry({
            eventId,
            number: p.number,
            className: p.className,
            team: p.team,
            drivers: p.drivers,
            source: p.source,
          }),
        ),
      );
      await reload();
    },
    [eventId, reload],
  );

  const setPhotographed = useCallback(
    async (id: EntryId, photographed: boolean) => {
      await entryRepo.setPhotographed(id, photographed);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: EntryId) => {
      await entryRepo.softDelete(id);
      await reload();
    },
    [reload],
  );

  return { entries: rows, addParsed, setPhotographed, remove, reload };
}
