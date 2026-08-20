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
