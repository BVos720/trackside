import { describe, expect, it } from 'vitest';

import { rgbString, sampleDayRamp, skyRampColor } from './lightRamp';

const NORDSCHLEIFE = { latitude: 50.3523, longitude: 6.9628 };

describe('skyRampColor', () => {
  it('is night well below the horizon', () => {
    expect(skyRampColor(-30)).toEqual([18, 23, 34]);
  });

  it('is day well above the horizon', () => {
    expect(skyRampColor(45)).toEqual([127, 178, 229]);
  });

  it('is golden at the horizon', () => {
    expect(skyRampColor(0)).toEqual([242, 160, 61]);
  });

  it('holds golden across the whole golden band', () => {
    // Two stops share the colour deliberately, and a zero-width span between
    // equal anchors must not divide by zero.
    expect(skyRampColor(3)).toEqual(skyRampColor(0));
    expect(skyRampColor(6)).toEqual(skyRampColor(0));
  });

  it('moves continuously rather than in steps', () => {
    // The whole point: sunrise is a slide, not a boundary between two hours.
    const a = skyRampColor(-8);
    const b = skyRampColor(-4);
    const c = skyRampColor(-1);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    // Warming towards the horizon: red rises the whole way.
    expect(a[0]).toBeLessThan(b[0]);
    expect(b[0]).toBeLessThan(c[0]);
  });

  it('never jumps far between neighbouring altitudes', () => {
    // A gradient with a seam in it is just steps again.
    for (let alt = -20; alt < 20; alt += 0.5) {
      const here = skyRampColor(alt);
      const next = skyRampColor(alt + 0.5);
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(here[ch]! - next[ch]!)).toBeLessThan(20);
      }
    }
  });

  it('falls back to night for a non-finite altitude', () => {
    // Rather than emitting NaN into a style prop.
    expect(skyRampColor(NaN)).toEqual([18, 23, 34]);
  });
});

describe('rgbString', () => {
  it('formats for a style prop', () => {
    expect(rgbString([1, 2, 3])).toBe('rgb(1, 2, 3)');
  });
});

describe('sampleDayRamp', () => {
  const midsummer = new Date(2026, 5, 21, 12, 0, 0);

  it('returns the number of steps asked for', () => {
    expect(sampleDayRamp(midsummer, NORDSCHLEIFE, 48)).toHaveLength(48);
  });

  it('spans the day from 0 to just under 1', () => {
    const steps = sampleDayRamp(midsummer, NORDSCHLEIFE, 24);
    expect(steps[0]!.at).toBe(0);
    expect(steps[23]!.at).toBeCloseTo(23 / 24);
  });

  it('is dark at midnight and light at midday in June', () => {
    const steps = sampleDayRamp(midsummer, NORDSCHLEIFE, 24);
    expect(steps[0]!.altitude).toBeLessThan(0);
    expect(steps[12]!.altitude).toBeGreaterThan(0);
  });

  it('gives a polar summer day no night at all', () => {
    // Altitudes rather than clock times is what makes this work: a time-based
    // ramp would invent a sunrise that does not happen here.
    const svalbard = { latitude: 78.2, longitude: 15.6 };
    const steps = sampleDayRamp(midsummer, svalbard, 24);
    expect(steps.every((s) => s.altitude > 0)).toBe(true);
  });

  it('samples the middle of each step, not its leading edge', () => {
    // So a step's colour represents the slice it covers instead of leading it.
    const one = sampleDayRamp(midsummer, NORDSCHLEIFE, 2);
    const noon = sampleDayRamp(midsummer, NORDSCHLEIFE, 24)[12]!;
    // The second half-day sample sits at 18:00, well past noon and lower.
    expect(one[1]!.altitude).toBeLessThan(noon.altitude);
  });
});
