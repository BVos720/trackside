import { describe, expect, it } from 'vitest';

import { asUtc } from '../domain/common';
import { asId, newId, type EventId } from '../domain/ids';
import { newEvent, type Event } from '../domain/event';
import { newEquipmentItem, setPacked, type EquipmentItem } from '../domain/equipment';
import {
  SUGGESTED_EQUIPMENT_CATEGORIES,
  buildChecklistForNewEvent,
  checklistForEvent,
  mostRecentPreviousEvent,
  newChecklist,
  packedCount,
  seedChecklistFromPrevious,
} from './equipment';

const CIRCUIT = asId<never>('01920000-0000-7000-8000-000000000001') as never;
const USER = asId<never>('01920000-0000-7000-8000-0000000000ff') as never;

function anEvent(
  name: string,
  overrides: Partial<Pick<Event, 'startDate' | 'endDate' | 'createdAt' | 'deletedAt'>> = {},
): Event {
  const base = newEvent({ circuitId: CIRCUIT, name, createdBy: USER });
  return { ...base, ...overrides };
}

function anItem(
  eventId: EventId,
  name: string,
  overrides: Partial<Pick<EquipmentItem, 'category' | 'packed' | 'sortOrder' | 'deletedAt'>> = {},
): EquipmentItem {
  const item = newEquipmentItem({ eventId, name, category: overrides.category, sortOrder: overrides.sortOrder });
  return {
    ...item,
    packed: overrides.packed ?? item.packed,
    deletedAt: overrides.deletedAt ?? item.deletedAt,
  };
}

describe('newChecklist', () => {
  it('builds items in the given order, stamping sortOrder', () => {
    const eventId = newId<EventId>();
    const items = newChecklist(eventId, [
      { name: 'R5 body', category: 'Bodies' },
      { name: '24-70 f/2.8', category: 'Lenses' },
      { name: 'Ear defenders', category: 'Ear protection' },
    ]);

    expect(items.map((i) => i.name)).toEqual(['R5 body', '24-70 f/2.8', 'Ear defenders']);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(items.every((i) => i.eventId === eventId)).toBe(true);
  });

  it('starts every item unpacked', () => {
    const eventId = newId<EventId>();
    const [item] = newChecklist(eventId, [{ name: 'R5 body' }]);
    expect(item!.packed).toBe(false);
    expect(item!.packedAt).toBeNull();
  });

  it('defaults to an empty checklist', () => {
    expect(newChecklist(newId<EventId>())).toEqual([]);
  });

  it('leaves category null when not given', () => {
    const [item] = newChecklist(newId<EventId>(), [{ name: 'Rain cover' }]);
    expect(item!.category).toBeNull();
  });
});

describe('checklistForEvent', () => {
  it("returns only one event's items", () => {
    const a = newId<EventId>();
    const b = newId<EventId>();
    const all = [...newChecklist(a, [{ name: 'A1' }]), ...newChecklist(b, [{ name: 'B1' }, { name: 'B2' }])];

    expect(checklistForEvent(all, b).map((i) => i.name)).toEqual(['B1', 'B2']);
  });

  it('is empty for an event with no items', () => {
    expect(checklistForEvent([], newId<EventId>())).toEqual([]);
  });
});

describe('mostRecentPreviousEvent', () => {
  it('picks the closest dated event strictly before the new one', () => {
    const early = anEvent('Spa Six Hours', { startDate: '2026-05-01', endDate: '2026-05-03' });
    const mid = anEvent('NLS6', { startDate: '2026-07-01', endDate: '2026-07-02' });
    const target = anEvent('NLS7', { startDate: '2026-08-20', endDate: '2026-08-21' });

    const found = mostRecentPreviousEvent([early, mid, target], target);
    expect(found?.id).toBe(mid.id);
  });

  it('never returns the event itself', () => {
    const only = anEvent('Only event', { startDate: '2026-08-20' });
    expect(mostRecentPreviousEvent([only], only)).toBeNull();
  });

  it('ignores events on or after the target date', () => {
    const target = anEvent('NLS7', { startDate: '2026-08-20' });
    const later = anEvent('Later round', { startDate: '2026-09-01' });
    const sameDay = anEvent('Same-day duplicate', { startDate: '2026-08-20' });

    expect(mostRecentPreviousEvent([later, sameDay], target)).toBeNull();
  });

  it('excludes tombstoned events', () => {
    const target = anEvent('NLS7', { startDate: '2026-08-20' });
    const deleted = anEvent('Deleted round', {
      startDate: '2026-07-01',
      deletedAt: asUtc('2026-07-05T00:00:00.000Z'),
    });

    expect(mostRecentPreviousEvent([deleted], target)).toBeNull();
  });

  it('falls back to createdAt for events with no dates, oldest wins ties correctly', () => {
    const earlier = { ...anEvent('Undated A'), createdAt: asUtc('2026-01-01T00:00:00.000Z') };
    const later = { ...anEvent('Undated B'), createdAt: asUtc('2026-06-01T00:00:00.000Z') };
    const target = { ...anEvent('Target'), createdAt: asUtc('2026-08-01T00:00:00.000Z') };

    const found = mostRecentPreviousEvent([earlier, later], target);
    expect(found?.id).toBe(later.id);
  });

  it('returns null with no candidates', () => {
    expect(mostRecentPreviousEvent([], anEvent('Only'))).toBeNull();
  });
});

