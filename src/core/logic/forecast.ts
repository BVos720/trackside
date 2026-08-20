/**
 * Deciding what to show for an event's weather forecast — B3-1.
 *
 * Pure logic only. `storage-local/weather.ts` is the fetch/cache boundary; it
 * hands this file a `CachedForecast | null` (whatever it found on disk,
 * unconditionally) and this file decides what a screen should render. Nothing
 * here touches the network or a store, so it is testable with plain objects —
 * no mocking `fetch`, no mocking storage.
 *
 * ── Why a discriminated union and not "forecast | null" ────────────────────
 * A photographer at a track day cares about cloud cover and rain, and a stale
 * or missing forecast is a *different* fact from a fresh one, not a rendering
 * detail. Collapsing everything to "have data / don't" throws that away: a
 * 3-day-old forecast shown as if current is actively misleading — worse than
 * showing nothing — and "no forecast yet because the event is next month" is
 * not the same problem as "no forecast because we've never had signal at this
 * circuit". Each is its own state so a screen can say the right thing rather
 * than rendering an empty or broken panel and leaving the reason to be
 * inferred.
 *
 * ── Why the age check lives here rather than in weather.ts ─────────────────
 * "Is this forecast stale" depends on the current moment, not on how it was
 * stored — recomputing it on every read is the same reasoning `eventLifecycle`
 * applies to "is this event finished" (see the note there): nothing is kept in
 * sync, so nothing can silently go stale itself. `now` is threaded through
 * rather than read from the system clock directly, so tests can pin it.
 */
import { parseIsoDate, type Event } from '../domain/event';

/**
 * Open-Meteo does not forecast beyond this many days out (its documented
 * `forecast_days` ceiling). An event planned further ahead than this cannot
 * have a forecast yet, full stop — `weather.ts` should not even attempt the
 * fetch, and this file must say so as an explicit state.
 */
export const MAX_FORECAST_HORIZON_DAYS = 16;

/**
 * A cached forecast younger than this counts as fresh rather than merely
 * usable. Three hours: Open-Meteo's underlying models refresh a few times a
 * day, so a forecast pulled this session is still describing the same
 * weather; anything older is shown, but flagged.
 */
export const DEFAULT_FRESH_WITHIN_MINUTES = 180;

/** One hour's worth of the two numbers a photographer actually needs. */
export interface HourlyForecastPoint {
  /**
   * Local time for the circuit, ISO 8601 without a UTC offset — Open-Meteo's
   * own `hourly.time` shape when a `timezone` is requested, e.g.
   * `'2026-08-21T14:00'`. Kept in the circuit's local time rather than
   * converted to UTC: "cloud cover at 14:00" is what a session sheet says,
   * and re-deriving that from a UTC instant would need the circuit's
   * timezone threaded through here too, for a value this file never
   * computes with — it only filters and displays.
   */
  readonly time: string;
  /** Percent, 0–100. Null when Open-Meteo omitted the hour. */
  readonly cloudCoverPercent: number | null;
  /** Millimetres. Null when Open-Meteo omitted the hour. */
  readonly precipitationMm: number | null;
}

/**
 * What `weather.ts` persists against an event: the raw hourly series, plus
 * when the fetch that produced it completed.
 *
 * `fetchedAt` is the whole reason this type exists rather than a bare
 * `HourlyForecastPoint[]` — see the file header. It is a UTC ISO instant
 * (matching `Utc` elsewhere in this codebase), not a `Utc`-branded value:
 * this file has no dependency on `core/domain/common`'s brand and a plain
 * string round-trips through JSON without needing to reattach one.
 */
export interface CachedForecast {
  readonly fetchedAt: string;
  readonly hourly: readonly HourlyForecastPoint[];
}

/** The event fields this file actually needs — see `eventLifecycle.ts` for the same shape of cut-down input. */
export type ForecastEvent = Pick<Event, 'startDate' | 'endDate'>;

