import { describe, expect, it } from 'vitest';

import {
  OFF_NETWORK_PENALTY,
  PATH_METRES_PER_MINUTE,
  SETUP_MINUTES,
  departureMinute,
  formatClock,
  minuteOfDay,
  parseClock,
  relativeMinutes,
  urgencyOf,
  walkEstimate,
} from './walk';

describe('walkEstimate', () => {
  it('adds setup time even for a distance of zero', () => {
    // Being "already there" still means finding the gap and mounting the lens.
    expect(walkEstimate({ metres: 0 }).minutes).toBe(SETUP_MINUTES);
  });

  it('rounds up, never down', () => {
    // 76m is 1.01 minutes of walking. Rounding to nearest gives 1; the extra
    // 45 seconds is exactly the margin that matters.
    const e = walkEstimate({ metres: 76, setupMinutes: 0 });
    expect(e.minutes).toBe(2);
  });

  it('charges off-network metres at the penalty rate', () => {
    const onPath = walkEstimate({
      metres: 600,
      offNetworkMetres: 0,
      setupMinutes: 0,
    });
    const offPath = walkEstimate({
      metres: 600,
      offNetworkMetres: 600,
      setupMinutes: 0,
    });
    expect(offPath.minutes).toBe(
      Math.ceil((600 * OFF_NETWORK_PENALTY) / PATH_METRES_PER_MINUTE),
    );
    expect(offPath.minutes).toBeGreaterThan(onPath.minutes);
  });

  it('never counts more off-network metres than total metres', () => {
    // A caller summing legs could overshoot; the estimate must not blow up.
    const e = walkEstimate({ metres: 100, offNetworkMetres: 5000 });
    expect(e.metres).toBe(100);
    expect(e.minutes).toBeLessThan(20);
  });

  it('flags a journey that is mostly across open ground', () => {
    expect(walkEstimate({ metres: 400, offNetworkMetres: 300 }).mostlyOffNetwork)
      .toBe(true);
    expect(walkEstimate({ metres: 400, offNetworkMetres: 100 }).mostlyOffNetwork)
      .toBe(false);
  });
});

describe('clock parsing', () => {
  it('reads HH:MM', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('9:30')).toBe(570);
    expect(parseClock(' 14:05 ')).toBe(845);
  });

  it('rejects impossible times rather than wrapping them', () => {
    // 25:00 is a typo, not one in the morning. Silently accepting it would
    // schedule a stop at a time the user never chose.
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('noon')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('round-trips through formatClock', () => {
    for (const t of ['00:00', '07:05', '13:45', '23:59']) {
      expect(formatClock(parseClock(t)!)).toBe(t);
    }
  });

  it('wraps rather than producing a negative clock', () => {
    expect(formatClock(-30)).toBe('23:30');
    expect(formatClock(1440)).toBe('00:00');
  });
});

describe('departure and urgency', () => {
  it('subtracts the walk from the arrival time', () => {
    const arrive = parseClock('14:00')!;
    expect(formatClock(departureMinute(arrive, 25))).toBe('13:35');
  });

  it('lets departure go negative rather than clamping to midnight', () => {
    // A 06:00 arrival needing a 7-hour walk is not a plan; the caller has to be
    // able to see that, not be told to leave at 00:00.
    expect(departureMinute(parseClock('06:00')!, 420)).toBeLessThan(0);
  });

  it('escalates as the departure time approaches', () => {
    const depart = parseClock('13:30')!;
    expect(urgencyOf(parseClock('12:00')!, depart)).toBe('idle');
    expect(urgencyOf(parseClock('13:20')!, depart)).toBe('soon');
    expect(urgencyOf(parseClock('13:29')!, depart)).toBe('now');
    expect(urgencyOf(parseClock('13:31')!, depart)).toBe('late');
  });
});

describe('relativeMinutes', () => {
  it('reads as minutes under an hour and hours above', () => {
    expect(relativeMinutes(24)).toBe('in 24 min');
    expect(relativeMinutes(65)).toBe('in 1 h 05');
    expect(relativeMinutes(-12)).toBe('12 min ago');
  });
});

describe('minuteOfDay', () => {
  it('reads local wall-clock time, not UTC', () => {
    // The plan is against the clock on the wall at the circuit. Using UTC here
    // would shift every departure by the offset.
    const d = new Date(2026, 9, 11, 14, 30);
    expect(minuteOfDay(d)).toBe(14 * 60 + 30);
  });
});
