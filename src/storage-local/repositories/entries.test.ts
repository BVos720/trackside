/**
 * The entry list, through the store.
 *
 * Two things here are worth a test rather than a read of the code: ticking a
 * car has to survive being tapped faster than a reload settles, and an entry
 * list has to go when its event does. Everything else is the same
 * read-modify-write every repository in this directory does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kv', () => {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(key: string) {
        // A tick between read and write, so overlapping mutations really do
        // overlap — see concurrency.test.ts.
        await Promise.resolve();
        return store.get(key) ?? null;
      },
      async set(key: string, value: string) {
        await Promise.resolve();
        store.set(key, value);
      },
      async remove(key: string) {
        store.delete(key);
      },
      __store: store,
    },
  };
});

import { newEntry, photographedCount, type Entry } from '../../core/domain/entry';
import { newEvent } from '../../core/domain/event';
import { asId, type CircuitId, type EventId, type UserId } from '../../core/domain/ids';
import { parseEntryList } from '../../core/logic/entryList';
import { entries, events } from './documentRepositories';
import { kv } from '../kv';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

beforeEach(() => {
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
});

async function anEvent(name = 'Spa Six Hours') {
  const event = newEvent({ circuitId: CIRCUIT, name, createdBy: USER });
  await events.save(event);
  return event;
}

const anEntry = (eventId: EventId, number: string, team: string | null = null) =>
  newEntry({ eventId, number, team });

describe('saving an entry list', () => {
  it('writes a parsed list in one go', async () => {
    const event = await anEvent();
    const parsed = parseEntryList(
      [
        '#7 · Toyota Gazoo Racing · Hypercar · Conway/Kobayashi/Lopez',
        '#8 · Toyota Gazoo Racing · Hypercar · Buemi/Hartley/Hirakawa',
        '#51 · Ferrari AF Corse · Hypercar · Pier Guidi/Calado/Giovinazzi',
      ].join('\n'),
    );

    await entries.saveMany(
      parsed.entries.map((e) =>
        newEntry({
          eventId: event.id,
          number: e.number,
          className: e.className,
          team: e.team,
          drivers: e.drivers,
          source: e.source,
        }),
      ),
    );

    const saved = await entries.listByEvent(event.id);
    expect(saved.map((e) => e.number)).toEqual(['7', '8', '51']);
    expect(saved[0]!.drivers).toEqual(['Conway', 'Kobayashi', 'Lopez']);
    expect(saved.every((e) => !e.photographed)).toBe(true);
  });

  it('keeps the published order rather than sorting by number', async () => {
    // The list is grouped by class on paper, and that is how it is read in the
    // paddock. Sorting numerically would interleave the classes.
    const event = await anEvent();
    await entries.saveMany([
      anEntry(event.id, '51'),
      anEntry(event.id, '7'),
      anEntry(event.id, '311'),
    ]);

    expect((await entries.listByEvent(event.id)).map((e) => e.number)).toEqual([
      '51',
      '7',
      '311',
    ]);
  });

  it("does not leak one event's list into another", async () => {
    const spa = await anEvent('Spa');
    const nls = await anEvent('NLS10');
    await entries.saveMany([anEntry(spa.id, '7'), anEntry(nls.id, '7')]);

    const list = await entries.listByEvent(spa.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.eventId).toBe(spa.id);
  });

  it('writes nothing for an empty parse', async () => {
    const event = await anEvent();
    await entries.saveMany([]);
    expect(await entries.listByEvent(event.id)).toEqual([]);
  });
});

describe('ticking a car off', () => {
  it('sets the flag and stamps when', async () => {
    const event = await anEvent();
    const entry = anEntry(event.id, '7');
    await entries.save(entry);

    await entries.setPhotographed(entry.id, true, '2026-08-19T13:45:00.000Z');

    const saved = (await entries.get(entry.id))!;
    expect(saved.photographed).toBe(true);
    expect(saved.photographedAt).toBe('2026-08-19T13:45:00.000Z');
  });

  it('clears the timestamp when un-ticked', async () => {
    // A stale time under a cleared flag is a row no later reader can interpret.
    const event = await anEvent();
    const entry = anEntry(event.id, '7');
    await entries.save(entry);
    await entries.setPhotographed(entry.id, true);

    await entries.setPhotographed(entry.id, false);

    const saved = (await entries.get(entry.id))!;
    expect(saved.photographed).toBe(false);
    expect(saved.photographedAt).toBeNull();
  });

  it('does not lose a tick to another tick made at the same moment', async () => {
    // Exactly how this gets used: a row of cars go past, several get tapped in
    // the time one reload takes.
    const event = await anEvent();
    const list = ['7', '8', '51', '54'].map((n) => anEntry(event.id, n));
    await entries.saveMany(list);

    await Promise.all(list.map((e) => entries.setPhotographed(e.id, true)));

    const saved = await entries.listByEvent(event.id);
    expect(saved.filter((e) => e.photographed)).toHaveLength(4);
  });

  it('does not lose a tick to a list being re-imported alongside it', async () => {
    const event = await anEvent();
    const ticked = anEntry(event.id, '7');
    await entries.save(ticked);

    await Promise.all([
      entries.setPhotographed(ticked.id, true),
      entries.saveMany([anEntry(event.id, '8'), anEntry(event.id, '51')]),
    ]);

    const saved = await entries.listByEvent(event.id);
    expect(saved).toHaveLength(3);
    expect(saved.find((e) => e.number === '7')!.photographed).toBe(true);
  });

  it('ignores a tick for an entry that is not there', async () => {
    const event = await anEvent();
    const gone = anEntry(event.id, '99');
    await expect(entries.setPhotographed(gone.id, true)).resolves.toBeUndefined();
  });
});

describe('counting progress', () => {
  it('counts ticks against live entries only', async () => {
    // A deleted row is not a car you failed to photograph. Counting it would
    // make the total drift up every time a mis-parsed line was removed.
    const event = await anEvent();
    const list = ['7', '8', '51'].map((n) => anEntry(event.id, n));
    await entries.saveMany(list);
    await entries.setPhotographed(list[0]!.id, true);
    await entries.softDelete(list[2]!.id);

    const saved = await entries.listByEvent(event.id);
    expect(photographedCount(saved)).toEqual({ photographed: 1, total: 2 });
  });
});

describe('deleting an entry', () => {
  it('tombstones rather than removing', async () => {
    const event = await anEvent();
    const entry = anEntry(event.id, '7');
    await entries.save(entry);

    await entries.softDelete(entry.id, '2026-08-19T09:30:00.000Z');

    expect(await entries.listByEvent(event.id)).toEqual([]);
    // §0.1: the row stays, or it silently reappears from any device that has it.
    const row = (await entries.get(entry.id)) as Entry;
    expect(row.deletedAt).toBe('2026-08-19T09:30:00.000Z');
  });
});

describe('deleting the event', () => {
  it('takes its entry list with it', async () => {
    // An entry has no meaning outside its event — it is a car in a particular
    // race, which is why `Entry.eventId` has no null case.
    const event = await anEvent();
    await entries.saveMany([anEntry(event.id, '7'), anEntry(event.id, '8')]);

    await events.softDelete(event.id, '2026-08-19T09:30:00.000Z');

    expect(await entries.listByEvent(event.id)).toEqual([]);
  });

  it('stamps them with the same moment as the event', async () => {
    const event = await anEvent();
    const entry = anEntry(event.id, '7');
    await entries.save(entry);
    const at = '2026-08-19T09:30:00.000Z';

    await events.softDelete(event.id, at);

    const row = (await entries.get(entry.id))!;
    expect(row.deletedAt).toBe(at);
    expect(row.updatedAt).toBe(at);
  });

  it("leaves another event's list alone", async () => {
    const going = await anEvent('Spa');
    const staying = await anEvent('NLS10');
    const kept = anEntry(staying.id, '7');
    await entries.saveMany([anEntry(going.id, '7'), kept]);

    await events.softDelete(going.id);

    expect(await entries.listByEvent(staying.id)).toHaveLength(1);
    expect((await entries.get(kept.id))!.deletedAt).toBeNull();
  });

  it('keeps the original timestamp on one deleted earlier', async () => {
    const event = await anEvent();
    const entry = anEntry(event.id, '7');
    await entries.save(entry);
    const earlier = '2026-08-01T00:00:00.000Z';
    await entries.softDelete(entry.id, earlier);

    await events.softDelete(event.id, '2026-08-19T09:30:00.000Z');

    expect((await entries.get(entry.id))!.deletedAt).toBe(earlier);
  });
});
