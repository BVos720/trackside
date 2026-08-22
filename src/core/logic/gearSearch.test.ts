import { describe, expect, it } from 'vitest';

import { GearKind, newGearItem } from '../domain/gear';
import { asId, type UserId } from '../domain/ids';
import { searchGear } from './gearSearch';

const BRANCO = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

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
const a7iv = newGearItem({
  userId: BRANCO,
  kind: GearKind.Body,
  manufacturer: 'Sony',
  model: 'A7 IV',
  cropFactor: 1.0,
});
const rf100500 = newGearItem({
  userId: BRANCO,
  kind: GearKind.Lens,
  manufacturer: 'Canon',
  model: 'RF 100-500mm f/5-7.1',
});

const locker = [r6, r7, a7iv, rf100500];

describe('searchGear', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(searchGear(locker, '')).toEqual(locker);
  });

  it('returns everything for a whitespace-only query', () => {
    expect(searchGear(locker, '   ')).toEqual(locker);
  });

  it('matches on a bare model fragment, case-insensitively', () => {
    expect(searchGear(locker, 'r6')).toEqual([r6]);
  });

  it('matches "canon r6" — manufacturer word plus model word', () => {
    expect(searchGear(locker, 'canon r6')).toEqual([r6]);
  });

  it('matches "EOS R6" regardless of case', () => {
    expect(searchGear(locker, 'EOS R6')).toEqual([r6]);
  });

  it('matches on manufacturer alone, returning every item from it', () => {
    expect(searchGear(locker, 'canon')).toEqual([r6, r7, rf100500]);
  });

  it('matches on model alone across manufacturers', () => {
    expect(searchGear(locker, 'iv')).toEqual([a7iv]);
  });

  it('requires every word to match — "canon a7" matches nothing', () => {
    expect(searchGear(locker, 'canon a7')).toEqual([]);
  });

  it('is insensitive to repeated internal whitespace', () => {
    expect(searchGear(locker, '  canon    r6  ')).toEqual([r6]);
  });

  it('matches a lens by a fragment of its model', () => {
    expect(searchGear(locker, '100-500')).toEqual([rf100500]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(searchGear(locker, 'nikon')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = [...locker];
    searchGear(locker, 'canon');
    expect(locker).toEqual(copy);
  });
});
