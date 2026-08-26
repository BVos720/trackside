import { describe, expect, it } from 'vitest';

import { parseMetNoForecast, toCircuitLocalTime } from './metno';

/** A response entry in MET Norway's real shape, trimmed to what we read. */
function entry(
  time: string,
  cloud: number | null,
  next1?: number,
  next6?: number,
) {
  return {
    time,
    data: {
      instant: {
        details: {
          air_temperature: 14.2,
          ...(cloud === null ? {} : { cloud_area_fraction: cloud }),
        },
      },
      ...(next1 === undefined
        ? {}
        : { next_1_hours: { details: { precipitation_amount: next1 } } }),
      ...(next6 === undefined
        ? {}
        : { next_6_hours: { details: { precipitation_amount: next6 } } }),
    },
  };
}

const body = (entries: unknown[]) => ({ properties: { timeseries: entries } });

describe('toCircuitLocalTime', () => {
  it('converts a UTC instant to wall-clock time at the circuit', () => {
    // The Nürburgring in August is UTC+2.
    expect(toCircuitLocalTime('2026-08-21T12:00:00Z', 'Europe/Berlin')).toBe(
      '2026-08-21T14:00',
    );
  });

  it('uses the offset in force on that date, not today', () => {
    // January is UTC+1 — a fixed offset would put this an hour out.
    expect(toCircuitLocalTime('2026-01-21T12:00:00Z', 'Europe/Berlin')).toBe(
      '2026-01-21T13:00',
    );
  });

  it('rolls the date when local time crosses midnight', () => {
    expect(toCircuitLocalTime('2026-08-21T23:00:00Z', 'Europe/Berlin')).toBe(
      '2026-08-22T01:00',
    );
  });

  it('renders midnight as 00, never 24', () => {
    expect(toCircuitLocalTime('2026-08-21T22:00:00Z', 'Europe/Berlin')).toBe(
      '2026-08-22T00:00',
    );
  });

  it('pads to a fixed width so times sort and compare as strings', () => {
    const time = toCircuitLocalTime('2026-01-05T07:00:00Z', 'Europe/Berlin');
    expect(time).toBe('2026-01-05T08:00');
    expect(time).toHaveLength(16);
  });

  it('returns null for an unparseable instant', () => {
    expect(toCircuitLocalTime('not a time', 'Europe/Berlin')).toBeNull();
  });

  it('returns null for a timezone this device does not know', () => {
    expect(toCircuitLocalTime('2026-08-21T12:00:00Z', 'Mars/Olympus')).toBeNull();
  });
});

describe('parseMetNoForecast', () => {
  it('reads cloud cover and precipitation into local-time points', () => {
    const points = parseMetNoForecast(
      body([entry('2026-08-21T12:00:00Z', 40, 0)]),
      'Europe/Berlin',
    );

    expect(points).toEqual([
      { time: '2026-08-21T14:00', cloudCoverPercent: 40, precipitationMm: 0 },
    ]);
  });

  it('prefers the one-hour bucket over the six-hour one', () => {
    // Near the present both are present; the 1h figure is the one that means
    // "this hour", and the 6h figure would badly over-report it.
    const points = parseMetNoForecast(
      body([entry('2026-08-21T12:00:00Z', 80, 0.2, 4.8)]),
      'Europe/Berlin',
    );

    expect(points[0]?.precipitationMm).toBe(0.2);
  });

  it('falls back to the six-hour bucket further out', () => {
    const points = parseMetNoForecast(
      body([entry('2026-08-28T12:00:00Z', 80, undefined, 4.8)]),
      'Europe/Berlin',
    );

    expect(points[0]?.precipitationMm).toBe(4.8);
  });

  it('reports null precipitation when the entry carries no bucket at all', () => {
    // The last entry in the series has nothing after it to accumulate over.
    const points = parseMetNoForecast(
      body([entry('2026-08-21T12:00:00Z', 55)]),
      'Europe/Berlin',
    );

    expect(points[0]?.precipitationMm).toBeNull();
  });

  it('reports null cloud cover rather than guessing zero', () => {
    // forecast.ts treats unknown cloud as cloudy, which is the safe read for a
    // photographer. Zero would claim clear sky on no evidence.
    const points = parseMetNoForecast(
      body([entry('2026-08-21T12:00:00Z', null, 0)]),
      'Europe/Berlin',
    );

    expect(points[0]?.cloudCoverPercent).toBeNull();
  });

  it('keeps zero, which is a real reading and not a missing one', () => {
    const points = parseMetNoForecast(
      body([entry('2026-08-21T12:00:00Z', 0, 0)]),
      'Europe/Berlin',
    );

    expect(points[0]).toEqual({
      time: '2026-08-21T14:00',
      cloudCoverPercent: 0,
      precipitationMm: 0,
    });
  });

  it('drops a malformed entry without losing the rest of the forecast', () => {
    const points = parseMetNoForecast(
      body([
        entry('2026-08-21T12:00:00Z', 40, 0),
        { time: 42, data: {} },
        null,
        'nonsense',
        { data: { instant: { details: { cloud_area_fraction: 10 } } } },
        entry('2026-08-21T13:00:00Z', 45, 0),
      ]),
      'Europe/Berlin',
    );

    expect(points.map((p) => p.time)).toEqual([
      '2026-08-21T14:00',
      '2026-08-21T15:00',
    ]);
  });

  it('ignores a non-numeric reading rather than passing it through', () => {
    const points = parseMetNoForecast(
      body([
        {
          time: '2026-08-21T12:00:00Z',
          data: {
            instant: { details: { cloud_area_fraction: 'lots' } },
            next_1_hours: { details: { precipitation_amount: null } },
          },
        },
      ]),
      'Europe/Berlin',
    );

    expect(points[0]).toEqual({
      time: '2026-08-21T14:00',
      cloudCoverPercent: null,
      precipitationMm: null,
    });
  });

  it('returns nothing for a body that is not a forecast', () => {
    expect(parseMetNoForecast({}, 'Europe/Berlin')).toEqual([]);
    expect(parseMetNoForecast(null, 'Europe/Berlin')).toEqual([]);
    expect(parseMetNoForecast({ properties: {} }, 'Europe/Berlin')).toEqual([]);
    expect(
      parseMetNoForecast({ properties: { timeseries: 'no' } }, 'Europe/Berlin'),
    ).toEqual([]);
  });

  it('converts a Spa forecast to Belgian local time', () => {
    const points = parseMetNoForecast(
      body([entry('2026-09-26T06:00:00Z', 90, 1.1)]),
      'Europe/Brussels',
    );

    expect(points[0]?.time).toBe('2026-09-26T08:00');
  });
});
