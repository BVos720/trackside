import { describe, expect, it } from 'vitest';

import { nowUtc } from '../domain/common';
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
