import { describe, expect, it } from 'vitest';

import { matchEventDay } from './eventDate';

/** A Fri–Sun weekend: 9, 10, 11 October 2026. */
const WEEKEND = ['2026-10-09', '2026-10-10', '2026-10-11'];

describe('matchEventDay', () => {
  it('matches on the day number', () => {
    expect(matchEventDay('Saturday 10 October', WEEKEND)).toBe('2026-10-10');
    expect(matchEventDay('SUNDAY, OCTOBER 11', WEEKEND)).toBe('2026-10-11');
  });

  it('matches on the weekday name when there is no number', () => {
    expect(matchEventDay('FRIDAY', WEEKEND)).toBe('2026-10-09');
    expect(matchEventDay('Sunday — race day', WEEKEND)).toBe('2026-10-11');
  });

  it('is case and punctuation insensitive', () => {
    expect(matchEventDay('saturday,  10  october', WEEKEND)).toBe('2026-10-10');
  });

  it('ignores numbers that cannot be a day of the month', () => {
    // A year in the heading must not be read as a date.
    expect(matchEventDay('Race day 2026', WEEKEND)).toBeNull();
  });

  it('does not mistake a time for a day number', () => {
    // "14:00" contains 14 and 00; neither is one of the event's days, and the
    // heading names no weekday, so there is nothing to match.
    expect(matchEventDay('Sessions from 14:00', WEEKEND)).toBeNull();
  });

  it('refuses an ambiguous weekday', () => {
    // Two Saturdays a fortnight apart: the heading does not say which.
    const fortnight = ['2026-10-10', '2026-10-17'];
    expect(matchEventDay('Saturday', fortnight)).toBeNull();
  });

  it('resolves an ambiguous weekday when the number disambiguates', () => {
    const fortnight = ['2026-10-10', '2026-10-17'];
    expect(matchEventDay('Saturday 17 October', fortnight)).toBe('2026-10-17');
  });

  it('takes the only day when the event is one day long', () => {
    expect(matchEventDay('anything at all', ['2026-05-09'])).toBe('2026-05-09');
  });

  it('returns null rather than guessing when nothing matches', () => {
    // Guessing here schedules someone to stand at a corner on a day nothing
    // runs — worse than showing the heading as written.
    expect(matchEventDay('Test day', WEEKEND)).toBeNull();
    expect(matchEventDay('Monday', WEEKEND)).toBeNull();
  });

  it('returns null with no event dates', () => {
    expect(matchEventDay('Saturday 10 October', [])).toBeNull();
  });
});
