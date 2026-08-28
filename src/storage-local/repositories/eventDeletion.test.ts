/**
 * Deleting an event takes its own copies of the spots with it.
 *
 * An event used to hold *references* to shared spots (§4.2), and deleting one
 * therefore had to leave every spot alone. It no longer does: "Start from my
 * spots" clones the selection and an imported event arrives with its own
 * copies, so the rows carrying the event's id belong to it and to nothing else.
 *
 * The failure this pins down is silent. A copy left behind keeps an `eventId`
 * pointing at a tombstoned event, so `spotsForContext(spots, null)` never puts
 * it on the home map and no event lists it either — it is invisible, still
 * there, and grows by one full set of spots every time a weekend is deleted.
 *
 * The other half matters just as much: the home map is the permanent
 * collection this app exists to accumulate, and no event may delete from it.
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

import { newEvent } from '../../core/domain/event';
import {
  MediaSource,
  MediaType,
  type Media,
  type ReferenceKind,
} from '../../core/domain/media';
import { spotsForContext } from '../../core/logic/cloneSpots';
import {
  asId,
  newId,
  type CircuitId,
  type EventId,
  type MediaId,
  type SpotId,
  type UserId,
} from '../../core/domain/ids';
import { Visibility, nowUtc } from '../../core/domain/common';
import { AccessClassification, newSpot, type Spot } from '../../core/domain/spot';
import { events, repositories } from './documentRepositories';
import { kv } from '../kv';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

beforeEach(() => {
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
});

async function anEvent(name: string) {
  const event = newEvent({ circuitId: CIRCUIT, name, createdBy: USER });
  await events.save(event);
  return event;
}

async function aSpot(name: string, eventId: EventId | null = null) {
  const spot = newSpot({
    circuitId: CIRCUIT,
    eventId,
    name,
    position: { latitude: 50.35, longitude: 6.95, elevation: null },
    createdBy: USER,
    accessClassification: AccessClassification.PublicLand,
  });
  await repositories.spots.save(spot);
  return spot;
}

/** A reference photo on a spot, shaped as `addPhoto` writes them. */
async function aPhoto(
  spotId: SpotId | null,
  referenceKind: ReferenceKind | null = null,
) {
  const at = nowUtc();
  const row: Media = {
    id: newId<MediaId>(),
    ownerId: USER,
    spotId,
    tag: null,
    type: MediaType.Photo,
    source: MediaSource.Uploaded,
    storageKey: 'media/local/1',
    externalUrl: null,
    referenceKind,
    isKeyImage: false,
    focalX: null,
    focalY: null,
    sortOrder: 0,
    capturedAt: null,
    capturedBearing: null,
    capturedPitch: null,
    visibility: Visibility.Private,
    metadataStripped: false,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    syncState: 'local',
  };
  await repositories.media.save(row);
  return row;
}

/** Every stored row, tombstones included — what actually accumulates. */
async function stored(): Promise<Map<string, Spot>> {
  const rows = await repositories.spots.listAllIncludingDeleted();
  return new Map(rows.map((s) => [s.name, s]));
}

