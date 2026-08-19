/**
 * Concurrent writes must not lose each other.
 *
 * Every mutation in this directory is read-modify-write over a whole
 * collection, and the UI fires them without awaiting — `void addStop(...)`, a
 * text field committing on blur while a reload is in flight. Two overlapping
 * mutations that each read the same array and write it back mean the second
 * silently discards the first.
 *
 * That is not a theoretical race. Adding two planned stops and giving them
 * times produced four overlapping writes, and stops appeared to save and then
 * vanish. These tests fire mutations the way the UI does — all at once, without
 * awaiting between them — because sequential ones would pass either way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kv', () => {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(key: string) {
        // A tick between read and write is what makes the interleaving real:
        // without it JS runs each mutation to completion and nothing overlaps.
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

import { newEvent, newPlanStop } from '../../core/domain/event';
import {
  asId,
  newId,
  type CircuitId,
  type SpotId,
  type UserId,
} from '../../core/domain/ids';
import { AccessClassification, newSpot } from '../../core/domain/spot';
import { events, repositories } from './documentRepositories';
import { kv } from '../kv';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

beforeEach(() => {
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
});

async function anEvent() {
  const event = newEvent({ circuitId: CIRCUIT, name: 'NLS10', createdBy: USER });
  await events.save(event);
  return event;
}

describe('concurrent event stop writes', () => {
  it('keeps both stops when two are added at once', async () => {
    const event = await anEvent();
    const a = newPlanStop({ spotId: newId<SpotId>() });
    const b = newPlanStop({ spotId: newId<SpotId>() });

    // Exactly what the planner does: two taps, neither awaited.
    await Promise.all([events.addStop(event.id, a), events.addStop(event.id, b)]);

    const saved = await events.get(event.id);
    expect(saved!.stops.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('keeps both times when two stops are timed at once', async () => {
    const event = await anEvent();
    const a = newPlanStop({ spotId: newId<SpotId>() });
    const b = newPlanStop({ spotId: newId<SpotId>() });
    await events.addStop(event.id, a);
    await events.addStop(event.id, b);

    await Promise.all([
      events.updateStop(event.id, a.id, { arriveAt: '13:45' }),
      events.updateStop(event.id, b.id, { arriveAt: '14:30' }),
    ]);

    const saved = await events.get(event.id);
    const byId = new Map(saved!.stops.map((s) => [s.id, s]));
    expect(byId.get(a.id)?.arriveAt).toBe('13:45');
    expect(byId.get(b.id)?.arriveAt).toBe('14:30');
  });

  it('does not lose a stop to the spot-membership write that follows it', async () => {
    // addStop writes twice: the stop list, then the spot list. The second must
    // not be built on a copy read before the first landed.
    const event = await anEvent();
    const stops = Array.from({ length: 5 }, () =>
      newPlanStop({ spotId: newId<SpotId>() }),
    );

    await Promise.all(stops.map((s) => events.addStop(event.id, s)));

    const saved = await events.get(event.id);
    expect(saved!.stops).toHaveLength(5);
    expect(saved!.spotIds).toHaveLength(5);
  });

  it('survives a burst of mixed edits', async () => {
    const event = await anEvent();
    const a = newPlanStop({ spotId: newId<SpotId>() });
    const b = newPlanStop({ spotId: newId<SpotId>() });
    const c = newPlanStop({ spotId: newId<SpotId>() });
    await Promise.all([
      events.addStop(event.id, a),
      events.addStop(event.id, b),
      events.addStop(event.id, c),
    ]);

    await Promise.all([
      events.updateStop(event.id, a.id, { label: 'Racing legends race 1' }),
      events.moveStop(event.id, c.id, 0),
      events.updateStop(event.id, b.id, { arriveAt: '11:00' }),
    ]);

    const saved = await events.get(event.id);
    expect(saved!.stops).toHaveLength(3);
    const byId = new Map(saved!.stops.map((s) => [s.id, s]));
    expect(byId.get(a.id)?.label).toBe('Racing legends race 1');
    expect(byId.get(b.id)?.arriveAt).toBe('11:00');
    expect(saved!.stops[0]!.id).toBe(c.id);
  });
});

describe('concurrent spot writes', () => {
  it('keeps every spot when several are saved at once', async () => {
    const made = Array.from({ length: 6 }, (_, i) =>
      newSpot({
        circuitId: CIRCUIT,
        name: `spot ${i}`,
        position: { latitude: 50.35, longitude: 6.95, elevation: null },
        createdBy: USER,
        accessClassification: AccessClassification.Unknown,
      }),
    );

    await Promise.all(made.map((s) => repositories.spots.save(s)));

    const rows = await repositories.spots.listByCircuit(CIRCUIT);
    expect(rows).toHaveLength(6);
  });

  it('does not resurrect a spot deleted while another is being saved', async () => {
    const keep = newSpot({
      circuitId: CIRCUIT,
      name: 'keep',
      position: { latitude: 50.35, longitude: 6.95, elevation: null },
      createdBy: USER,
      accessClassification: AccessClassification.Unknown,
    });
    const go = newSpot({
      circuitId: CIRCUIT,
      name: 'go',
      position: { latitude: 50.35, longitude: 6.95, elevation: null },
      createdBy: USER,
      accessClassification: AccessClassification.Unknown,
    });
    await repositories.spots.save(keep);
    await repositories.spots.save(go);

    await Promise.all([
      repositories.spots.softDelete(go.id),
      repositories.spots.save({ ...keep, name: 'renamed' }),
    ]);

    const rows = await repositories.spots.listByCircuit(CIRCUIT);
    expect(rows.map((r) => r.name)).toEqual(['renamed']);
  });
});
