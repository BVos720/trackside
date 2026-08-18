import { describe, expect, it } from 'vitest';

import { asId, newId, type EventId, type SpotId } from '../domain/ids';
import { AccessClassification, newSpot, type Spot } from '../domain/spot';
import { cloneSpotsForEvent, spotsForContext } from './cloneSpots';

const CIRCUIT = asId<never>('01920000-0000-7000-8000-000000000001') as never;

function aSpot(name: string, eventId: EventId | null = null): Spot {
  return {
    ...newSpot({
      circuitId: CIRCUIT,
      name,
      position: { latitude: 50.35, longitude: 6.95, elevation: null },
      createdBy: asId('01920000-0000-7000-8000-0000000000ff'),
      accessClassification: AccessClassification.PublicLand,
    }),
    eventId,
  };
}

describe('cloneSpotsForEvent', () => {
  const event = newId<EventId>();

  it('gives every copy a new id', () => {
    // Reusing the source id would make the copy indistinguishable from its
    // original on sync (§0.1).
    const source = [aSpot('Brünnchen'), aSpot('Pflanzgarten')];
    const copies = cloneSpotsForEvent(source, event);

    const sourceIds = new Set<string>(source.map((s) => s.id));
    for (const c of copies) expect(sourceIds.has(c.id)).toBe(false);
    expect(new Set(copies.map((c) => c.id)).size).toBe(2);
  });

  it('stamps the owning event on every copy', () => {
    const copies = cloneSpotsForEvent([aSpot('Adenauer Forst')], event);
    expect(copies[0]!.eventId).toBe(event);
  });

  it('leaves the originals untouched', () => {
    // The whole point: an event must not be able to damage the home map.
    const original = aSpot('Karussell');
    const before = JSON.stringify(original);
    cloneSpotsForEvent([original], event);
    expect(JSON.stringify(original)).toBe(before);
    expect(original.eventId).toBeNull();
  });

  it('carries the details across', () => {
    const original = aSpot('Schwedenkreuz');
    const [copy] = cloneSpotsForEvent([original], event);
    expect(copy!.name).toBe(original.name);
    expect(copy!.position).toEqual(original.position);
    expect(copy!.accessClassification).toBe(original.accessClassification);
  });

  it('marks copies as local and not deleted', () => {
    const [copy] = cloneSpotsForEvent([aSpot('Fuchsröhre')], event);
    expect(copy!.syncState).toBe('local');
    expect(copy!.deletedAt).toBeNull();
  });

  it('handles an empty selection', () => {
    expect(cloneSpotsForEvent([], event)).toEqual([]);
  });
});

describe('spotsForContext', () => {
  const event = newId<EventId>();
  const other = newId<EventId>();

  const all = [
    aSpot('home one'),
    aSpot('home two'),
    aSpot('event copy', event),
    aSpot('other event copy', other),
  ];

  it('shows only the permanent collection on the default map', () => {
    const visible = spotsForContext(all, null);
    expect(visible.map((s) => s.name)).toEqual(['home one', 'home two']);
  });

  it("shows only an event's own copies", () => {
    // Without this the clones would appear beside their originals and double
    // every pin at the circuit.
    const visible = spotsForContext(all, event);
    expect(visible.map((s) => s.name)).toEqual(['event copy']);
  });

  it('does not leak one event into another', () => {
    expect(spotsForContext(all, other).map((s) => s.name)).toEqual([
      'other event copy',
    ]);
  });

  it('treats a missing eventId as the default map', () => {
    // Rows written before events existed have no field at all.
    const legacy = { ...aSpot('old'), eventId: undefined } as unknown as Spot;
    expect(spotsForContext([legacy], null)).toHaveLength(1);
  });
});
