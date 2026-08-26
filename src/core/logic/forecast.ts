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
 * MET Norway does not forecast beyond this many days out. An event planned
 * further ahead than this cannot have a forecast yet, full stop — `weather.ts`
 * should not even attempt the fetch, and this file must say so as an explicit
 * state.
 *
 * Nine, not sixteen: Locationforecast runs to roughly nine and a half days,
 * where Open-Meteo (which this app used to call, see `weather.ts`) ran to
 * sixteen. Rounded down rather than up, because the cost of the two errors is
 * not symmetrical — claiming a forecast exists and then showing an empty
 * panel is worse than saying plainly that the event is too far out.
 */
export const MAX_FORECAST_HORIZON_DAYS = 9;

/**
 * A cached forecast younger than this counts as fresh rather than merely
 * usable. Three hours: the underlying models refresh a few times a day, so a
 * forecast pulled this session is still describing the same weather; anything
 * older is shown, but flagged.
 */
export const DEFAULT_FRESH_WITHIN_MINUTES = 180;

/** One hour's worth of the two numbers a photographer actually needs. */
export interface HourlyForecastPoint {
  /**
   * Local time for the circuit, ISO 8601 without a UTC offset, e.g.
   * `'2026-08-21T14:00'`. MET Norway answers in UTC; `metno.ts` converts on
   * the way in. Kept in the circuit's local time rather than
   * converted to UTC: "cloud cover at 14:00" is what a session sheet says,
   * and re-deriving that from a UTC instant would need the circuit's
   * timezone threaded through here too, for a value this file never
   * computes with — it only filters and displays.
   */
  readonly time: string;
  /** Percent, 0–100. Null when the forecast omitted it for that hour. */
  readonly cloudCoverPercent: number | null;
  /** Millimetres. Null when the forecast omitted it for that hour. */
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
   * The event's first day is further out than the provider forecasts. Fetching
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
      readonly allHourly: readonly HourlyForecastPoint[];
      readonly eventDays: readonly string[];
    }
  /** Usable and recent. */
  | {
      readonly state: 'fresh';
      readonly fetchedAt: string;
      readonly ageMinutes: number;
      /**
       * The hours falling on the event's own days.
       *
       * This is what decides the state — a cache that does not reach the event
       * at all is `no-data-yet` — and it is what "the weekend" means when the
       * panel summarises one.
       */
      readonly hourly: readonly HourlyForecastPoint[];
      /**
       * Every hour the cache holds, event days and the rest alike.
       *
       * Kept beside `hourly` rather than replacing it because the two answer
       * different questions. The panel pages through the whole forecast — a
       * weekend is decided in the days before it, and "is the front arriving
       * Thursday or Saturday" cannot be read off the event days alone — while
       * anything that speaks *about the event* keeps using `hourly` and so
       * cannot accidentally average a Tuesday into it.
       */
      readonly allHourly: readonly HourlyForecastPoint[];
      /** Which of those days are the event's, local `YYYY-MM-DD`, so the panel can mark them. */
      readonly eventDays: readonly string[];
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

  // The event's days, in the order the forecast runs, and only the ones it
  // actually covers — an event day past the horizon has no tab to offer.
  const eventDays: string[] = [];
  for (const point of relevant) {
    const day = point.time.slice(0, 10);
    if (eventDays[eventDays.length - 1] !== day) eventDays.push(day);
  }

  return {
    state: ageMinutes <= freshWithinMinutes ? 'fresh' : 'stale',
    fetchedAt: input.cached.fetchedAt,
    ageMinutes,
    hourly: relevant,
    allHourly: input.cached.hourly,
    eventDays,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shaping a forecast for display
 *
 * Everything below turns the flat hourly series into the things a panel draws:
 * days, a per-day summary, and a condition token. It lives here rather than in
 * the screen for the same reason `resolveForecastDisplay` does — it is a
 * decision about what the numbers mean, it is pure, and it is worth a test.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One event day's worth of hours, in the order the provider returned them. */
export interface ForecastDay {
  /** Local `YYYY-MM-DD`. */
  readonly date: string;
  readonly points: readonly HourlyForecastPoint[];
}

/**
 * Split the hourly series into calendar days.
 *
 * An event spans days and a chart of 48 undifferentiated columns says nothing;
 * a photographer picks a day and reads that day. Order follows the series
 * rather than being re-sorted: the provider returns time-ascending, and imposing
 * a sort here would quietly paper over a response that did not.
 */
export function groupForecastByDay(
  hourly: readonly HourlyForecastPoint[],
): ForecastDay[] {
  const days: ForecastDay[] = [];
  let current: { date: string; points: HourlyForecastPoint[] } | null = null;

  for (const point of hourly) {
    const date = point.time.slice(0, 10);
    if (!current || current.date !== date) {
      current = { date, points: [] };
      days.push(current);
    }
    current.points.push(point);
  }
  return days;
}

/**
 * What the sky is doing, coarsely.
 *
 * Five bands rather than a percentage because the panel draws an icon from
 * this, and there is no icon for "68%". The cloud thresholds follow the usual
 * met convention (few / scattered / broken / overcast) collapsed to what
 * changes a photograph. Rain wins over any cloud band: at 0.2mm/h upwards the
 * decision being made is about a rain cover, not about light.
 */
export type SkyCondition = 'clear' | 'partly' | 'cloudy' | 'overcast' | 'rain';

/** Rain from this many mm in an hour is worth calling rain rather than damp air. */
export const RAIN_THRESHOLD_MM = 0.2;

export function skyCondition(
  cloudCoverPercent: number | null,
  precipitationMm: number | null,
): SkyCondition {
  if (precipitationMm !== null && precipitationMm >= RAIN_THRESHOLD_MM) return 'rain';
  if (cloudCoverPercent === null) return 'cloudy';
  if (cloudCoverPercent < 15) return 'clear';
  if (cloudCoverPercent < 50) return 'partly';
  if (cloudCoverPercent < 85) return 'cloudy';
  return 'overcast';
}

/**
 * The hours a photographer is plausibly shooting, used to keep the "clearest"
 * window off 03:00. Deliberately generous at both ends — a summer event at Spa
 * has usable light well before 07:00 and well after 20:00.
 */
const DAYLIGHT_FROM_HOUR = 5;
const DAYLIGHT_TO_HOUR = 21;

/** Length of the window `clearestWindow` looks for, in hours. */
const CLEAREST_WINDOW_HOURS = 3;

export interface DaySummary {
  /** Mean cloud cover across the day's hours, or null when no hour reported it. */
  readonly meanCloudPercent: number | null;
  /** Total precipitation across the day, mm. */
  readonly totalRainMm: number;
  /** How many of the day's hours are at or above `RAIN_THRESHOLD_MM`. */
  readonly rainHours: number;
  /** The day taken as a whole, for the header icon. */
  readonly condition: SkyCondition;
  /**
   * The clearest run of daylight hours, or null when the day has none in
   * range.
   *
   * Named for what it measures — least cloud — and not "best light", which it
   * is not: flat overcast is the right sky for a lot of what gets shot at a
   * circuit, and the app has no business ranking that. It reports where the
   * sun is most likely to be out and leaves the judgement alone.
   */
  readonly clearestWindow: {
    readonly fromHour: number;
    readonly toHour: number;
    readonly meanCloudPercent: number;
  } | null;
}

/** The hour-of-day of a point's local time, or null if it is not shaped like one. */
function hourOf(time: string): number | null {
  const m = /T(\d{2}):/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The `CLEAREST_WINDOW_HOURS`-long run of daylight hours with the least cloud.
 *
 * A sliding window over consecutive hours only — a run broken by a missing
 * hour is not a run, because the gap is exactly where the weather could have
 * done anything. Ties go to the earlier window: morning light at a circuit is
 * usually the one you can still get to.
 */
function clearestWindow(
  points: readonly HourlyForecastPoint[],
): DaySummary['clearestWindow'] {
  const usable = points
    .map((p) => ({ hour: hourOf(p.time), cloud: p.cloudCoverPercent }))
    .filter(
      (p): p is { hour: number; cloud: number } =>
        p.hour !== null &&
        p.cloud !== null &&
        p.hour >= DAYLIGHT_FROM_HOUR &&
        p.hour <= DAYLIGHT_TO_HOUR,
    );
  if (usable.length === 0) return null;

  let best: { fromHour: number; toHour: number; meanCloudPercent: number } | null = null;
  for (let i = 0; i + CLEAREST_WINDOW_HOURS <= usable.length; i++) {
    const run = usable.slice(i, i + CLEAREST_WINDOW_HOURS);
    // Consecutive hours, or it is not a window.
    if (run[run.length - 1]!.hour - run[0]!.hour !== CLEAREST_WINDOW_HOURS - 1) continue;
    const avg = mean(run.map((r) => r.cloud))!;
    if (best === null || avg < best.meanCloudPercent) {
      best = {
        fromHour: run[0]!.hour,
        toHour: run[run.length - 1]!.hour,
        meanCloudPercent: avg,
      };
    }
  }

  // A day with fewer usable hours than a full window still has a clearest
  // stretch; report the whole of what there is rather than nothing.
  if (best === null) {
    const avg = mean(usable.map((u) => u.cloud))!;
    return {
      fromHour: usable[0]!.hour,
      toHour: usable[usable.length - 1]!.hour,
      meanCloudPercent: avg,
    };
  }
  return best;
}

/** Roll one day's hours up into the numbers the panel's header states. */
export function summariseDay(points: readonly HourlyForecastPoint[]): DaySummary {
  const clouds = points
    .map((p) => p.cloudCoverPercent)
    .filter((c): c is number => c !== null);
  const rains = points
    .map((p) => p.precipitationMm)
    .filter((r): r is number => r !== null);

  const meanCloudPercent = mean(clouds);
  const totalRainMm = rains.reduce((a, b) => a + b, 0);
  const rainHours = rains.filter((r) => r >= RAIN_THRESHOLD_MM).length;

  return {
    meanCloudPercent,
    totalRainMm,
    rainHours,
    // A day is "rain" if any hour of it is: the total can stay small while a
    // single hour soaks the session you came for.
    condition:
      rainHours > 0
        ? 'rain'
        : skyCondition(meanCloudPercent, null),
    clearestWindow: clearestWindow(points),
  };
}
