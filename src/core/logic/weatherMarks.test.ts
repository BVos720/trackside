import { describe, expect, it } from 'vitest';

import { markFor, weatherMarksForDay } from './weatherMarks';

const p = (
  time: string,
  cloudCoverPercent: number | null,
  precipitationMm: number | null,
) => ({ time, cloudCoverPercent, precipitationMm });

describe('markFor', () => {
  it('calls a clear sky clear', () => {
    expect(markFor(10, 0)).toBe('clear');
  });

  it('marks dominant cloud', () => {
    expect(markFor(85, 0)).toBe('cloud');
  });

  it('says nothing about middling cloud', () => {
    // A mark at 30% would appear on almost every hour of a European summer
    // and mean nothing.
    expect(markFor(30, 0)).toBe('clear');
  });

  it('lets rain win over cloud', () => {
    // It is raining. That the sky is also cloudy is not the useful half.
    expect(markFor(95, 2)).toBe('rain');
  });

  it('marks even light rain', () => {
    // 0.2mm will not soak you but it will put water on the lens, which is
    // worth knowing before walking out to a spot with no shelter.
    expect(markFor(0, 0.2)).toBe('rain');
  });

  it('treats a missing reading as nothing to say, not as zero', () => {
    expect(markFor(null, null)).toBe('clear');
  });
});

describe('weatherMarksForDay', () => {
  const day = '2026-08-29';

  it('returns a mark per interesting hour', () => {
    const marks = weatherMarksForDay(
      [p(`${day}T14:00`, 90, 0), p(`${day}T15:00`, 95, 3)],
      day,
    );
    expect(marks).toEqual([
      { hour: 14, kind: 'cloud' },
      { hour: 15, kind: 'rain' },
    ]);
  });

  it('omits clear hours rather than marking them', () => {
    // An absent mark is the honest rendering of both "clear" and "no
    // forecast"; a clear-sky symbol for an hour never sent would be a claim.
    expect(weatherMarksForDay([p(`${day}T09:00`, 5, 0)], day)).toEqual([]);
  });

  it('ignores other days', () => {
    const marks = weatherMarksForDay(
      [p('2026-08-28T14:00', 90, 0), p(`${day}T14:00`, 90, 0)],
      day,
    );
    expect(marks).toHaveLength(1);
  });

  it('sorts by hour whatever order the series arrived in', () => {
    const marks = weatherMarksForDay(
      [p(`${day}T20:00`, 90, 0), p(`${day}T06:00`, 90, 0)],
      day,
    );
    expect(marks.map((m) => m.hour)).toEqual([6, 20]);
  });

  it('keeps the first of a duplicated hour', () => {
    // So a duplicate cannot silently override a reading with no way to tell.
    const marks = weatherMarksForDay(
      [p(`${day}T12:00`, 90, 0), p(`${day}T12:00`, 0, 5)],
      day,
    );
    expect(marks).toEqual([{ hour: 12, kind: 'cloud' }]);
  });

  it('survives a malformed entry', () => {
    const marks = weatherMarksForDay(
      [p(`${day}Txx:00`, 90, 0), p(`${day}T13:00`, 90, 0)],
      day,
    );
    expect(marks).toEqual([{ hour: 13, kind: 'cloud' }]);
  });

  it('returns nothing for an empty series', () => {
    expect(weatherMarksForDay([], day)).toEqual([]);
  });
});
