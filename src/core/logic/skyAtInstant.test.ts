import { describe, expect, it } from 'vitest';

import { skyConditionAt } from './skyAtInstant';
import type { HourlyForecastPoint } from './forecast';

function point(
  time: string,
  cloudCoverPercent: number | null,
  precipitationMm: number | null = 0,
): HourlyForecastPoint {
  return { time, cloudCoverPercent, precipitationMm };
}

describe('skyConditionAt', () => {
  // All of these use timezone 'UTC' with `at` built via `Date.UTC`, so the
  // result is independent of the machine/CI runner's own local timezone —
  // the one thing this function must never accidentally depend on.

  it('returns the hour’s condition for an exact match', () => {
    const hourly = [
      point('2026-08-21T13:00', 10), // clear
      point('2026-08-21T14:00', 60), // cloudy
      point('2026-08-21T15:00', 90), // overcast
    ];
    const at = new Date(Date.UTC(2026, 7, 21, 14, 0, 0));
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('cloudy');
  });

  it('picks the nearer of two hourly samples for an in-between instant', () => {
    const hourly = [
      point('2026-08-21T14:00', 10), // clear
      point('2026-08-21T15:00', 90), // overcast
    ];
    // 14:20 is 20 minutes from 14:00 and 40 minutes from 15:00 — nearer to 14:00.
    const at = new Date(Date.UTC(2026, 7, 21, 14, 20, 0));
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('clear');

    // 14:50 is 10 minutes from 15:00 and 50 minutes from 14:00 — nearer to 15:00.
    const atLate = new Date(Date.UTC(2026, 7, 21, 14, 50, 0));
    expect(skyConditionAt(hourly, atLate, 'UTC')).toBe('overcast');
  });

  it('ties go to the earlier sample', () => {
    const hourly = [
      point('2026-08-21T14:00', 10), // clear
      point('2026-08-21T15:00', 90), // overcast
    ];
    const atMidpoint = new Date(Date.UTC(2026, 7, 21, 14, 30, 0)); // exactly 30 min from each
    expect(skyConditionAt(hourly, atMidpoint, 'UTC')).toBe('clear');
  });

  it('returns unknown for an instant before the forecast’s first hour', () => {
    const hourly = [point('2026-08-21T14:00', 10), point('2026-08-21T15:00', 90)];
    const at = new Date(Date.UTC(2026, 7, 21, 10, 0, 0)); // 4 hours before the first sample
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('unknown');
  });

  it('returns unknown for an instant after the forecast’s last hour', () => {
    const hourly = [point('2026-08-21T14:00', 10), point('2026-08-21T15:00', 90)];
    const at = new Date(Date.UTC(2026, 7, 22, 3, 0, 0)); // well past the last sample
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('unknown');
  });

  it('returns unknown for an empty hourly array', () => {
    const at = new Date(Date.UTC(2026, 7, 21, 14, 0, 0));
    expect(skyConditionAt([], at, 'UTC')).toBe('unknown');
  });

  it('returns unknown inside a genuine gap in the middle of the series', () => {
    // 15:00, 16:00 and 17:00 are missing entirely — not just off-hour, but never fetched.
    const hourly = [point('2026-08-21T14:00', 10), point('2026-08-21T18:00', 90)];
    const at = new Date(Date.UTC(2026, 7, 21, 16, 0, 0)); // 2 hours from either neighbour
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('unknown');
  });

  it('uses the circuit timezone, not the device/test-runner local time', () => {
    // 2026-08-21T22:00Z is 2026-08-22T00:00 in Europe/Berlin (CEST, UTC+2) in
    // August, but would misread as 2026-08-21T22:00 if the UTC instant were
    // used directly, or as some other hour again under the machine's own
    // timezone if that were used instead of the circuit's.
    const at = new Date(Date.UTC(2026, 7, 21, 22, 0, 0));
    const hourly = [
      point('2026-08-21T22:00', 90), // wrong entry: the raw UTC hour, overcast
      point('2026-08-22T00:00', 5), // right entry: Berlin-local hour, clear
    ];
    expect(skyConditionAt(hourly, at, 'Europe/Berlin')).toBe('clear');
  });

  it('uses the circuit timezone for a zone ahead of UTC too', () => {
    // 2026-08-21T20:00Z is 2026-08-22T05:00 in Asia/Tokyo (UTC+9, no DST).
    const at = new Date(Date.UTC(2026, 7, 21, 20, 0, 0));
    const hourly = [
      point('2026-08-21T20:00', 90), // wrong entry: the raw UTC hour, overcast
      point('2026-08-22T05:00', 5), // right entry: Tokyo-local hour, clear
    ];
    expect(skyConditionAt(hourly, at, 'Asia/Tokyo')).toBe('clear');
  });

  it('treats rain as taking priority, same as skyCondition itself', () => {
    const hourly = [point('2026-08-21T14:00', 10, 1.5)]; // low cloud but raining
    const at = new Date(Date.UTC(2026, 7, 21, 14, 0, 0));
    expect(skyConditionAt(hourly, at, 'UTC')).toBe('rain');
  });
});