describe('deleting an event', () => {
  it('tombstones the copies the event owns', async () => {
    const event = await anEvent('NLS10');
    await aSpot('event copy', event.id);

    await events.softDelete(event.id);

    expect((await stored()).get('event copy')!.deletedAt).not.toBeNull();
  });

  it('leaves the home map alone', async () => {
    // The original rule, with its actual reason intact: an event may not
    // delete from the permanent collection.
    const event = await anEvent('NLS10');
    await aSpot('home spot');
    await aSpot('event copy', event.id);

    await events.softDelete(event.id);

    const rows = await stored();
    expect(rows.get('home spot')!.deletedAt).toBeNull();
    expect(spotsForContext([...rows.values()], null).map((s) => s.name)).toEqual([
      'home spot',
    ]);
  });

  it('does not reach into another event', async () => {
    const going = await anEvent('NLS10');
    const staying = await anEvent('Spa Six Hours');
    await aSpot('going copy', going.id);
    await aSpot('staying copy', staying.id);

    await events.softDelete(going.id);

    const rows = await stored();
    expect(rows.get('going copy')!.deletedAt).not.toBeNull();
    expect(rows.get('staying copy')!.deletedAt).toBeNull();
    expect(await repositories.spots.listByCircuit(CIRCUIT)).toHaveLength(1);
  });

  it('stamps the copies with the timestamp the caller gave', async () => {
    // Deletion is one event in time; the event and its spots must agree on
    // when, or a sync would reconcile the two halves against each other.
    const event = await anEvent('NLS10');
    await aSpot('event copy', event.id);
    const at = '2026-08-19T09:30:00.000Z';

    await events.softDelete(event.id, at);

    const spot = (await stored()).get('event copy')!;
    expect(spot.deletedAt).toBe(at);
    expect(spot.updatedAt).toBe(at);
    expect((await events.listAllIncludingDeleted())[0]!.deletedAt).toBe(at);
  });

  it('keeps the original timestamp on a spot already deleted', async () => {
    // A copy binned while planning was deleted then, not when the weekend was.
    const event = await anEvent('NLS10');
    const spot = await aSpot('binned while planning', event.id);
    const earlier = '2026-08-01T00:00:00.000Z';
    await repositories.spots.softDelete(spot.id, earlier);

    await events.softDelete(event.id, '2026-08-19T09:30:00.000Z');

    expect((await stored()).get('binned while planning')!.deletedAt).toBe(earlier);
  });

  it('leaves rows written before events existed on the home map', async () => {
    // Those rows have no `eventId` field at all, and `undefined` must read as
    // the permanent collection rather than matching anything.
    const event = await anEvent('NLS10');
    const legacy = await aSpot('legacy');
    const { eventId: _dropped, ...withoutField } = legacy;
    await repositories.spots.save(withoutField as Spot);

    await events.softDelete(event.id);

    expect((await stored()).get('legacy')!.deletedAt).toBeNull();
  });
});

/**
 * Media hangs off spots, so the cascade has to reach one level further.
 *
 * `listBySpot` is the only route to a media row, and no screen asks a deleted
 * spot for its gallery. A photo left live under a tombstoned copy is therefore
 * exactly the orphan the spot cascade exists to stop, one level down.
 */
describe('deleting an event, and the photos on its spots', () => {
  it("tombstones photos attached to the event's own copies", async () => {
    const event = await anEvent('NLS10');
    const copy = await aSpot('event copy', event.id);
    const photo = await aPhoto(copy.id);

    await events.softDelete(event.id);

    expect((await repositories.media.get(photo.id))!.deletedAt).not.toBeNull();
    expect(await repositories.media.listBySpot(copy.id)).toEqual([]);
  });

  it('leaves photos on the home map alone', async () => {
    const event = await anEvent('NLS10');
    const home = await aSpot('home spot');
    const homePhoto = await aPhoto(home.id);
    const copy = await aSpot('event copy', event.id);
    await aPhoto(copy.id);

    await events.softDelete(event.id);

    expect((await repositories.media.get(homePhoto.id))!.deletedAt).toBeNull();
    expect(await repositories.media.listBySpot(home.id)).toHaveLength(1);
  });

  it('stamps the photos with the same timestamp as the event', async () => {
    const event = await anEvent('NLS10');
    const copy = await aSpot('event copy', event.id);
    const photo = await aPhoto(copy.id);
    const at = '2026-08-19T09:30:00.000Z';

    await events.softDelete(event.id, at);

    const saved = (await repositories.media.get(photo.id))!;
    expect(saved.deletedAt).toBe(at);
    expect(saved.updatedAt).toBe(at);
  });

  it('does not touch a photo that belongs to no spot', async () => {
    // `Media.spotId` is nullable, and a null must not be swept up by an
    // ownership test it can never legitimately answer.
    const event = await anEvent('NLS10');
    await aSpot('event copy', event.id);
    const loose = await aPhoto(null);

    await events.softDelete(event.id);

    expect((await repositories.media.get(loose.id))!.deletedAt).toBeNull();
  });
});
