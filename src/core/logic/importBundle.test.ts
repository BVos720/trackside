import { describe, expect, it } from 'vitest';

import { nowUtc } from '../domain/common';
import { newEntry, type Entry } from '../domain/entry';
import { newEquipmentItem, type EquipmentItem } from '../domain/equipment';
import { newEvent, newPlanStop, type Event } from '../domain/event';
import {
  asId,
  newId,
  type CircuitId,
  type EventDayId,
  type EventId,
  type SessionId,
  type SpotId,
  type UserId,
} from '../domain/ids';
import { SessionKind, type Session } from '../domain/planning';
import { AccessClassification, newSpot, type Spot } from '../domain/spot';
import { buildEventBundle, type EventBundle } from './eventBundle';
import {
  describeImport,
  inspectBundle,
  planImport,
  type LocalState,
} from './importBundle';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

const aSpot = (name: string, eventId: EventId | null = null): Spot => ({
  ...newSpot({
    circuitId: CIRCUIT,
    name,
    position: { latitude: 50.35, longitude: 6.95, elevation: null },
    createdBy: USER,
    accessClassification: AccessClassification.PublicLand,
  }),
  eventId,
});

const aSession = (dayId: EventDayId, name: string): Session => ({
  id: newId<SessionId>(),
  eventDayId: dayId,
  seriesName: name,
  className: null,
  kind: SessionKind.Race,
  startTime: nowUtc(),
  endTime: nowUtc(),
  isNight: false,
  createdAt: nowUtc(),
  updatedAt: nowUtc(),
  deletedAt: null,
  syncState: 'local',
});

/**
 * A bundle shaped like the ones the app actually writes: an event whose plan
 * refers to its own cloned spots, and a session hanging off a day.
 */
function aBundle() {
  const eventId = newId<EventId>();
  const brunnchen = aSpot('Brünnchen', eventId);
  const pflanzgarten = aSpot('Pflanzgarten', eventId);
  const dayId = newId<EventDayId>();
  const session = aSession(dayId, 'Racing legends race 1');

  const event: Event = {
    ...newEvent({ circuitId: CIRCUIT, name: 'NLS10', createdBy: USER }),
    id: eventId,
    spotIds: [brunnchen.id, pflanzgarten.id],
    stops: [
      {
        ...newPlanStop({ spotId: brunnchen.id, arriveAt: '13:40' }),
        sessionId: session.id,
      },
      newPlanStop({ spotId: pflanzgarten.id, arriveAt: '15:10' }),
    ],
  };

  const bundle = buildEventBundle({
    event,
    spots: [brunnchen, pflanzgarten],
    sessions: [session],
    days: [{ id: dayId, date: '2026-10-10', label: 'SATURDAY' }],
  });

  return { bundle, event, brunnchen, pflanzgarten, dayId, session };
}

const EMPTY: LocalState = { events: [], spots: [] };

describe('inspectBundle', () => {
  it('reports no conflict when the event is not here', () => {
    const { bundle } = aBundle();
    expect(inspectBundle(bundle, EMPTY).kind).toBe('none');
  });

  it('reports a live conflict when the event already exists', () => {
    const { bundle, event } = aBundle();
    const conflict = inspectBundle(bundle, { events: [event], spots: [] });

    expect(conflict.kind).toBe('live');
    expect(conflict).toMatchObject({ localName: 'NLS10' });
  });

  it('distinguishes a deleted event from a live one', () => {
    // Restoring over a tombstone resurrects something the user deleted on
    // purpose. It must never be reported as an empty slot.
    const { bundle, event } = aBundle();
    const deleted = { ...event, deletedAt: nowUtc() };

    expect(inspectBundle(bundle, { events: [deleted], spots: [] }).kind).toBe(
      'deleted',
    );
  });
});

