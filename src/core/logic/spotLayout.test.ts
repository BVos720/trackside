import { describe, expect, it } from 'vitest';

import { Visibility } from '../domain/common';
import { AccessClassification, SpotUse, type Spot } from '../domain/spot';
import {
  LAYOUT_FORMAT,
  buildSpotLayout,
  describeRejection,
  inspectLayout,
  spotsFromLayout,
  toLayoutSpot,
  type SpotLayout,
} from './spotLayout';

const NOW = new Date('2026-08-26T12:00:00Z');

function spot(over: Partial<Spot> = {}): Spot {
  return {
    id: 'spot-1',
    circuitId: 'spa',
    eventId: null,
    nearestMarshalPostId: null,
    name: 'Eau Rouge, outside',
    position: { latitude: 50.437, longitude: 5.9686, elevationMetres: null },
    shootingBearing: 210,
    accessClassification: AccessClassification.Official,
    accessNotes: 'Ticketed grandstand, gate 3.',
    keyTimes: ['14:00'],
    tags: ['uphill'],
    shotSettings: [],
    uses: [SpotUse.Photography],
    isHidden: false,
    visibility: Visibility.Private,
    createdBy: 'user-a',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    syncState: 'local',
    ...over,
  } as unknown as Spot;
}

const layout = (over: Partial<SpotLayout> = {}): SpotLayout => ({
  format: LAYOUT_FORMAT,
  exportedAt: NOW.toISOString(),
  name: 'How I shoot Spa',
  circuitId: 'spa' as SpotLayout['circuitId'],
  spots: [toLayoutSpot(spot())],
  ...over,
});

describe('what a layout refuses to carry', () => {
  it('has no field for access classification at all', () => {
    const carried = toLayoutSpot(spot({ accessClassification: AccessClassification.Official }));
    expect('accessClassification' in carried).toBe(false);
  });

  it('imports every spot as Unknown, however the author had it', () => {
    // The whole safety argument. An author's `official` is a claim about one
    // weekend they were there; restating it to someone else would be the app
    // asserting a fact about a place nobody at this end has checked.
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.accessClassification).toBe(AccessClassification.Unknown);
  });

  it('keeps the access notes as text, because a human still wants them', () => {
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.accessNotes).toBe('Ticketed grandstand, gate 3.');
  });

  it('carries no photographs', () => {
    const carried = toLayoutSpot(spot());
    // Not a regex over the JSON: `uses` legitimately contains 'photography',
    // which a naive search for 'photo' would trip on. Name the fields.
    expect('shotSettings' in carried).toBe(false);
    expect('media' in carried).toBe(false);
    expect('storageKey' in carried).toBe(false);
  });

  it('carries no identity or ownership from the author', () => {
    const carried = toLayoutSpot(spot());
    for (const field of ['id', 'createdBy', 'createdAt', 'updatedAt', 'eventId', 'syncState']) {
      expect(field in carried).toBe(false);
    }
  });
});

describe('what an imported spot becomes', () => {
  it('is a new record owned by whoever imported it', () => {
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.id).toBe('new-1');
    expect(imported[0]?.createdBy).toBe('user-b');
  });

  it('is private, so it cannot be passed on without a decision', () => {
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.visibility).toBe(Visibility.Private);
  });

  it('belongs to no event — it lands on the home map', () => {
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.eventId).toBeNull();
  });

  it('mints a distinct id per spot', () => {
    let n = 0;
    const two = layout({ spots: [toLayoutSpot(spot()), toLayoutSpot(spot({ name: 'Raidillon' }))] });
    const imported = spotsFromLayout(two, () => `new-${++n}` as never, 'user-b' as never, NOW);
    expect(imported.map((s) => s.id)).toEqual(['new-1', 'new-2']);
  });

  it('preserves what the author actually chose to record', () => {
    const imported = spotsFromLayout(layout(), () => 'new-1' as never, 'user-b' as never, NOW);
    expect(imported[0]?.name).toBe('Eau Rouge, outside');
    expect(imported[0]?.shootingBearing).toBe(210);
    expect(imported[0]?.keyTimes).toEqual(['14:00']);
    expect(imported[0]?.tags).toEqual(['uphill']);
    expect(imported[0]?.uses).toEqual([SpotUse.Photography]);
  });
});

describe('building one', () => {
  it('drops spots belonging to another circuit rather than exporting them', () => {
    const built = buildSpotLayout({
      name: 'Spa',
      circuitId: 'spa' as never,
      spots: [spot(), spot({ id: 'spot-2' as never, circuitId: 'nordschleife' as never })],
      now: NOW,
    });
    expect(built.spots).toHaveLength(1);
  });

  it('drops tombstoned spots', () => {
    const built = buildSpotLayout({
      name: 'Spa',
      circuitId: 'spa' as never,
      spots: [spot(), spot({ id: 'spot-2' as never, deletedAt: '2026-02-01T00:00:00Z' as never })],
      now: NOW,
    });
    expect(built.spots).toHaveLength(1);
  });

  it('trims the name', () => {
    const built = buildSpotLayout({
      name: '  Spa, wet  ',
      circuitId: 'spa' as never,
      spots: [spot()],
      now: NOW,
    });
    expect(built.name).toBe('Spa, wet');
  });
});

describe('inspecting a file before writing anything', () => {
  it('accepts a good layout for the right circuit', () => {
    expect(inspectLayout(layout(), 'spa' as never)).toBeNull();
  });

  it('refuses a layout for another circuit', () => {
    // The dangerous case: these positions are hundreds of kilometres away, and
    // there is no translation that would make them mean anything here.
    expect(inspectLayout(layout(), 'nordschleife' as never)).toBe('wrong-circuit');
  });

  it('refuses a newer format rather than guessing at it', () => {
    expect(
      inspectLayout({ ...layout(), format: 'trackside.layout.v2' }, 'spa' as never),
    ).toBe('unsupported-version');
  });

  it('refuses something that is not a layout', () => {
    expect(inspectLayout(null, 'spa' as never)).toBe('not-a-layout');
    expect(inspectLayout(42, 'spa' as never)).toBe('not-a-layout');
    expect(inspectLayout({}, 'spa' as never)).toBe('not-a-layout');
    expect(inspectLayout({ format: 'trackside.event.v1' }, 'spa' as never)).toBe('not-a-layout');
  });

  it('refuses an empty one', () => {
    expect(inspectLayout(layout({ spots: [] }), 'spa' as never)).toBe('empty');
  });

  it('checks the circuit before the contents, so the message is the useful one', () => {
    // A Nürburgring layout opened at Spa should say so, not "it is empty".
    const wrong = layout({ circuitId: 'nordschleife' as never, spots: [] });
    expect(inspectLayout(wrong, 'spa' as never)).toBe('wrong-circuit');
  });
});

describe('describeRejection', () => {
  it('names the circuit the user is actually looking at', () => {
    expect(describeRejection('wrong-circuit', 'Spa-Francorchamps')).toContain(
      'Spa-Francorchamps',
    );
  });

  it('is a sentence for every case', () => {
    for (const r of ['not-a-layout', 'unsupported-version', 'wrong-circuit', 'empty'] as const) {
      const s = describeRejection(r, 'Spa');
      expect(s.length).toBeGreaterThan(10);
      expect(s.endsWith('.')).toBe(true);
    }
  });
});
