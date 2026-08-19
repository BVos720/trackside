/**
 * Round-trip a bundle the running app actually wrote.
 *
 * `bundle-from-device.json` was pulled off the Android emulator with adb — it
 * is the auto-saved backup of a real event, not something typed out to make a
 * test pass. Hand-built fixtures contain only what their author thought to put
 * in them and agree with the author's idea of the format by construction; a
 * capture disagrees freely, which is the whole reason to keep one.
 *
 * If the format changes, re-capture this file rather than editing it. An edited
 * capture is just a fixture again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readEventBundle } from './eventBundle';
import { inspectBundle, planImport } from './importBundle';

const text = readFileSync(`${__dirname}/bundle-from-device.json`, 'utf8');

describe('a bundle written by the running app', () => {
  const { bundle, error } = readEventBundle(text);

  it('parses', () => {
    expect(error).toBeNull();
    expect(bundle).not.toBeNull();
    expect(bundle!.event.name).toBe('4 uur van spa');
  });

  it('restores with its ids and plan intact', () => {
    const plan = planImport(bundle!, { events: [], spots: [] }, 'restore');

    expect(plan.event.id).toBe(bundle!.event.id);
    expect(plan.event.stops).toHaveLength(bundle!.event.stops.length);
    expect(plan.spots.map((s) => s.id)).toEqual(bundle!.spots.map((s) => s.id));
    expect(plan.warnings).toEqual([]);
  });

  it('copies with every reference rewritten and nothing dangling', () => {
    const plan = planImport(bundle!, { events: [], spots: [] }, 'copy');
    const newSpotIds = new Set(plan.spots.map((s) => s.id as string));

    expect(plan.event.id).not.toBe(bundle!.event.id);
    expect(plan.event.stops).toHaveLength(bundle!.event.stops.length);

    for (const stop of plan.event.stops) {
      expect(newSpotIds.has(stop.spotId as string)).toBe(true);
    }
    for (const id of plan.event.spotIds) {
      expect(newSpotIds.has(id as string)).toBe(true);
    }
    for (const spot of plan.spots) {
      expect(spot.eventId).toBe(plan.event.id);
    }
    expect(plan.warnings).toEqual([]);
  });

  it('sees itself as a live conflict when it is already installed', () => {
    const local = { events: [bundle!.event], spots: [...bundle!.spots] };
    expect(inspectBundle(bundle!, local).kind).toBe('live');
  });

  it('leaves the home map alone if a spot id resolves there', () => {
    // The invariant, checked against real ids rather than invented ones.
    const homeSpot = { ...bundle!.spots[0]!, eventId: null };
    const plan = planImport(
      bundle!,
      { events: [], spots: [homeSpot] },
      'restore',
    );

    expect(plan.spots).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/belongs to your map/i);
  });
});
