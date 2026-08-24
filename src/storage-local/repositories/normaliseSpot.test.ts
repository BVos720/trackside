/**
 * Rows written by an older build must still read as the current `Spot` shape.
 *
 * `normaliseSpot` is the read boundary that makes additive fields not need a
 * migration, and the failure it prevents is not subtle: the type promises an
 * array, a stored row has `undefined`, and the first caller to reach for
 * `.length` takes the app to a white screen. These tests write the *old* shape
 * straight into the store and read it back through the repository, which is
 * the only way to exercise that path honestly — constructing a `Spot` in
 * TypeScript gives you the new shape by definition.
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

import { DEFAULT_SPOT_USES, SpotUse, type Spot } from '../../core/domain/spot';
import { asId, type CircuitId, type SpotId, type UserId } from '../../core/domain/ids';
import { repositories } from './documentRepositories';
import { kv } from '../kv';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');
const SPOTS_KEY = 'trackside.spots.v1';

const store = () =>
  (kv as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => store().clear());

/**
 * A spot as an older build wrote it — every field added since is simply
 * absent, exactly as it would be in a JSON blob on a phone that has not been
 * updated in a season.
 */
function writeLegacyRow(extra: Record<string, unknown> = {}) {
  const row = {
    id: asId<SpotId>('01920000-0000-7000-8000-00000000aaaa'),
    circuitId: CIRCUIT,
    name: 'Brünnchen',
    position: { latitude: 50.35, longitude: 6.95, elevation: null },
    accessClassification: 'unknown',
    accessNotes: null,
    nearestMarshalPostId: null,
    shootingBearing: null,
    visibility: 'private',
    createdBy: USER,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    syncState: 'local',
    ...extra,
  };
  store().set(SPOTS_KEY, JSON.stringify([row]));
  return row.id;
}

describe('normaliseSpot — a row from before `uses` existed', () => {
  it('gives it the default uses rather than undefined', async () => {
    // The bug this guards: `Spot.uses` is typed as always present, so any
    // caller doing `spot.uses.includes(...)` on an old row throws.
    const id = writeLegacyRow();

    const spot = (await repositories.spots.get(id)) as Spot;

    expect(spot.uses).toBeDefined();
    expect(Array.isArray(spot.uses)).toBe(true);
    expect(spot.uses).toEqual([...DEFAULT_SPOT_USES]);
  });

  it('defaults it through listByCircuit too, not just get', async () => {
    // Both read paths run normaliseSpot; the list is the one the map uses.
    writeLegacyRow();

    const [spot] = await repositories.spots.listByCircuit(CIRCUIT);

    expect(spot!.uses).toEqual([...DEFAULT_SPOT_USES]);
  });

  it('keeps the uses a newer row actually recorded', async () => {
    const id = writeLegacyRow({ uses: [SpotUse.Spectating] });

    const spot = (await repositories.spots.get(id)) as Spot;

    expect(spot.uses).toEqual([SpotUse.Spectating]);
  });

  it('treats an empty array as absent rather than as "for nothing"', async () => {
    // `normaliseUses`, not `?? []` — a spot recorded with no uses at all would
    // otherwise become one that never matches any filter and silently
    // disappears from every mode.
    const id = writeLegacyRow({ uses: [] });

    const spot = (await repositories.spots.get(id)) as Spot;

    expect(spot.uses).toEqual([...DEFAULT_SPOT_USES]);
  });

  it('drops a use it does not recognise', async () => {
    // Forward compatibility: a row written by a *newer* build can carry a use
    // this one has never heard of, and a value outside the union would defeat
    // the type just as badly as undefined.
    const id = writeLegacyRow({ uses: ['spectating', 'teleportation'] });

    const spot = (await repositories.spots.get(id)) as Spot;

    expect(spot.uses).toEqual([SpotUse.Spectating]);
  });

  it('still defaults the other fields added over time', async () => {
    // The same boundary, guarding the fields that arrived before `uses`.
    const id = writeLegacyRow();

    const spot = (await repositories.spots.get(id)) as Spot;

    expect(spot.keyTimes).toEqual([]);
    expect(spot.tags).toEqual([]);
    expect(spot.shotSettings).toEqual([]);
    expect(spot.isHidden).toBe(false);
    expect(spot.eventId).toBeNull();
  });
});