describe('planImport — restore', () => {
  it('keeps every id, so nothing is duplicated', () => {
    const { bundle, event, brunnchen, pflanzgarten } = aBundle();
    const plan = planImport(bundle, EMPTY, 'restore');

    expect(plan.event.id).toBe(event.id);
    expect(plan.spots.map((s) => s.id)).toEqual([brunnchen.id, pflanzgarten.id]);
    expect(plan.event.stops.map((s) => s.spotId)).toEqual([
      brunnchen.id,
      pflanzgarten.id,
    ]);
  });

  it('clears the event tombstone — that is what a restore is for', () => {
    const { bundle, event } = aBundle();
    const local: LocalState = {
      events: [{ ...event, deletedAt: nowUtc() }],
      spots: [],
    };

    expect(planImport(bundle, local, 'restore').event.deletedAt).toBeNull();
  });

  it('does not resurrect spots the bundle recorded as deleted', () => {
    // A bundle is a snapshot including what had been deleted by then. Restoring
    // the event should reproduce that state, not undo it.
    const { bundle, brunnchen, pflanzgarten } = aBundle();
    const withDeleted: EventBundle = {
      ...bundle,
      spots: [{ ...brunnchen, deletedAt: nowUtc() }, pflanzgarten],
    };

    const plan = planImport(withDeleted, EMPTY, 'restore');
    const restored = new Map(plan.spots.map((s) => [s.id, s]));

    expect(restored.get(brunnchen.id)?.deletedAt).not.toBeNull();
    expect(restored.get(pflanzgarten.id)?.deletedAt).toBeNull();
  });

  it('refuses to overwrite a spot belonging to the home map', () => {
    // The invariant cloning exists to protect, reached through import instead
    // of through editing. A bundle must never drag a permanent spot into an
    // event, however its ids came to collide.
    const { bundle, brunnchen } = aBundle();
    const homeCopy: Spot = { ...brunnchen, eventId: null, name: 'Mine' };

    const plan = planImport(bundle, { events: [], spots: [homeCopy] }, 'restore');

    expect(plan.spots.map((s) => s.id)).not.toContain(brunnchen.id);
    expect(plan.spots).toHaveLength(1);
    expect(plan.warnings.join(' ')).toMatch(/belongs to your map/i);
  });

  it('overwrites the event’s own spots without complaint', () => {
    const { bundle, event, brunnchen } = aBundle();
    const stale: Spot = { ...brunnchen, name: 'old name', eventId: event.id };

    const plan = planImport(bundle, { events: [], spots: [stale] }, 'restore');

    expect(plan.spots).toHaveLength(2);
    expect(plan.warnings).toHaveLength(0);
  });
});

describe('planImport — copy', () => {
  it('remints every id', () => {
    const { bundle, event, brunnchen, pflanzgarten, session, dayId } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');
    const originals = [brunnchen.id as string, pflanzgarten.id as string];

    expect(plan.event.id).not.toBe(event.id);
    for (const spot of plan.spots) {
      expect(originals).not.toContain(spot.id as string);
    }
    expect(plan.sessions.map((s) => s.id)).not.toContain(session.id);
    expect(plan.days.map((d) => d.id)).not.toContain(dayId);
  });

  it('rewrites the plan to point at the new spots', () => {
    // The failure this guards: reminting ids without rewriting references
    // imports cleanly, reports the right spot count, and leaves an empty route.
    const { bundle } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');

    const newIds = plan.spots.map((s) => s.id);
    expect(plan.event.stops).toHaveLength(2);
    for (const stop of plan.event.stops) {
      expect(newIds).toContain(stop.spotId);
    }
    expect(plan.event.spotIds).toEqual(newIds);
  });

  it('preserves the order the route was planned in', () => {
    const { bundle } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');

    const nameOf = new Map(plan.spots.map((s) => [s.id, s.name]));
    expect(plan.event.stops.map((s) => nameOf.get(s.spotId))).toEqual([
      'Brünnchen',
      'Pflanzgarten',
    ]);
  });

  it('rewrites session references on stops', () => {
    const { bundle } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');
    const copied = plan.sessions.map((s) => s.id);

    expect(copied).toContain(plan.event.stops[0]?.sessionId);
    expect(plan.event.stops[1]?.sessionId).toBeNull();
  });

  it('rewrites each session onto its copied day', () => {
    const { bundle } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');
    const dayIds = plan.days.map((d) => d.id);

    expect(dayIds).toContain(plan.sessions[0]?.eventDayId);
    expect(plan.days.map((d) => d.label)).toContain('SATURDAY');
  });

  it('points every copied spot and day at the new event', () => {
    const { bundle } = aBundle();
    const plan = planImport(bundle, EMPTY, 'copy');

    for (const spot of plan.spots) expect(spot.eventId).toBe(plan.event.id);
    for (const day of plan.days) expect(day.eventId).toBe(plan.event.id);
  });

  it('drops plan references to spots the file does not contain', () => {
    // Keeping the original id would be worse: it may resolve locally, to the
    // spot this bundle was copied from, silently reaching into the home map.
    const { bundle, brunnchen } = aBundle();
    const truncated: EventBundle = { ...bundle, spots: [brunnchen] };

    const plan = planImport(truncated, EMPTY, 'copy');

    expect(plan.event.stops).toHaveLength(1);
    expect(plan.event.spotIds).toHaveLength(1);
    expect(plan.warnings.join(' ')).toMatch(/dropped/i);
    expect(plan.warnings.join(' ')).toMatch(/missing from the route/i);
  });

  it('never leaves a stop pointing at an id that is not in the import', () => {
    const { bundle, brunnchen } = aBundle();
    const truncated: EventBundle = { ...bundle, spots: [brunnchen] };

    const plan = planImport(truncated, EMPTY, 'copy');
    const present = new Set(plan.spots.map((s) => s.id as string));

    for (const stop of plan.event.stops) {
      expect(present.has(stop.spotId as string)).toBe(true);
    }
    for (const id of plan.event.spotIds) {
      expect(present.has(id as string)).toBe(true);
    }
  });

  it('produces different ids on every run, so two copies never collide', () => {
    const { bundle } = aBundle();
    const first = planImport(bundle, EMPTY, 'copy');
    const second = planImport(bundle, EMPTY, 'copy');

    expect(first.event.id).not.toBe(second.event.id);
    expect(first.spots.map((s) => s.id)).not.toEqual(
      second.spots.map((s) => s.id),
    );
  });
});