export type ForecastDisplay =
  /** The event has no dates yet, so there is no window to forecast for. */
  | { readonly state: 'no-dates' }
  /**
   * The event's first day is further out than Open-Meteo forecasts. Fetching
   * now would be pointless — there is nothing to show until closer to the
   * date, and a caller should not treat this the same as "we tried and have
   * nothing" (`no-data-yet`).
   */
  | {
      readonly state: 'too-far-out';
      /** The event's first day, local `YYYY-MM-DD`. */
      readonly startDate: string;
      /** Days from `now` until `startDate` first falls inside the forecast horizon. Always ≥ 1. */
      readonly daysUntilForecastable: number;
    }
  /**
   * The event's dates are within range, but there is nothing usable cached
   * for them — either nothing has ever been fetched, or what is cached does
   * not cover any hour of this event (a forecast fetched for a different
   * event, or one so old its hourly series has rolled past the event dates).
   */
  | { readonly state: 'no-data-yet' }
  /** Usable, but old enough that its age must be shown alongside it. */
  | {
      readonly state: 'stale';
      readonly fetchedAt: string;
      readonly ageMinutes: number;
      readonly hourly: readonly HourlyForecastPoint[];
    }
  /** Usable and recent. */
  | {
      readonly state: 'fresh';
      readonly fetchedAt: string;
      readonly ageMinutes: number;
      readonly hourly: readonly HourlyForecastPoint[];
    };

/** Calendar-day difference between two local-midnight `Date`s, rounded. */
function diffCalendarDays(from: Date, to: Date): number {
  // Rounded rather than floored: a DST transition shifts the ms difference by
  // an hour either side of an exact day, which floor would misread as one day
  // short (or, on the "spring forward" boundary, leave a fractional day that
  // truncates to the wrong integer entirely). One hour out of twenty-four
  // always rounds back to the right calendar-day count.
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
}

/** `date` at local midnight — the same "today" every other check here compares against. */
function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whether `time` (an `HourlyForecastPoint.time`) falls within the event's
 * days, both ends inclusive.
 *
 * Compared as plain strings on the `YYYY-MM-DD` prefix, the same way dates are
 * compared elsewhere in this codebase (`EventDayRepository`'s sort, `Session`
 * ordering): ISO date strings sort and compare correctly lexicographically, so
 * there is no need to parse either side into a `Date` just to ask "is this
 * hour on one of the event's days".
 */
function isWithinEventDays(
  time: string,
  startDate: string,
  endDate: string,
): boolean {
  const day = time.slice(0, 10);
  return day >= startDate && day <= endDate;
}

/**
 * Decide what a forecast panel should show for `event` at `now`.
 *
 * `cached` is whatever `weather.ts` found on disk, or `null` if nothing has
 * ever been fetched for this event — both are ordinary inputs, not error
 * cases. This function never throws and never needs network or storage
 * access; every input is a plain value.
 */
export function resolveForecastDisplay(input: {
  readonly event: ForecastEvent;
  readonly cached: CachedForecast | null;
  readonly now?: Date;
  readonly freshWithinMinutes?: number;
}): ForecastDisplay {
  const now = input.now ?? new Date();
  const freshWithinMinutes =
    input.freshWithinMinutes ?? DEFAULT_FRESH_WITHIN_MINUTES;

  const { startDate } = input.event;
  if (!startDate) return { state: 'no-dates' };

  const start = parseIsoDate(startDate);
  if (!start) return { state: 'no-dates' };

  // A dateless-endDate or an end on/before the start is a single-day event —
  // same rule `eventDays` in `../domain/event.ts` applies, so this file never
  // disagrees with the planner about how many days an event spans.
  const endDate =
    input.event.endDate && input.event.endDate > startDate
      ? input.event.endDate
      : startDate;

  const today = localMidnight(now);
  const daysUntilStart = diffCalendarDays(today, start);

  if (daysUntilStart > MAX_FORECAST_HORIZON_DAYS) {
    return {
      state: 'too-far-out',
      startDate,
      daysUntilForecastable: daysUntilStart - MAX_FORECAST_HORIZON_DAYS,
    };
  }

  if (!input.cached) return { state: 'no-data-yet' };

  const fetchedAtMs = Date.parse(input.cached.fetchedAt);
  // An unparseable timestamp is a corrupt cache entry, not a fresh one — treat
  // it the same as never having fetched rather than trusting a bad clock.
  if (Number.isNaN(fetchedAtMs)) return { state: 'no-data-yet' };

  const relevant = input.cached.hourly.filter((point) =>
    isWithinEventDays(point.time, startDate, endDate),
  );
  if (relevant.length === 0) return { state: 'no-data-yet' };

  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - fetchedAtMs) / 60_000),
  );

  return {
    state: ageMinutes <= freshWithinMinutes ? 'fresh' : 'stale',
    fetchedAt: input.cached.fetchedAt,
    ageMinutes,
    hourly: relevant,
  };
}
