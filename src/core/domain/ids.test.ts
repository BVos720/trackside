import { describe, expect, it } from 'vitest';
import {
  type SpotId,
  asId,
  isUuid,
  isUuidV7,
  newId,
  timestampFromUuidV7,
} from './ids';

describe('newId', () => {
  it('mints v7 UUIDs, not v4', () => {
    // Spec §0.1 requires v7 specifically. v4 would pass a generic UUID check
    // while silently destroying index locality, so assert the version nibble.
    const id = newId<SpotId>();
    expect(isUuid(id)).toBe(true);
    expect(isUuidV7(id)).toBe(true);
  });

  it('does not collide across a large batch', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId<SpotId>()));
    expect(ids.size).toBe(10_000);
  });

  it('sorts lexicographically in creation order', () => {
    // The whole reason for choosing v7. Ids generated in sequence must also
    // sort in sequence as plain strings, including within a single millisecond
    // — otherwise B-tree writes scatter and ORDER BY id stops matching
    // ORDER BY createdAt.
    const ids = Array.from({ length: 5_000 }, () => newId<SpotId>());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('keeps sorting correctly across a millisecond boundary', async () => {
    const before = newId<SpotId>();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const after = newId<SpotId>();
    expect(before < after).toBe(true);
  });
});

describe('isUuidV7', () => {
  it('rejects a v4 UUID', () => {
    const v4 = '9f1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c';
    expect(isUuid(v4)).toBe(true);
    expect(isUuidV7(v4)).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuidV7('12345')).toBe(false);
  });
});

describe('timestampFromUuidV7', () => {
  it('recovers roughly the creation time', () => {
    const before = Date.now();
    const id = newId<SpotId>();
    const after = Date.now();

    const recovered = timestampFromUuidV7(id);
    expect(recovered).not.toBeNull();
    expect(recovered!.getTime()).toBeGreaterThanOrEqual(before);
    expect(recovered!.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns null for a non-v7 id rather than a bogus date', () => {
    expect(timestampFromUuidV7('9f1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c')).toBeNull();
    expect(timestampFromUuidV7('nonsense')).toBeNull();
  });
});

describe('asId', () => {
  it('round-trips a stored string back to a branded id', () => {
    const original = newId<SpotId>();
    const stored: string = original;
    expect(asId<SpotId>(stored)).toBe(original);
  });
});
