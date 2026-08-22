/**
 * The gear locker, through the store.
 *
 * Mirrors equipment.test.ts: scoped to a user rather than an event, and with
 * no per-item tick to test, but otherwise the same read-modify-write every
 * repository here does.
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

import { GearKind, newGearItem, type GearItem } from '../../core/domain/gear';
import { asId, type UserGearItemId, type UserId } from '../../core/domain/ids';
import { gear } from './documentRepositories';
import { kv } from '../kv';

const BRANCO = asId<UserId>('01920000-0000-7000-8000-0000000000ff');
const OTHER = asId<UserId>('01920000-0000-7000-8000-0000000000aa');

beforeEach(() => {
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
});

const aBody = (userId: UserId, manufacturer: string, model: string, cropFactor: number | null) =>
  newGearItem({ userId, kind: GearKind.Body, manufacturer, model, cropFactor });

const aLens = (userId: UserId, manufacturer: string, model: string) =>
  newGearItem({ userId, kind: GearKind.Lens, manufacturer, model });

describe('building a locker', () => {
  it('writes a seeded locker in one go', async () => {
    await gear.saveMany([
      aBody(BRANCO, 'Canon', 'EOS R6 Mark II', 1.0),
      aLens(BRANCO, 'Canon', 'RF 100-500mm f/5-7.1'),
    ]);

    const saved = await gear.listByUser(BRANCO);
    expect(saved.map((i) => i.model)).toEqual([
      'EOS R6 Mark II',
      'RF 100-500mm f/5-7.1',
    ]);
  });

  it("does not leak one user's locker into another", async () => {
    await gear.saveMany([
      aBody(BRANCO, 'Canon', 'EOS R7', 1.6),
      aBody(OTHER, 'Canon', 'EOS R7', 1.6),
    ]);

    const list = await gear.listByUser(BRANCO);
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe(BRANCO);
  });

  it('writes nothing for an empty seed', async () => {
    await gear.saveMany([]);
    expect(await gear.listByUser(BRANCO)).toEqual([]);
  });
});

describe('saving one item', () => {
  it('round-trips a body with its crop factor', async () => {
    const body = aBody(BRANCO, 'Canon', 'EOS R7', 1.6);
    await gear.save(body);

    const saved = (await gear.get(body.id))!;
    expect(saved.kind).toBe(GearKind.Body);
    expect(saved.cropFactor).toBe(1.6);
  });

  it('forces a lens to have no crop factor even if one is supplied', async () => {
    const lens = newGearItem({
      userId: BRANCO,
      kind: GearKind.Lens,
      manufacturer: 'Canon',
      model: 'RF 100-500mm f/5-7.1',
      cropFactor: 1.6,
    });
    await gear.save(lens);

    const saved = (await gear.get(lens.id))!;
    expect(saved.cropFactor).toBeNull();
  });

  it('updates an existing item rather than duplicating it', async () => {
    const body = aBody(BRANCO, 'Canon', 'EOS R7', 1.6);
    await gear.save(body);

    const renamed: GearItem = { ...body, model: 'EOS R7 (backup)' };
    await gear.save(renamed);

    const list = await gear.listByUser(BRANCO);
    expect(list).toHaveLength(1);
    expect(list[0]!.model).toBe('EOS R7 (backup)');
  });

  it('returns null for an id that was never saved', async () => {
    expect(await gear.get(asId<UserGearItemId>('01920000-0000-7000-8000-000000009999'))).toBeNull();
  });
});

describe('deleting an item', () => {
  it('tombstones rather than removing', async () => {
    const body = aBody(BRANCO, 'Canon', 'EOS R7', 1.6);
    await gear.save(body);

    await gear.softDelete(body.id, '2026-08-19T09:30:00.000Z');

    expect(await gear.listByUser(BRANCO)).toEqual([]);
    const row = (await gear.get(body.id)) as GearItem;
    expect(row.deletedAt).toBe('2026-08-19T09:30:00.000Z');
  });

  it("leaves another item alone", async () => {
    const kept = aBody(BRANCO, 'Canon', 'EOS R6 Mark II', 1.0);
    const going = aLens(BRANCO, 'Canon', 'RF 100-500mm f/5-7.1');
    await gear.saveMany([kept, going]);

    await gear.softDelete(going.id);

    const list = await gear.listByUser(BRANCO);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(kept.id);
  });

  it('does not lose a delete to a concurrent save on another item', async () => {
    const a = aBody(BRANCO, 'Canon', 'EOS R6 Mark II', 1.0);
    const b = aBody(BRANCO, 'Canon', 'EOS R7', 1.6);
    await gear.saveMany([a, b]);

    await Promise.all([gear.softDelete(a.id), gear.save({ ...b, model: 'EOS R7 (renamed)' })]);

    const list = await gear.listByUser(BRANCO);
    expect(list).toHaveLength(1);
    expect(list[0]!.model).toBe('EOS R7 (renamed)');
  });
});
