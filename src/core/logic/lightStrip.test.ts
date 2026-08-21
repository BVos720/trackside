/**
 * Tests for the pure day/time math behind `SkyControl`'s light strip.
 *
 * PanResponder gesture handling itself is not unit-tested — per the task
 * notes, that's exercised on the emulator, not headlessly. What is tested is
 * everything the gesture path and the strip's rendering delegate to: the
 * instant↔fraction math and the light-sampling function, which is exactly
 * where a real bug (an off-by-one day, a wrong rounding direction) would
 * hide.
 *
 * `fractionOfDay`/`instantAtFraction` work in local time (see their doc
 * comments), so test dates are built with the local `Date` constructor
 * rather than ISO/UTC strings — using UTC strings here would make these
 * tests pass or fail depending on the machine's timezone, which is exactly
 * the bug class `sun.test.ts` warns about for a different convention
 * mismatch.
 */
import { describe, expect, it } from 'vitest';

import {
  fractionOfDay,
  instantAtFraction,
  nearestHourSample,
  sampleDayLight,
  type HourSample,
} from './lightStrip';
import { LightQuality, lightQuality, solarPosition } from './sun';

/** Local-time constructor shorthand: (year, month 1–12, day, hour, minute). */
function localAt(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// Same approximate coordinates `sun.test.ts` uses — a test input, not seed
// data (see that file's note on why).
const NURBURGRING = { latitude: 50.3356, longitude: 6.9475 };

describe('fractionOfDay', () => {
  it('is 0 at local midnight', () => {
    expect(fractionOfDay(localAt(2026, 8, 21, 0, 0))).toBe(0);
  });

  it('is 0.5 at local noon', () => {
    expect(fractionOfDay(localAt(2026, 8, 21, 12, 0))).toBeCloseTo(0.5, 10);
  });

  it('is 0.75 at 18:00 local', () => {
    expect(fractionOfDay(localAt(2026, 8, 21, 18, 0))).toBeCloseTo(0.75, 10);
  });
});

describe('instantAtFraction', () => {
  it('maps 0 to local midnight of the given day', () => {
    const day = localAt(2026, 8, 21, 15, 30); // any time on the 21st
    const result = instantAtFraction(day, 0);
    expect(result.getTime()).toBe(localAt(2026, 8, 21, 0, 0).getTime());
  });

  it('maps 0.5 to local noon of the given day', () => {
    const day = localAt(2026, 8, 21, 3, 0);
    const result = instantAtFraction(day, 0.5);
    expect(result.getTime()).toBe(localAt(2026, 8, 21, 12, 0).getTime());
  });

  it('clamps fractions outside [0, 1]', () => {
    const day = localAt(2026, 8, 21, 3, 0);
    expect(instantAtFraction(day, -0.4).getTime()).toBe(
      instantAtFraction(day, 0).getTime(),
    );
    expect(instantAtFraction(day, 1.4).getTime()).toBe(
      instantAtFraction(day, 1).getTime(),
    );
  });

  it('round-trips with fractionOfDay', () => {
    const day = localAt(2026, 8, 21, 0, 0);
    const at = instantAtFraction(day, 0.3);
    expect(fractionOfDay(at)).toBeCloseTo(0.3, 10);
  });
});

describe('sampleDayLight', () => {
  it('returns one sample per hour, 0 through 23, in order', () => {
    const samples = sampleDayLight(localAt(2026, 6, 21, 12, 0), NURBURGRING);
    expect(samples).toHaveLength(24);
    samples.forEach((s, i) => expect(s.hour).toBe(i));
  });

  it('matches lightQuality(solarPosition(...)) independently computed for each local hour', () => {
    // Deliberately not hardcoded against "midnight is dark, noon is
    // daylight": this suite's own local-time helper is built on whichever
    // timezone the test machine happens to be in, so the only assertion
    // that holds everywhere is that `sampleDayLight` agrees with the
    // primitives it's built from.
    const samples = sampleDayLight(localAt(2026, 6, 21, 12, 0), NURBURGRING);
    for (let hour = 0; hour < 24; hour++) {
      const at = localAt(2026, 6, 21, hour, 0);
      const expected = lightQuality(solarPosition(at, NURBURGRING).altitude);
      expect(samples[hour]!.quality).toBe(expected);
    }
  });

  it('includes both a dark and a daylight hour across the day, at 50°N in June', () => {
    // True for any 24-hour window at this latitude regardless of which
    // instant "local midnight" happens to be, since 50°N is nowhere near
    // the polar day/night threshold — unlike the test above, this one is
    // safe to assert on the real astronomy.
    const samples = sampleDayLight(localAt(2026, 6, 21, 12, 0), NURBURGRING);
    const qualities = new Set(samples.map((s) => s.quality));
    expect(qualities.has(LightQuality.Daylight)).toBe(true);
    expect(qualities.has(LightQuality.Dark)).toBe(true);
  });

  it('only depends on the calendar day, not the time of day passed in', () => {
    const morning = sampleDayLight(localAt(2026, 6, 21, 6, 0), NURBURGRING);
    const evening = sampleDayLight(localAt(2026, 6, 21, 22, 0), NURBURGRING);
    expect(morning).toEqual(evening);
  });
});

describe('nearestHourSample', () => {
  const samples: HourSample[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    quality: hour === 12 ? LightQuality.Daylight : LightQuality.Dark,
  }));

  it('picks the first sample at fraction 0', () => {
    expect(nearestHourSample(samples, 0)!.hour).toBe(0);
  });

  it('picks the last sample at fraction 1', () => {
    expect(nearestHourSample(samples, 1)!.hour).toBe(23);
  });

  it('picks the midday sample at fraction 0.5', () => {
    expect(nearestHourSample(samples, 0.5)!.hour).toBe(12);
  });

  it('picks the exact hour at a non-midpoint hour boundary', () => {
    // Regression case: samples sit at fraction h/24 (each hour's own
    // timestamp), not spread across (length - 1) steps. A formula that
    // divides by (length - 1) instead of `length` rounds this down to hour
    // 17 instead of 18 — wrong for the back half of the day specifically.
    expect(nearestHourSample(samples, 18 / 24)!.hour).toBe(18);
    expect(nearestHourSample(samples, 6 / 24)!.hour).toBe(6);
  });

  it('returns null for an empty sample set rather than throwing', () => {
    expect(nearestHourSample([], 0.5)).toBeNull();
  });
});
