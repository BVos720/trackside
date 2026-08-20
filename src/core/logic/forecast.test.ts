import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FRESH_WITHIN_MINUTES,
  MAX_FORECAST_HORIZON_DAYS,
  resolveForecastDisplay,
  type CachedForecast,
} from './forecast';

const NOW = new Date(2026, 7, 20, 12, 0, 0); // 2026-08-20 12:00 local

function isoLocal(daysFromNow: number, hour = 12): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hourlyTime(dateIso: string, hour: string): string {
  return `${dateIso}T${hour}`;
}

describe('resolveForecastDisplay', () => {
  it('returns no-dates when the event has no startDate', () => {
    const result = resolveForecastDisplay({
      event: { startDate: null, endDate: null },
      cached: null,
      now: NOW,
    });
    expect(result.state).toBe('no-dates');
  });

  it('returns no-dates when startDate is unparseable', () => {
    const result = resolveForecastDisplay({
      event: { startDate: 'not-a-date', endDate: null },
      cached: null,
      now: NOW,
    });
    expect(result.state).toBe('no-dates');
  });

  it('returns too-far-out when the event starts beyond the forecast horizon', () => {
    const startDate = isoLocal(MAX_FORECAST_HORIZON_DAYS + 5);
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached: null,
      now: NOW,
    });
    expect(result).toEqual({
      state: 'too-far-out',
      startDate,
      daysUntilForecastable: 5,
    });
  });

  it('is not too-far-out exactly at the horizon boundary', () => {
    const startDate = isoLocal(MAX_FORECAST_HORIZON_DAYS);
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached: null,
      now: NOW,
    });
    // Within horizon, no cache yet.
    expect(result.state).toBe('no-data-yet');
  });

  it('too-far-out ignores any cached data — the event is not fetchable yet regardless', () => {
    const startDate = isoLocal(MAX_FORECAST_HORIZON_DAYS + 1);
    const cached: CachedForecast = {
      fetchedAt: NOW.toISOString(),
      hourly: [
        { time: hourlyTime(startDate, '12:00'), cloudCoverPercent: 50, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('too-far-out');
  });

  it('returns no-data-yet when nothing has ever been cached', () => {
    const startDate = isoLocal(2);
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached: null,
      now: NOW,
    });
    expect(result.state).toBe('no-data-yet');
  });

  it('returns no-data-yet when the cache has no hours covering the event days', () => {
    const startDate = isoLocal(3);
    const otherDay = isoLocal(10);
    const cached: CachedForecast = {
      fetchedAt: NOW.toISOString(),
      hourly: [
        { time: hourlyTime(otherDay, '12:00'), cloudCoverPercent: 40, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('no-data-yet');
  });

  it('returns no-data-yet when the cached fetchedAt is unparseable', () => {
    const startDate = isoLocal(1);
    const cached: CachedForecast = {
      fetchedAt: 'garbage',
      hourly: [
        { time: hourlyTime(startDate, '12:00'), cloudCoverPercent: 40, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('no-data-yet');
  });

  it('returns fresh for a recently fetched forecast covering the event', () => {
    const startDate = isoLocal(1);
    const fetchedAt = new Date(NOW.getTime() - 30 * 60_000).toISOString(); // 30 min ago
    const cached: CachedForecast = {
      fetchedAt,
      hourly: [
        { time: hourlyTime(startDate, '09:00'), cloudCoverPercent: 20, precipitationMm: 0 },
        { time: hourlyTime(startDate, '14:00'), cloudCoverPercent: 80, precipitationMm: 1.2 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('fresh');
    if (result.state === 'fresh') {
      expect(result.ageMinutes).toBe(30);
      expect(result.hourly).toHaveLength(2);
      expect(result.fetchedAt).toBe(fetchedAt);
    }
  });

  it('returns stale for an old forecast, past the default freshness window', () => {
    const startDate = isoLocal(1);
    const fetchedAt = new Date(
      NOW.getTime() - (DEFAULT_FRESH_WITHIN_MINUTES + 60) * 60_000,
    ).toISOString();
    const cached: CachedForecast = {
      fetchedAt,
      hourly: [
        { time: hourlyTime(startDate, '09:00'), cloudCoverPercent: 20, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('stale');
    if (result.state === 'stale') {
      expect(result.ageMinutes).toBe(DEFAULT_FRESH_WITHIN_MINUTES + 60);
    }
  });

  it('honours a custom freshWithinMinutes', () => {
    const startDate = isoLocal(1);
    const fetchedAt = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const cached: CachedForecast = {
      fetchedAt,
      hourly: [
        { time: hourlyTime(startDate, '09:00'), cloudCoverPercent: 20, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: null },
      cached,
      now: NOW,
      freshWithinMinutes: 5,
    });
    expect(result.state).toBe('stale');
  });

  it('filters hourly points to the event day range across a multi-day event', () => {
    const startDate = isoLocal(1);
    const endDate = isoLocal(3);
    const before = isoLocal(0);
    const middle = isoLocal(2);
    const after = isoLocal(4);
    const cached: CachedForecast = {
      fetchedAt: NOW.toISOString(),
      hourly: [
        { time: hourlyTime(before, '12:00'), cloudCoverPercent: 1, precipitationMm: 0 },
        { time: hourlyTime(startDate, '12:00'), cloudCoverPercent: 2, precipitationMm: 0 },
        { time: hourlyTime(middle, '12:00'), cloudCoverPercent: 3, precipitationMm: 0 },
        { time: hourlyTime(endDate, '12:00'), cloudCoverPercent: 4, precipitationMm: 0 },
        { time: hourlyTime(after, '12:00'), cloudCoverPercent: 5, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('fresh');
    if (result.state === 'fresh') {
      expect(result.hourly.map((h) => h.cloudCoverPercent)).toEqual([2, 3, 4]);
    }
  });

  it('treats an endDate on or before startDate as a single-day event', () => {
    const startDate = isoLocal(1);
    const cached: CachedForecast = {
      fetchedAt: NOW.toISOString(),
      hourly: [
        { time: hourlyTime(startDate, '12:00'), cloudCoverPercent: 10, precipitationMm: 0 },
        { time: hourlyTime(isoLocal(2), '12:00'), cloudCoverPercent: 20, precipitationMm: 0 },
      ],
    };
    const result = resolveForecastDisplay({
      event: { startDate, endDate: startDate },
      cached,
      now: NOW,
    });
    expect(result.state).toBe('fresh');
    if (result.state === 'fresh') {
      expect(result.hourly).toHaveLength(1);
      expect(result.hourly[0]!.cloudCoverPercent).toBe(10);
    }
  });
});

/* ── Shaping a forecast for display ──────────────────────────────────────── */

import {
  groupForecastByDay,
  skyCondition,
  summariseDay,
  RAIN_THRESHOLD_MM,
  type HourlyForecastPoint,
} from './forecast';

const point = (
  time: string,
  cloud: number | null,
  rain: number | null = 0,
): HourlyForecastPoint => ({
  time,
  cloudCoverPercent: cloud,
  precipitationMm: rain,
});

describe('groupForecastByDay', () => {
  it('splits the series on calendar day', () => {
    const days = groupForecastByDay([
      point('2026-08-21T22:00', 10),
      point('2026-08-21T23:00', 20),
      point('2026-08-22T00:00', 30),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-08-21', '2026-08-22']);
    expect(days[0]!.points).toHaveLength(2);
    expect(days[1]!.points).toHaveLength(1);
  });

  it('is empty for an empty series', () => {
    expect(groupForecastByDay([])).toEqual([]);
  });

  it('keeps the order it was given rather than sorting', () => {
    // A response that came back out of order is a fact about the response,
    // not something this function should hide.
    const days = groupForecastByDay([
      point('2026-08-22T00:00', 30),
      point('2026-08-21T22:00', 10),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-08-22', '2026-08-21']);
  });
});

describe('skyCondition', () => {
  it('reads the cloud bands', () => {
    expect(skyCondition(0, 0)).toBe('clear');
    expect(skyCondition(14, 0)).toBe('clear');
    expect(skyCondition(15, 0)).toBe('partly');
    expect(skyCondition(49, 0)).toBe('partly');
    expect(skyCondition(50, 0)).toBe('cloudy');
    expect(skyCondition(84, 0)).toBe('cloudy');
    expect(skyCondition(85, 0)).toBe('overcast');
    expect(skyCondition(100, 0)).toBe('overcast');
  });

  it('lets rain beat any cloud band', () => {
    expect(skyCondition(0, RAIN_THRESHOLD_MM)).toBe('rain');
    expect(skyCondition(100, 5)).toBe('rain');
  });

  it('ignores rain below the threshold', () => {
    expect(skyCondition(10, RAIN_THRESHOLD_MM - 0.01)).toBe('clear');
  });

  it('treats an unreported cloud figure as cloudy rather than clear', () => {
    // Guessing "clear" from missing data would be the app asserting a fact it
    // does not have — §0.2.
    expect(skyCondition(null, 0)).toBe('cloudy');
  });
});

describe('summariseDay', () => {
  it('averages cloud and totals rain', () => {
    const s = summariseDay([
      point('2026-08-21T10:00', 20, 0),
      point('2026-08-21T11:00', 40, 0.5),
      point('2026-08-21T12:00', 60, 0.5),
    ]);
    expect(s.meanCloudPercent).toBe(40);
    expect(s.totalRainMm).toBeCloseTo(1.0);
    expect(s.rainHours).toBe(2);
    expect(s.condition).toBe('rain');
  });

  it('calls a dry day by its cloud band', () => {
    const s = summariseDay([
      point('2026-08-21T10:00', 5, 0),
      point('2026-08-21T11:00', 5, 0),
    ]);
    expect(s.condition).toBe('clear');
    expect(s.rainHours).toBe(0);
  });

  it('calls the day rain even when the total is small', () => {
    // One wet hour during the session you came for still changes the day.
    const s = summariseDay([
      point('2026-08-21T10:00', 5, 0),
      point('2026-08-21T14:00', 5, RAIN_THRESHOLD_MM),
    ]);
    expect(s.condition).toBe('rain');
    expect(s.totalRainMm).toBeCloseTo(RAIN_THRESHOLD_MM);
  });

  it('finds the clearest three-hour daylight window', () => {
    const s = summariseDay([
      point('2026-08-21T06:00', 90),
      point('2026-08-21T07:00', 80),
      point('2026-08-21T08:00', 70),
      point('2026-08-21T09:00', 10),
      point('2026-08-21T10:00', 10),
      point('2026-08-21T11:00', 10),
      point('2026-08-21T12:00', 95),
    ]);
    expect(s.clearestWindow).toEqual({
      fromHour: 9,
      toHour: 11,
      meanCloudPercent: 10,
    });
  });

  it('keeps the clearest window out of the middle of the night', () => {
    const s = summariseDay([
      point('2026-08-21T02:00', 0),
      point('2026-08-21T03:00', 0),
      point('2026-08-21T04:00', 0),
      point('2026-08-21T10:00', 40),
      point('2026-08-21T11:00', 40),
      point('2026-08-21T12:00', 40),
    ]);
    expect(s.clearestWindow?.fromHour).toBe(10);
  });

  it('reports what there is when the day is shorter than a window', () => {
    const s = summariseDay([
      point('2026-08-21T10:00', 20),
      point('2026-08-21T11:00', 40),
    ]);
    expect(s.clearestWindow).toEqual({
      fromHour: 10,
      toHour: 11,
      meanCloudPercent: 30,
    });
  });

  it('has no clearest window when nothing reported cloud', () => {
    const s = summariseDay([point('2026-08-21T10:00', null)]);
    expect(s.clearestWindow).toBeNull();
    expect(s.meanCloudPercent).toBeNull();
  });

  it('does not span a gap in the hours', () => {
    // 08:00 → 12:00 is a four-hour gap, so those two clear hours cannot be
    // read as a window however clear they are; the run has to be consecutive.
    // 12:00–14:00 is consecutive and wins on its average.
    const s = summariseDay([
      point('2026-08-21T08:00', 0),
      point('2026-08-21T12:00', 0),
      point('2026-08-21T13:00', 50),
      point('2026-08-21T14:00', 50),
      point('2026-08-21T15:00', 50),
    ]);
    expect(s.clearestWindow?.fromHour).toBe(12);
    expect(s.clearestWindow?.toHour).toBe(14);
  });

  it('refuses a window that only exists by jumping the gap', () => {
    // Nothing consecutive at all: every hour is isolated, so there is no
    // three-hour run to report and it falls back to the whole span.
    const s = summariseDay([
      point('2026-08-21T08:00', 0),
      point('2026-08-21T12:00', 30),
      point('2026-08-21T16:00', 60),
    ]);
    expect(s.clearestWindow).toEqual({
      fromHour: 8,
      toHour: 16,
      meanCloudPercent: 30,
    });
  });
});
