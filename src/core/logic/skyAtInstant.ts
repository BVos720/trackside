/**
 * "Which `SkyCondition` applies at this instant" — B1.
 *
 * `forecast.ts` resolves an hourly series into `SkyCondition` per hour
 * (`skyCondition`), but the map's clock (`useMapClock`) scrubs continuously,
 * not hour by hour. This file bridges the two: given the hourly series and an
 * arbitrary instant, which hour's condition is the map's weather overlay
 * showing right now.
 *
 * Pure logic, same shape as the rest of `core/logic/` — no network, no
 * storage, a `Date` and a timezone string in, a `SkyCondition` out.
 */
import { skyCondition, type HourlyForecastPoint, type SkyCondition } from './forecast';

/**
 * How far from an hourly sample's own timestamp an instant may fall and still
 * count as described by that sample. Forecast points are one per hour, so a
 * sample is the nearest thing to the truth for up to 60 minutes either side
 * of its own timestamp. Farther than that — before the series starts, after
 * it ends, or a genuine gap in the middle where Open-Meteo skipped an hour —
 * no sample is actually describing that moment, and the honest answer is
 * `'unknown'`, not a nearby guess.
 */
const MAX_SAMPLE_DISTANCE_MINUTES = 60;

/**
 * Format `date` as the circuit-local wall-clock ISO string `HourlyForecastPoint.time`
 * uses: `YYYY-MM-DDTHH:MM`, no offset — Open-Meteo's shape when a `timezone`
 * param is passed (see `forecast.ts`'s header on `HourlyForecastPoint`).
 *
 * Built from `Intl.DateTimeFormat` parts rather than manual UTC-offset math:
 * IANA zone offsets are not fixed (DST, and some zones have changed offset
 * historically), and `Intl` carries that data instead of this file
 * reimplementing it. The device's own timezone never enters this — `timeZone`
 * is always the circuit's, passed in by the caller.
 */
function formatLocalIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Parse a `YYYY-MM-DDTHH:MM`-shaped local string into a number of minutes,
 * for distance comparisons only — this is not a real instant (the string
 * carries no zone), just a way to measure "how far apart" two such strings
 * are without re-parsing digits by hand at every call site. `Date.UTC` is
 * used purely as an arbitrary linear clock here, not to claim the value is a
 * UTC instant.
 */
function toComparableMinutes(isoLocal: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(isoLocal);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) /
    60_000
  );
}

/**
 * Which `SkyCondition` applies at `at`, an arbitrary instant, for a circuit
 * in `timezone`.
 *
 * Picks the nearest hourly sample to `at` (converted to the circuit's local
 * wall clock first — never the device's), within `MAX_SAMPLE_DISTANCE_MINUTES`.
 * This is the "enclosing hour" for anything within an hour's sample: sky
 * condition is categorical, not a number, so there is nothing to interpolate
 * between two neighbouring samples — one of them is picked, not blended.
 * Ties (an instant exactly as close to the hour before as the hour after) go
 * to the earlier sample, the same rule `clearestWindow` in `forecast.ts`
 * uses for its own ties, and rely on `hourly` running time-ascending (the
 * convention `groupForecastByDay` also assumes).
 *
 * An instant with no sample within range — before the series starts, after
 * it ends, a genuine gap in the middle, or an empty series entirely — is
 * `'unknown'`. See the file header on why that is not `'clear'`.
 */
export function skyConditionAt(
  hourly: readonly HourlyForecastPoint[],
  at: Date,
  timezone: string,
): SkyCondition | 'unknown' {
  if (hourly.length === 0) return 'unknown';

  const atMinutes = toComparableMinutes(formatLocalIso(at, timezone));

  let nearest: HourlyForecastPoint | null = null;
  let nearestDistance = Infinity;

  for (const point of hourly) {
    const pointMinutes = toComparableMinutes(point.time);
    if (Number.isNaN(pointMinutes)) continue; // malformed sample — not this function's problem to repair
    const distance = Math.abs(pointMinutes - atMinutes);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  if (nearest === null || nearestDistance > MAX_SAMPLE_DISTANCE_MINUTES) {
    return 'unknown';
  }
  return skyCondition(nearest.cloudCoverPercent, nearest.precipitationMm);
}