describe('planImport — damaged files', () => {
  it('files a session with no day under Unscheduled rather than hiding it', () => {
    // Sessions are grouped by day on screen, so one pointing at a day that is
    // not there would be present in the data and invisible in the UI.
    const { bundle } = aBundle();
    const orphaned: EventBundle = { ...bundle, days: [] };

    for (const mode of ['restore', 'copy'] as const) {
      const plan = planImport(orphaned, EMPTY, mode);
      const dayIds = new Set(plan.days.map((d) => d.id as string));

      expect(plan.sessions).toHaveLength(1);
      expect(dayIds.has(plan.sessions[0]?.eventDayId as string)).toBe(true);
      expect(plan.warnings.join(' ')).toMatch(/Unscheduled/i);
    }
  });

  it('handles an event with nothing in it', () => {
    const empty = buildEventBundle({
      event: newEvent({ circuitId: CIRCUIT, name: 'Empty', createdBy: USER }),
      spots: [],
      sessions: [],
      days: [],
    });

    for (const mode of ['restore', 'copy'] as const) {
      const plan = planImport(empty, EMPTY, mode);
      expect(plan.spots).toHaveLength(0);
      expect(plan.event.stops).toHaveLength(0);
      expect(plan.warnings).toHaveLength(0);
    }
  });
});

describe('describeImport', () => {
  it('lists what will be written, without naming the mode', () => {
    // The mode is already on the button this sits under.
    const { bundle } = aBundle();

    expect(describeImport(planImport(bundle, EMPTY, 'restore'))).toBe(
      '2 spots, 1 session, 2 planned stops.',
    );
    expect(describeImport(planImport(bundle, EMPTY, 'copy'))).toBe(
      '2 spots, 1 session, 2 planned stops.',
    );
  });

  it('counts a truncated copy honestly', () => {
    const { bundle, brunnchen } = aBundle();
    const truncated: EventBundle = { ...bundle, spots: [brunnchen] };

    expect(describeImport(planImport(truncated, EMPTY, 'copy'))).toBe(
      '1 spot, 1 session, 1 planned stop.',
    );
  });
});

/**
 * Entry lists through an import.
 *
 * The same reference-rewriting problem as the spots and sessions above: an
 * entry belongs to exactly one event, so a copy that keeps the original
 * `eventId` produces a list attached to the event it was copied from —
 * ticking a car in one would tick it in both, and neither would look wrong.
 */
