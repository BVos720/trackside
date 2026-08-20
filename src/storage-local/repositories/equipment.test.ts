/**
 * The equipment checklist, through the store.
 *
 * Mirrors entries.test.ts: ticking an item has to survive being tapped faster
 * than a reload settles, and a checklist has to go when its event does.
 * Everything else is the same read-modify-write every repository here does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kv', () => {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(key: string) {
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

import { EquipmentCategory, newEquipmentItem, packedCount, type EquipmentItem } from '../../core/domain/equipment';
import { newEvent } from '../../core/domain/event';
import { asId, type CircuitId, type EventId, type UserId } from '../../core/domain/ids';
import { equipment, events } from './documentRepositories';
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

const anItem = (
  eventId: EventId,
  name: string,
  category: EquipmentCategory | null = null,
) => newEquipmentItem({ eventId, name, category });

describe('building a checklist', () => {
  it('writes a seeded list in one go', async () => {
    const event = await anEvent();
    await equipment.saveMany([
      anItem(event.id, 'R5 body', EquipmentCategory.Body),
      anItem(event.id, '24-70 f/2.8', EquipmentCategory.Lens),
    ]);

    const saved = await equipment.listByEvent(event.id);
    expect(saved.map((i) => i.name)).toEqual(['R5 body', '24-70 f/2.8']);
    expect(saved.every((i) => !i.packed)).toBe(true);
  });

  it("does not leak one event's checklist into another", async () => {
    const spa = await anEvent('Spa');
    const nls = await anEvent('NLS10');
    await equipment.saveMany([anItem(spa.id, 'R5 body'), anItem(nls.id, 'R5 body')]);

    const list = await equipment.listByEvent(spa.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.eventId).toBe(spa.id);
  });

  it('writes nothing for an empty seed', async () => {
    const event = await anEvent();
    await equipment.saveMany([]);
    expect(await equipment.listByEvent(event.id)).toEqual([]);
  });
});

describe('packing an item', () => {
  it('sets the flag and stamps when', async () => {
    const event = await anEvent();
    const item = anItem(event.id, 'R5 body');
    await equipment.save(item);

    await equipment.setPacked(item.id, true, '2026-08-19T13:45:00.000Z');

    const saved = (await equipment.get(item.id))!;
    expect(saved.packed).toBe(true);
    expect(saved.packedAt).toBe('2026-08-19T13:45:00.000Z');
  });

  it('clears the timestamp when un-packed', async () => {
    const event = await anEvent();
    const item = anItem(event.id, 'R5 body');
    await equipment.save(item);
    await equipment.setPacked(item.id, true);

    await equipment.setPacked(item.id, false);

    const saved = (await equipment.get(item.id))!;
    expect(saved.packed).toBe(false);
    expect(saved.packedAt).toBeNull();
  });

  it('does not lose a tick to another tick made at the same moment', async () => {
    const event = await anEvent();
    const list = ['R5 body', '24-70 f/2.8', 'batteries', 'cards'].map((n) =>
      anItem(event.id, n),
    );
    await equipment.saveMany(list);

    await Promise.all(list.map((i) => equipment.setPacked(i.id, true)));

    const saved = await equipment.listByEvent(event.id);
    expect(saved.filter((i) => i.packed)).toHaveLength(4);
  });
});

describe('counting progress', () => {
  it('counts ticks against live items only', async () => {
    const event = await anEvent();
    const list = ['R5 body', '24-70 f/2.8', 'batteries'].map((n) => anItem(event.id, n));
    await equipment.saveMany(list);
    await equipment.setPacked(list[0]!.id, true);
    await equipment.softDelete(list[2]!.id);

    const saved = await equipment.listByEvent(event.id);
    expect(packedCount(saved)).toEqual({ packed: 1, total: 2 });
  });
});

describe('deleting an item', () => {
  it('tombstones rather than removing', async () => {
    const event = await anEvent();
    const item = anItem(event.id, 'R5 body');
    await equipment.save(item);

    await equipment.softDelete(item.id, '2026-08-19T09:30:00.000Z');

    expect(await equipment.listByEvent(event.id)).toEqual([]);
    const row = (await equipment.get(item.id)) as EquipmentItem;
    expect(row.deletedAt).toBe('2026-08-19T09:30:00.000Z');
  });
});

describe('deleting the event', () => {
  it('takes its checklist with it', async () => {
    const event = await anEvent();
    await equipment.saveMany([anItem(event.id, 'R5 body'), anItem(event.id, '24-70 f/2.8')]);

    await events.softDelete(event.id, '2026-08-19T09:30:00.000Z');

    expect(await equipment.listByEvent(event.id)).toEqual([]);
  });

  it('stamps them with the same moment as the event', async () => {
    const event = await anEvent();
    const item = anItem(event.id, 'R5 body');
    await equipment.save(item);
    const at = '2026-08-19T09:30:00.000Z';

    await events.softDelete(event.id, at);

    const row = (await equipment.get(item.id))!;
    expect(row.deletedAt).toBe(at);
    expect(row.updatedAt).toBe(at);
  });

  it("leaves another event's checklist alone", async () => {
    const going = await anEvent('Spa');
    const staying = await anEvent('NLS10');
    const kept = anItem(staying.id, 'R5 body');
    await equipment.saveMany([anItem(going.id, 'R5 body'), kept]);

    await events.softDelete(going.id);

    expect(await equipment.listByEvent(staying.id)).toHaveLength(1);
    expect((await equipment.get(kept.id))!.deletedAt).toBeNull();
  });
});
