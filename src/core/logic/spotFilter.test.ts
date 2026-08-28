import { describe, expect, it } from 'vitest';

import type { Utc } from '../domain/common';
import { asId, newId, type SpotGroupId } from '../domain/ids';
import { AccessClassification, newSpot, type Spot } from '../domain/spot';
import { arrangeWaypoints, filterWaypoints, sortWaypoints, NO_FILTER } from './spotFilter';
import { groupSpots } from './spotGroups';

const CIRCUIT = asId<never>('01920000-0000-7000-8000-000000000001') as never;

function aSpot(name: string, overrides: Partial<Spot> = {}): Spot {
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
const names = (ws: { primary: Spot }[]) => ws.map((w) => w.primary.name);

describe('filterWaypoints', () => {
  it('finds a name whatever the case', () => {
    const w = groupSpots([aSpot('Brünnchen'), aSpot('Pflanzgarten')]);
    expect(names(filterWaypoints(w, { ...NO_FILTER, query: 'brünn' }))).toEqual([
      'Brünnchen',
    ]);
  });

  it('finds an accented name typed without the accent', () => {
    // Nobody reaches for the umlaut on a phone at a track.
    const w = groupSpots([aSpot('Brünnchen')]);
    expect(filterWaypoints(w, { ...NO_FILTER, query: 'brunnchen' })).toHaveLength(1);
  });

  it('matches on any way of shooting, not just the waypoint name', () => {
    // Ways get named for what they are; a search that only read the primary
    // would hide the one you were looking for.
    const g = newId<SpotGroupId>();
    const w = groupSpots([
      aSpot('Brünnchen', { groupId: g, createdAt: at('2026-08-01T00:00:00Z') }),
      aSpot('long lens from the bank', { groupId: g, createdAt: at('2026-08-02T00:00:00Z') }),
    ]);
    expect(filterWaypoints(w, { ...NO_FILTER, query: 'long lens' })).toHaveLength(1);
  });

  it('excludes unrated waypoints from a minimum rating', () => {
    // "3 and up" is a question about quality. Letting unrated pass would fill
    // the answer with exactly the spots not yet judged.
    const w = groupSpots([aSpot('rated', { rating: 4 }), aSpot('unrated')]);
    expect(names(filterWaypoints(w, { ...NO_FILTER, minRating: 3 }))).toEqual(['rated']);
  });

  it('keeps a waypoint whose best way clears the bar', () => {
    const g = newId<SpotGroupId>();
    const w = groupSpots([
      aSpot('poor way', { groupId: g, rating: 1, createdAt: at('2026-08-01T00:00:00Z') }),
      aSpot('good way', { groupId: g, rating: 5, createdAt: at('2026-08-02T00:00:00Z') }),
    ]);
    expect(filterWaypoints(w, { ...NO_FILTER, minRating: 4 })).toHaveLength(1);
  });

  it('hides hidden waypoints unless asked', () => {
    const w = groupSpots([aSpot('shown'), aSpot('tucked away', { isHidden: true })]);
    expect(names(filterWaypoints(w, NO_FILTER))).toEqual(['shown']);
    expect(filterWaypoints(w, { ...NO_FILTER, includeHidden: true })).toHaveLength(2);
  });

  it('treats a waypoint as hidden only when every way is', () => {
    // Hiding one way of shooting a corner is not a decision about the corner.
    const g = newId<SpotGroupId>();
    const w = groupSpots([
      aSpot('visible way', { groupId: g, createdAt: at('2026-08-01T00:00:00Z') }),
      aSpot('hidden way', { groupId: g, isHidden: true, createdAt: at('2026-08-02T00:00:00Z') }),
    ]);
    expect(filterWaypoints(w, NO_FILTER)).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    const w = groupSpots([aSpot('a'), aSpot('b')]);
    expect(filterWaypoints(w, { ...NO_FILTER, query: '   ' })).toHaveLength(2);
  });
});

describe('sortWaypoints', () => {
  const older = aSpot('Zulu', { createdAt: at('2026-08-01T00:00:00Z'), rating: 2 });
  const newer = aSpot('alpha', { createdAt: at('2026-08-03T00:00:00Z'), rating: 5 });
  const middle = aSpot('Mike', { createdAt: at('2026-08-02T00:00:00Z') });
  const all = groupSpots([older, newer, middle]);

  it('sorts newest first for recent', () => {
    expect(names(sortWaypoints(all, 'recent'))).toEqual(['alpha', 'Mike', 'Zulu']);
  });

  it('sorts oldest first', () => {
    expect(names(sortWaypoints(all, 'oldest'))).toEqual(['Zulu', 'Mike', 'alpha']);
  });

  it('sorts by name ignoring case', () => {
    // Case-sensitive sorting puts every lowercase name after every uppercase
    // one, which reads as broken.
    expect(names(sortWaypoints(all, 'name'))).toEqual(['alpha', 'Mike', 'Zulu']);
  });

  it('sorts best rated first and puts unrated last', () => {
    // Unrated is an absence of judgement, not a bad one: burying it under the
    // one-star spots would be a claim nobody made.
    expect(names(sortWaypoints(all, 'rating'))).toEqual(['alpha', 'Zulu', 'Mike']);
  });

  it('does not mutate its input', () => {
    const before = names(all);
    sortWaypoints(all, 'name');
    expect(names(all)).toEqual(before);
  });

  it('is stable for equal keys', () => {
    // A list that reshuffles equal items under your thumb is worse than one
    // sorted the way you did not want.
    const a = aSpot('same', { createdAt: at('2026-08-01T00:00:00Z') });
    const b = aSpot('same', { createdAt: at('2026-08-02T00:00:00Z') });
    const w = groupSpots([a, b]);
    expect(names(sortWaypoints(w, 'name'))).toEqual(names(sortWaypoints(w, 'name')));
  });
});

describe('arrangeWaypoints', () => {
  it('filters then sorts', () => {
    const w = groupSpots([
      aSpot('keep me', { createdAt: at('2026-08-01T00:00:00Z'), rating: 5 }),
      aSpot('keep me too', { createdAt: at('2026-08-02T00:00:00Z'), rating: 3 }),
      aSpot('drop me', { createdAt: at('2026-08-03T00:00:00Z') }),
    ]);
    expect(names(arrangeWaypoints(w, { ...NO_FILTER, minRating: 3 }, 'rating'))).toEqual([
      'keep me',
      'keep me too',
    ]);
  });
});
