import { describe, expect, it } from 'vitest';

import { asId, newId, type SpotGroupId } from '../domain/ids';
import { AccessClassification, newSpot, type Spot } from '../domain/spot';
import { groupSpots, waypointOf, waypointRating } from './spotGroups';
import type { Utc } from '../domain/common';

const CIRCUIT = asId<never>('01920000-0000-7000-8000-000000000001') as never;

function aSpot(
  name: string,
  overrides: Partial<Spot> = {},
): Spot {
  return {
    ...newSpot({
      circuitId: CIRCUIT,
      name,
      position: { latitude: 50.35, longitude: 6.95, elevation: null },
      createdBy: asId('01920000-0000-7000-8000-0000000000ff'),
      accessClassification: AccessClassification.PublicLand,
    }),
    ...overrides,
  };
}

const at = (iso: string) => iso as Utc;

describe('groupSpots', () => {
  it('makes a waypoint of one for an ungrouped spot', () => {
    // The map should not have to handle "grouped" and "loose" as two shapes.
    const [w] = groupSpots([aSpot('Brünnchen')]);
    expect(w!.groupId).toBeNull();
    expect(w!.members).toHaveLength(1);
    expect(w!.primary.name).toBe('Brünnchen');
  });

  it('gathers spots sharing a group into one waypoint', () => {
    const g = newId<SpotGroupId>();
    const waypoints = groupSpots([
      aSpot('long lens', { groupId: g }),
      aSpot('wide', { groupId: g }),
      aSpot('somewhere else'),
    ]);

    expect(waypoints).toHaveLength(2);
    const grouped = waypoints.find((w) => w.groupId === g);
    expect(grouped!.members).toHaveLength(2);
  });

  it('names the waypoint after its oldest member, not the first in the array', () => {
    // Input order is whatever the store returned. A waypoint that renames
    // itself when a list is re-sorted is a bug that only shows up in the field.
    const g = newId<SpotGroupId>();
    const waypoints = groupSpots([
      aSpot('added later', { groupId: g, createdAt: at('2026-08-02T00:00:00Z') }),
      aSpot('found first', { groupId: g, createdAt: at('2026-08-01T00:00:00Z') }),
    ]);

    expect(waypoints[0]!.primary.name).toBe('found first');
  });

  it('orders members oldest first', () => {
    const g = newId<SpotGroupId>();
    const [w] = groupSpots([
      aSpot('third', { groupId: g, createdAt: at('2026-08-03T00:00:00Z') }),
      aSpot('first', { groupId: g, createdAt: at('2026-08-01T00:00:00Z') }),
      aSpot('second', { groupId: g, createdAt: at('2026-08-02T00:00:00Z') }),
    ]);

    expect(w!.members.map((m) => m.name)).toEqual(['first', 'second', 'third']);
  });

  it('keeps the group when only one member is left', () => {
    // Deleting the others must not silently dissolve the waypoint: adding to
    // it again should re-form the same group rather than mint a new one.
    const g = newId<SpotGroupId>();
    const [w] = groupSpots([aSpot('last one standing', { groupId: g })]);
    expect(w!.groupId).toBe(g);
  });

  it('keeps separate groups separate', () => {
    const a = newId<SpotGroupId>();
    const b = newId<SpotGroupId>();
    const waypoints = groupSpots([
      aSpot('a1', { groupId: a }),
      aSpot('b1', { groupId: b }),
      aSpot('a2', { groupId: a }),
    ]);
    expect(waypoints).toHaveLength(2);
    expect(waypoints.find((w) => w.groupId === a)!.members).toHaveLength(2);
    expect(waypoints.find((w) => w.groupId === b)!.members).toHaveLength(1);
  });

  it('is stable when two members share a timestamp', () => {
    // Duplicating a waypoint can produce this, and the map and the list must
    // not disagree about which one is primary.
    const g = newId<SpotGroupId>();
    const same = at('2026-08-01T00:00:00Z');
    const spots = [
      aSpot('x', { groupId: g, createdAt: same }),
      aSpot('y', { groupId: g, createdAt: same }),
    ];
    const first = groupSpots(spots)[0]!.primary.id;
    const second = groupSpots([...spots].reverse())[0]!.primary.id;
    expect(first).toBe(second);
  });

  it('returns nothing for no spots', () => {
    expect(groupSpots([])).toEqual([]);
  });
});

describe('waypointOf', () => {
  it('finds what else is at the place you tapped', () => {
    const g = newId<SpotGroupId>();
    const tapped = aSpot('wide', { groupId: g });
    const w = waypointOf([tapped, aSpot('long', { groupId: g }), aSpot('far away')], tapped.id);
    expect(w!.members).toHaveLength(2);
  });

  it('returns a waypoint of one for an ungrouped spot', () => {
    const only = aSpot('alone');
    const w = waypointOf([only], only.id);
    expect(w!.groupId).toBeNull();
    expect(w!.members).toHaveLength(1);
  });

  it('returns null when the spot is not there', () => {
    expect(waypointOf([aSpot('a')], newId())).toBeNull();
  });
});

describe('waypointRating', () => {
  it('takes the best rating, not the average', () => {
    // A waypoint is worth visiting for its best photograph. Averaging would
    // punish recording a way of shooting that turned out badly, which is the
    // note most worth keeping.
    const g = newId<SpotGroupId>();
    const [w] = groupSpots([
      aSpot('poor', { groupId: g, rating: 1 }),
      aSpot('excellent', { groupId: g, rating: 5 }),
    ]);
    expect(waypointRating(w!)).toBe(5);
  });

  it('ignores unrated members rather than counting them as zero', () => {
    const g = newId<SpotGroupId>();
    const [w] = groupSpots([
      aSpot('rated', { groupId: g, rating: 4 }),
      aSpot('never rated', { groupId: g, rating: null }),
    ]);
    expect(waypointRating(w!)).toBe(4);
  });

  it('is null when nothing in the waypoint is rated', () => {
    // Not zero: "not rated" must not filter or sort as "bad".
    const [w] = groupSpots([aSpot('unrated')]);
    expect(waypointRating(w!)).toBeNull();
  });
});