describe('entries', () => {
  const anEntry = (eventId: EventId, number: string, photographed = false): Entry => ({
    ...newEntry({ eventId, number, team: 'Toyota Gazoo Racing' }),
    photographed,
    photographedAt: photographed ? nowUtc() : null,
  });

  function withEntries(photographed = false) {
    const { bundle, event } = aBundle();
    return {
      event,
      bundle: {
        ...bundle,
        entries: [
          anEntry(event.id, '7', photographed),
          anEntry(event.id, '8'),
        ],
      } satisfies EventBundle,
    };
  }

  it('restores them as themselves', () => {
    const { bundle } = withEntries();
    const plan = planImport(bundle, EMPTY, 'restore');

    expect(plan.entries.map((e) => e.id)).toEqual(bundle.entries.map((e) => e.id));
    expect(plan.entries.map((e) => e.eventId)).toEqual([
      bundle.event.id,
      bundle.event.id,
    ]);
  });

  it('restores the ticks, which is most of the point of a backup', () => {
    const { bundle } = withEntries(true);
    const plan = planImport(bundle, EMPTY, 'restore');

    expect(plan.entries.find((e) => e.number === '7')!.photographed).toBe(true);
  });

  it('remints every id on a copy', () => {
    const { bundle } = withEntries();
    const plan = planImport(bundle, EMPTY, 'copy');
    const old = new Set(bundle.entries.map((e) => e.id as string));

    expect(plan.entries).toHaveLength(2);
    for (const entry of plan.entries) {
      expect(old.has(entry.id as string)).toBe(false);
    }
  });

  it('points a copy at its own event, not the one it came from', () => {
    // The failure this prevents: two events sharing an entry list, where
    // ticking a car in one silently ticks it in the other.
    const { bundle } = withEntries();
    const plan = planImport(bundle, EMPTY, 'copy');

    expect(plan.event.id).not.toBe(bundle.event.id);
    for (const entry of plan.entries) {
      expect(entry.eventId).toBe(plan.event.id);
    }
  });

  it('carries the ticks on a copy and says so', () => {
    // Copy is as often "keep both versions" of your own event as it is "open
    // someone else's", and clearing would destroy a weekend's count to tidy up
    // a cosmetic wrongness. Carried, and named in the warnings.
    const { bundle } = withEntries(true);
    const plan = planImport(bundle, EMPTY, 'copy');

    expect(plan.entries.find((e) => e.number === '7')!.photographed).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/already marked as photographed/i);
  });

  it('does not warn about ticks when there are none', () => {
    const { bundle } = withEntries(false);
    expect(planImport(bundle, EMPTY, 'copy').warnings).toEqual([]);
  });

  it('carries no tombstone onto a copy', () => {
    const { bundle, event } = withEntries();
    const deleted: EventBundle = {
      ...bundle,
      entries: [{ ...anEntry(event.id, '9'), deletedAt: nowUtc() }],
    };

    expect(planImport(deleted, EMPTY, 'copy').entries[0]!.deletedAt).toBeNull();
  });

  it('keeps a tombstone on a restore', () => {
    // A restore reproduces the state the file recorded, deletions included —
    // the same rule the spots follow.
    const { bundle, event } = withEntries();
    const deleted: EventBundle = {
      ...bundle,
      entries: [{ ...anEntry(event.id, '9'), deletedAt: nowUtc() }],
    };

    expect(planImport(deleted, EMPTY, 'restore').entries[0]!.deletedAt).not.toBeNull();
  });

  it('opens a bundle written before entry lists existed', () => {
    const { bundle } = aBundle();
    // Destructured away rather than deleted: the field is readonly, and the
    // case being tested is a file that never had the key, not one whose key
    // was removed.
    const { entries: _absent, ...old } = bundle;

    const plan = planImport(old as EventBundle, EMPTY, 'copy');
    expect(plan.entries).toEqual([]);
  });

  it('names them in the summary, and only when there are some', () => {
    const { bundle } = withEntries();
    expect(describeImport(planImport(bundle, EMPTY, 'copy'))).toBe(
      '2 spots, 1 session, 2 planned stops, 2 entries.',
    );
    expect(describeImport(planImport(aBundle().bundle, EMPTY, 'copy'))).toBe(
      '2 spots, 1 session, 2 planned stops.',
    );
  });
});

