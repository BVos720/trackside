import { describe, expect, it } from 'vitest';

import { newEvent, type Event } from '../domain/event';
import { asId, type CircuitId, type UserId } from '../domain/ids';
import {
  isEventFinished,
  partitionEventsByFinished,
  visibleEvents,
} from './eventLifecycle';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

const anEvent = (
  name: string,
  startDate: string | null,
  endDate: string | null,
): Event =>
  newEvent({ circuitId: CIRCUIT, name, createdBy: USER, startDate, endDate });

/** Local midnight for a `YYYY-MM-DD`, so tests build "now" the same way the
 * code under test parses `endDate` — comparing UTC-parsed dates against
 * locally-parsed ones would make this test's pass/fail depend on the
 * machine's timezone. */
const localMidnight = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

describe('isEventFinished', () => {
  it('is not finished with no endDate at all', () => {
    const event = anEvent('Trackday', null, null);
    expect(isEventFinished(event, localMidnight('2099-01-01'))).toBe(false);
  });

  it('is not finished while now is still on the last day', () => {
    const event = anEvent('NLS10', '2026-10-09', '2026-10-11');
    // Any moment on 11 October, including right at its start.
    expect(isEventFinished(event, localMidnight('2026-10-11'))).toBe(false);
    const lateOnLastDay = new Date(localMidnight('2026-10-11'));
    lateOnLastDay.setHours(23, 59, 59);
    expect(isEventFinished(event, lateOnLastDay)).toBe(false);
  });

  it('is finished from the start of the day after endDate', () => {
    const event = anEvent('NLS10', '2026-10-09', '2026-10-11');
    expect(isEventFinished(event, localMidnight('2026-10-12'))).toBe(true);
    expect(isEventFinished(event, localMidnight('2027-01-01'))).toBe(true);
  });

  it('is not finished before the event has even started', () => {
    const event = anEvent('Future event', '2099-06-01', '2099-06-03');
    expect(isEventFinished(event, localMidnight('2026-01-01'))).toBe(false);
  });

  it('falls back to being unable to judge on an unparsable endDate', () => {
    // Never reachable through newEvent, but a bad record from an old import
    // must not crash the read path, and must not silently claim "finished".
    const event = { ...anEvent('Bad data', null, null), endDate: 'not-a-date' };
    expect(isEventFinished(event, localMidnight('2099-01-01'))).toBe(false);
  });

  it('defaults now to the real clock when not given', () => {
    const longOver = anEvent('Ancient event', '2000-01-01', '2000-01-02');
    expect(isEventFinished(longOver)).toBe(true);

    const farFuture = anEvent('Future event', '2099-01-01', '2099-01-02');
    expect(isEventFinished(farFuture)).toBe(false);
  });
});

describe('partitionEventsByFinished', () => {
  it('splits events into active and finished without dropping either', () => {
    const past = anEvent('Past', '2020-01-01', '2020-01-02');
    const future = anEvent('Future', '2099-01-01', '2099-01-02');
    const dateless = anEvent('Dateless', null, null);

    const { active, finished } = partitionEventsByFinished(
      [past, future, dateless],
      localMidnight('2026-06-01'),
    );

    expect(finished).toEqual([past]);
    expect(active).toEqual([future, dateless]);
  });

  it('returns empty partitions for an empty list', () => {
    const { active, finished } = partitionEventsByFinished(
      [],
      localMidnight('2026-06-01'),
    );
    expect(active).toEqual([]);
    expect(finished).toEqual([]);
  });
});

describe('visibleEvents', () => {
  const past = anEvent('Past', '2020-01-01', '2020-01-02');
  const future = anEvent('Future', '2099-01-01', '2099-01-02');
  const now = localMidnight('2026-06-01');

  it('hides finished events when showFinished is false', () => {
    expect(visibleEvents([past, future], { showFinished: false, now })).toEqual([
      future,
    ]);
  });

  it('keeps everything when showFinished is true', () => {
    expect(visibleEvents([past, future], { showFinished: true, now })).toEqual([
      past,
      future,
    ]);
  });

  it('does not mutate or reorder the input either way', () => {
    const list = [future, past];
    const result = visibleEvents(list, { showFinished: true, now });
    expect(result).toEqual([future, past]);
    expect(result).not.toBe(list);
  });
});
