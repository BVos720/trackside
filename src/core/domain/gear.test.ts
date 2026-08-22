import { describe, expect, it } from 'vitest';
import { asUtc } from './common';
import { GearKind, bodies, lenses, newGearItem } from './gear';
import { asId, type UserId } from './ids';

const BRANCO = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

describe('newGearItem', () => {
  it('creates a body with a crop factor', () => {
    const r7 = newGearItem({
      userId: BRANCO,
      kind: GearKind.Body,
      manufacturer: 'Canon',
      model: 'EOS R7',
      cropFactor: 1.6,
    });

    expect(r7.kind).toBe(GearKind.Body);
    expect(r7.manufacturer).toBe('Canon');
    expect(r7.model).toBe('EOS R7');
    expect(r7.cropFactor).toBe(1.6);
    expect(r7.userId).toBe(BRANCO);
    expect(r7.deletedAt).toBeNull();
  });

  it('defaults an unrecorded body crop factor to null rather than guessing', () => {
    const body = newGearItem({
      userId: BRANCO,
      kind: GearKind.Body,
      manufacturer: 'Canon',
      model: 'EOS R6 Mark II',
    });

    expect(body.cropFactor).toBeNull();
  });

  it('forces a lens to have no crop factor, even when one is supplied', () => {
    const lens = newGearItem({
      userId: BRANCO,
      kind: GearKind.Lens,
      manufacturer: 'Canon',
      model: 'RF 100-500mm f/5-7.1',
      cropFactor: 1.6,
    });

    expect(lens.cropFactor).toBeNull();
  });

  it('stamps createdAt/updatedAt from the given instant', () => {
    const at = asUtc('2026-08-19T09:30:00.000Z');
    const item = newGearItem({
      userId: BRANCO,
      kind: GearKind.Body,
      manufacturer: 'Canon',
      model: 'EOS R6 Mark II',
      cropFactor: 1.0,
      at,
    });

    expect(item.createdAt).toBe(at);
    expect(item.updatedAt).toBe(at);
  });
});

describe('bodies and lenses', () => {
  const r6 = newGearItem({
    userId: BRANCO,
    kind: GearKind.Body,
    manufacturer: 'Canon',
    model: 'EOS R6 Mark II',
    cropFactor: 1.0,
  });
  const r7 = newGearItem({
    userId: BRANCO,
    kind: GearKind.Body,
    manufacturer: 'Canon',
    model: 'EOS R7',
    cropFactor: 1.6,
  });
  const zoom = newGearItem({
    userId: BRANCO,
    kind: GearKind.Lens,
    manufacturer: 'Canon',
    model: 'RF 100-500mm f/5-7.1',
  });

  it('bodies() returns only bodies', () => {
    expect(bodies([r6, r7, zoom]).map((i) => i.id)).toEqual([r6.id, r7.id]);
  });

  it('lenses() returns only lenses', () => {
    expect(lenses([r6, r7, zoom]).map((i) => i.id)).toEqual([zoom.id]);
  });

  it('both exclude tombstoned items', () => {
    const deletedBody = { ...r6, deletedAt: asUtc('2026-08-19T09:30:00.000Z') };
    expect(bodies([deletedBody, r7])).toHaveLength(1);
  });
});
