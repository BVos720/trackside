import { describe, expect, it } from 'vitest';

import {
  AccessClassification,
  DEFAULT_SPOT_USES,
  SpotUse,
  newSpot,
  normaliseUses,
  type Spot,
} from '../domain/spot';
import { asId, type CircuitId, type UserId } from '../domain/ids';
import { countByUse, spotServes, spotsForUse, toggleUse } from './spotUse';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

const aSpot = (name: string, uses?: readonly SpotUse[]): Spot =>
  newSpot({
    circuitId: CIRCUIT,
    name,
    position: { latitude: 50.35, longitude: 6.95, elevation: null },
    createdBy: USER,
    accessClassification: AccessClassification.PublicLand,
    uses,
  });

describe('normaliseUses', () => {
  it('treats a spot that does not say as a camera position', () => {
    // Everything saved before this field existed was one.
    expect(normaliseUses(undefined)).toEqual([...DEFAULT_SPOT_USES]);
    expect(normaliseUses([])).toEqual([SpotUse.Photography]);
  });

  it('never returns an empty set', () => {
    // A spot for nothing matches no mode and vanishes off the map with
    // nothing left to tap.
    expect(normaliseUses([])).not.toHaveLength(0);
    expect(normaliseUses(['nonsense'])).not.toHaveLength(0);
  });

  it('drops values it does not recognise', () => {
    // From a future build or a hand-edited bundle. Carrying them through would
    // let a spot match a mode this build cannot name.
    expect(normaliseUses(['photography', 'filming'])).toEqual([
      SpotUse.Photography,
    ]);
  });

  it('de-duplicates', () => {
    expect(normaliseUses(['spectating', 'spectating'])).toEqual([
      SpotUse.Spectating,
    ]);
  });

  it('keeps both when both are set', () => {
    expect(normaliseUses(['photography', 'spectating'])).toEqual([
      SpotUse.Photography,
      SpotUse.Spectating,
    ]);
  });
});

describe('newSpot', () => {
  it('defaults to photography', () => {
    expect(aSpot('Brünnchen').uses).toEqual([SpotUse.Photography]);
  });

  it('refuses to store an empty set the caller passed', () => {
    expect(aSpot('Brünnchen', []).uses).toEqual([SpotUse.Photography]);
  });

  it('stores both when asked', () => {
    const spot = aSpot('Grandstand', [SpotUse.Photography, SpotUse.Spectating]);
    expect(spot.uses).toHaveLength(2);
  });
});

describe('spotsForUse', () => {
  const photo = aSpot('Fence gap', [SpotUse.Photography]);
  const watch = aSpot('Grandstand', [SpotUse.Spectating]);
  const both = aSpot('Bank at Eau Rouge', [
    SpotUse.Photography,
    SpotUse.Spectating,
  ]);
  const all = [photo, watch, both];

  it('shows camera positions in photography mode', () => {
    expect(spotsForUse(all, SpotUse.Photography).map((s) => s.name)).toEqual([
      'Fence gap',
      'Bank at Eau Rouge',
    ]);
  });

  it('shows watching positions in spectating mode', () => {
    expect(spotsForUse(all, SpotUse.Spectating).map((s) => s.name)).toEqual([
      'Grandstand',
      'Bank at Eau Rouge',
    ]);
  });

  it('shows a dual-purpose spot in both', () => {
    expect(spotServes(both, SpotUse.Photography)).toBe(true);
    expect(spotServes(both, SpotUse.Spectating)).toBe(true);
  });

  it('reads a legacy row as a camera position', () => {
    // The shape a row written before this field takes when it comes back.
    const legacy = { ...photo, uses: undefined } as unknown as Spot;

    expect(spotServes(legacy, SpotUse.Photography)).toBe(true);
    expect(spotServes(legacy, SpotUse.Spectating)).toBe(false);
    expect(spotsForUse([legacy], SpotUse.Photography)).toHaveLength(1);
  });

  it('never loses a spot from both modes at once', () => {
    // Whatever is stored, every spot has to appear somewhere.
    const damaged = { ...photo, uses: [] } as unknown as Spot;
    const shown =
      spotsForUse([damaged], SpotUse.Photography).length +
      spotsForUse([damaged], SpotUse.Spectating).length;

    expect(shown).toBeGreaterThan(0);
  });
});

describe('countByUse', () => {
  it('counts a dual-purpose spot under both', () => {
    const counts = countByUse([
      aSpot('a', [SpotUse.Photography]),
      aSpot('b', [SpotUse.Spectating]),
      aSpot('c', [SpotUse.Photography, SpotUse.Spectating]),
    ]);

    expect(counts[SpotUse.Photography]).toBe(2);
    expect(counts[SpotUse.Spectating]).toBe(2);
  });

  it('reports zero rather than omitting a mode with nothing in it', () => {
    // The switch has to be able to say "0 spectating", which is what stops an
    // empty map reading as a broken one.
    const counts = countByUse([aSpot('a', [SpotUse.Photography])]);
    expect(counts[SpotUse.Spectating]).toBe(0);
  });

  it('handles no spots at all', () => {
    const counts = countByUse([]);
    expect(counts[SpotUse.Photography]).toBe(0);
    expect(counts[SpotUse.Spectating]).toBe(0);
  });
});

describe('toggleUse', () => {
  it('adds a use', () => {
    expect(toggleUse([SpotUse.Photography], SpotUse.Spectating, true)).toEqual([
      SpotUse.Photography,
      SpotUse.Spectating,
    ]);
  });

  it('removes a use when another remains', () => {
    expect(
      toggleUse(
        [SpotUse.Photography, SpotUse.Spectating],
        SpotUse.Photography,
        false,
      ),
    ).toEqual([SpotUse.Spectating]);
  });

  it('refuses to untick the last one', () => {
    // Otherwise one tap in the editor makes the spot disappear off every
    // screen, with nothing left to tap to bring it back.
    expect(toggleUse([SpotUse.Photography], SpotUse.Photography, false)).toEqual(
      [SpotUse.Photography],
    );
  });

  it('is idempotent', () => {
    const once = toggleUse([SpotUse.Photography], SpotUse.Spectating, true);
    const twice = toggleUse(once, SpotUse.Spectating, true);
    expect(twice).toEqual(once);
  });
});