/**
 * The equipment checklist through an import — the same reference-rewriting
 * problem as entries just above, and handled identically for the same
 * reason: an item belongs to exactly one event.
 */
describe('equipment', () => {
  const anItem = (eventId: EventId, name: string, packed = false): EquipmentItem => ({
    ...newEquipmentItem({ eventId, name }),
    packed,
    packedAt: packed ? nowUtc() : null,
  });

  function withEquipment(packed = false) {
    const { bundle, event } = aBundle();
    return {
      event,
      bundle: {
        ...bundle,
        equipment: [
          anItem(event.id, 'R5 body', packed),
          anItem(event.id, '24-70 f/2.8'),
        ],
      } satisfies EventBundle,
    };
  }

  it('restores them as themselves', () => {
    const { bundle } = withEquipment();
    const plan = planImport(bundle, EMPTY, 'restore');

    expect(plan.equipment.map((i) => i.id)).toEqual(
      bundle.equipment.map((i) => i.id),
    );
    expect(plan.equipment.map((i) => i.eventId)).toEqual([
      bundle.event.id,
      bundle.event.id,
    ]);
  });

  it('restores the packed state, which is most of the point of a backup', () => {
    const { bundle } = withEquipment(true);
    const plan = planImport(bundle, EMPTY, 'restore');

    expect(plan.equipment.find((i) => i.name === 'R5 body')!.packed).toBe(true);
  });

  it('remints every id on a copy', () => {
    const { bundle } = withEquipment();
    const plan = planImport(bundle, EMPTY, 'copy');
    const old = new Set(bundle.equipment.map((i) => i.id as string));

    expect(plan.equipment).toHaveLength(2);
    for (const item of plan.equipment) {
      expect(old.has(item.id as string)).toBe(false);
    }
  });

  it('points a copy at its own event, not the one it came from', () => {
    const { bundle } = withEquipment();
    const plan = planImport(bundle, EMPTY, 'copy');

    expect(plan.event.id).not.toBe(bundle.event.id);
    for (const item of plan.equipment) {
      expect(item.eventId).toBe(plan.event.id);
    }
  });

  it('carries the packed state on a copy and says so', () => {
    const { bundle } = withEquipment(true);
    const plan = planImport(bundle, EMPTY, 'copy');

    expect(plan.equipment.find((i) => i.name === 'R5 body')!.packed).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/already marked as packed/i);
  });

  it('does not warn about packed items when there are none', () => {
    const { bundle } = withEquipment(false);
    expect(planImport(bundle, EMPTY, 'copy').warnings).toEqual([]);
  });

  it('carries no tombstone onto a copy', () => {
    const { bundle, event } = withEquipment();
    const deleted: EventBundle = {
      ...bundle,
      equipment: [{ ...anItem(event.id, 'spare cards'), deletedAt: nowUtc() }],
    };

    expect(planImport(deleted, EMPTY, 'copy').equipment[0]!.deletedAt).toBeNull();
  });

  it('keeps a tombstone on a restore', () => {
    const { bundle, event } = withEquipment();
    const deleted: EventBundle = {
      ...bundle,
      equipment: [{ ...anItem(event.id, 'spare cards'), deletedAt: nowUtc() }],
    };

    expect(
      planImport(deleted, EMPTY, 'restore').equipment[0]!.deletedAt,
    ).not.toBeNull();
  });

  it('opens a bundle written before the checklist existed', () => {
    const { bundle } = aBundle();
    const { equipment: _absent, ...old } = bundle;

    const plan = planImport(old as EventBundle, EMPTY, 'copy');
    expect(plan.equipment).toEqual([]);
  });

  it('names it in the summary, and only when there is some', () => {
    const { bundle } = withEquipment();
    expect(describeImport(planImport(bundle, EMPTY, 'copy'))).toBe(
      '2 spots, 1 session, 2 planned stops, 2 equipment items.',
    );
    expect(describeImport(planImport(aBundle().bundle, EMPTY, 'copy'))).toBe(
      '2 spots, 1 session, 2 planned stops.',
    );
  });
});