describe('seedChecklistFromPrevious', () => {
  const previousEventId = newId<EventId>();
  const newEventId = newId<EventId>();

  it('carries names and categories over', () => {
    const previous = [
      anItem(previousEventId, 'R5 body', { category: 'Bodies', packed: true }),
      anItem(previousEventId, '24-70 f/2.8', { category: 'Lenses', packed: true }),
    ];
    const seeded = seedChecklistFromPrevious(previous, newEventId);

    expect(seeded.map((i) => [i.name, i.category])).toEqual([
      ['R5 body', 'Bodies'],
      ['24-70 f/2.8', 'Lenses'],
    ]);
  });

  it('resets every item to unpacked regardless of source state', () => {
    const previous = [anItem(previousEventId, 'R5 body', { packed: true })];
    const [seeded] = seedChecklistFromPrevious(previous, newEventId);

    expect(seeded!.packed).toBe(false);
    expect(seeded!.packedAt).toBeNull();
  });

  it('stamps the new event id and gives every item a fresh id', () => {
    const previous = [anItem(previousEventId, 'R5 body')];
    const [seeded] = seedChecklistFromPrevious(previous, newEventId);

    expect(seeded!.eventId).toBe(newEventId);
    expect(seeded!.id).not.toBe(previous[0]!.id);
  });

  it('marks copies as local and not deleted', () => {
    const previous = [anItem(previousEventId, 'R5 body')];
    const [seeded] = seedChecklistFromPrevious(previous, newEventId);

    expect(seeded!.syncState).toBe('local');
    expect(seeded!.deletedAt).toBeNull();
  });

  it('leaves the source items untouched', () => {
    const source = anItem(previousEventId, 'R5 body', { packed: true });
    const before = JSON.stringify(source);
    seedChecklistFromPrevious([source], newEventId);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('drops tombstoned source items rather than resurrecting them', () => {
    const previous = [
      anItem(previousEventId, 'Old body', { deletedAt: asUtc('2026-01-01T00:00:00.000Z') }),
      anItem(previousEventId, 'R5 body'),
    ];
    const seeded = seedChecklistFromPrevious(previous, newEventId);
    expect(seeded.map((i) => i.name)).toEqual(['R5 body']);
  });

  it('handles an empty previous checklist', () => {
    expect(seedChecklistFromPrevious([], newEventId)).toEqual([]);
  });
});

describe('buildChecklistForNewEvent', () => {
  it('seeds from the most recent previous event when one exists', () => {
    const previousEvent = anEvent('NLS6', { startDate: '2026-07-01' });
    const targetEvent = anEvent('NLS7', { startDate: '2026-08-20' });
    const items = [anItem(previousEvent.id, 'R5 body', { category: 'Bodies', packed: true })];

    const built = buildChecklistForNewEvent([previousEvent], items, targetEvent, targetEvent.id);

    expect(built.map((i) => [i.name, i.category, i.packed])).toEqual([['R5 body', 'Bodies', false]]);
    expect(built.every((i) => i.eventId === targetEvent.id)).toBe(true);
  });

  it('falls back to an empty checklist with no previous event', () => {
    const targetEvent = anEvent('First ever event', { startDate: '2026-08-20' });
    expect(buildChecklistForNewEvent([], [], targetEvent, targetEvent.id)).toEqual([]);
  });

  it('falls back to an empty checklist when the previous event has no items', () => {
    const previousEvent = anEvent('NLS6', { startDate: '2026-07-01' });
    const targetEvent = anEvent('NLS7', { startDate: '2026-08-20' });

    expect(buildChecklistForNewEvent([previousEvent], [], targetEvent, targetEvent.id)).toEqual([]);
  });
});

describe('packing state and summary (re-exported from the domain)', () => {
  it('toggles packed and stamps packedAt', () => {
    const item = newEquipmentItem({ eventId: newId<EventId>(), name: 'R5 body' });
    const packed = setPacked(item, true, asUtc('2026-08-20T09:00:00.000Z'));
    expect(packed.packed).toBe(true);
    expect(packed.packedAt).toBe('2026-08-20T09:00:00.000Z');

    const unpacked = setPacked(packed, false);
    expect(unpacked.packed).toBe(false);
    expect(unpacked.packedAt).toBeNull();
  });

  it('counts packed and total across live items only', () => {
    const eventId = newId<EventId>();
    const items = [
      anItem(eventId, 'A', { packed: true }),
      anItem(eventId, 'B', { packed: false }),
      anItem(eventId, 'C', {
        packed: true,
        deletedAt: asUtc('2026-01-01T00:00:00.000Z'),
      }),
    ];

    expect(packedCount(items)).toEqual({ packed: 1, total: 2 });
  });
});

describe('SUGGESTED_EQUIPMENT_CATEGORIES', () => {
  it('covers the weekend-kit categories the feature was built around', () => {
    expect(SUGGESTED_EQUIPMENT_CATEGORIES).toEqual(
      expect.arrayContaining(['Bodies', 'Lenses', 'Batteries', 'Cards', 'Wet gear', 'Ear protection']),
    );
  });
});
