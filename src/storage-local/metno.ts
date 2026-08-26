/**
 * Reading MET Norway's forecast response.
 *
 * Pure: no network, no storage. `weather.ts` fetches and caches; this turns
 * one JSON body into the two numbers per hour the app actually uses. Split out
 * because it is the part with rules in it, and because `weather.ts` imports
 * the kv store and is therefore awkward to test.
 *
 * ── Why MET Norway and not Open-Meteo ─────────────────────────────────────
 * Open-Meteo is excellent and needs no key, but its free tier is
 * non-commercial. The moment Trackside charges for anything, using it stops
 * being licensed. MET Norway's Locationforecast is free *including*
 * commercial use, global, and needs no key either — the trade is a handful of
 * conditions, all of which this app should honour anyway:
 *
 *   • an identifying User-Agent with contact details (they block generic ones)
 *   • respect the caching headers rather than re-fetching
 *   • credit MET Norway in the app
 *
 * See https://api.met.no/doc/TermsOfService.
 *
 * ── The two shape differences that matter ─────────────────────────────────
 * **Times are UTC.** Open-Meteo could be asked for a circuit's local time
 * directly; MET Norway always answers in Zulu. `HourlyForecastPoint.time` is
 * documented as *local* time for the circuit, because "cloud cover at 14:00"
 * is what a session sheet says — so the conversion happens here, once, rather
 * than threading a timezone through the display layer.
 *
 * **Precipitation is a forward-looking bucket**, not an instant reading. It
 * lives under `next_1_hours` near the present and `next_6_hours` further out,
 * because the model's resolution drops with distance. Cloud cover is an
 * instant value throughout.
 */
import type { HourlyForecastPoint } from '../core/logic/forecast';

/** Only the fields this app reads. Everything else in the response is ignored. */
interface MetNoResponse {
  readonly properties?: {
    readonly timeseries?: unknown;
  };
}

interface MetNoEntry {
  readonly time?: unknown;
  readonly data?: {
    readonly instant?: { readonly details?: Record<string, unknown> };
    readonly next_1_hours?: { readonly details?: Record<string, unknown> };
    readonly next_6_hours?: { readonly details?: Record<string, unknown> };
  };
}

/**
 * A UTC instant as wall-clock time at the circuit, `YYYY-MM-DDTHH:mm`.
 *
 * Matches the shape `HourlyForecastPoint.time` documents, which the display
 * layer compares against event dates as plain strings.
 *
 * Returns null rather than guessing when the input is unparseable or the zone
 * is not one this device knows. A forecast hour that cannot be placed on a day
 * is noise, and dropping it is better than showing weather against the wrong
 * session.
 */
export function toCircuitLocalTime(
  utcIso: string,
  timeZone: string,
): string | null {
  const instant = new Date(utcIso);
  if (Number.isNaN(instant.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // h23 rather than hour12:false — some engines render midnight as "24"
      // under the latter, which would produce an hour no date parser accepts.
      hourCycle: 'h23',
    }).formatToParts(instant);

    const at = (type: string): string | undefined =>
      parts.find((p) => p.type === type)?.value;

    const year = at('year');
    const month = at('month');
    const day = at('day');
    const hour = at('hour');
    const minute = at('minute');

    if (!year || !month || !day || !hour || !minute) return null;
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    // An unknown IANA zone, or an engine without full ICU data.
    return null;
  }
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Precipitation for an hour, from whichever bucket the entry carries.
 *
 * `next_1_hours` is the one that means "this hour". `next_6_hours` is the
 * fallback further into the forecast, where the model stops resolving to
 * single hours — using it is a deliberate over-estimate for that hour rather
 * than reporting nothing, because "some rain in this six-hour block" is still
 * the answer to "should I bring a cover".
 */
function precipitationFrom(entry: MetNoEntry): number | null {
  const oneHour = numberOrNull(
    entry.data?.next_1_hours?.details?.precipitation_amount,
  );
  if (oneHour !== null) return oneHour;
  return numberOrNull(entry.data?.next_6_hours?.details?.precipitation_amount);
}

/**
 * Turn a response body into hourly points in the circuit's local time.
 *
 * Defensive rather than trusting, for the same reason the Open-Meteo parser
 * was: this app has no control over a third-party response shape, and a
 * malformed entry must cost that hour rather than the whole forecast.
 */
export function parseMetNoForecast(
  body: unknown,
  timeZone: string,
): HourlyForecastPoint[] {
  const series = (body as MetNoResponse)?.properties?.timeseries;
  if (!Array.isArray(series)) return [];

  const points: HourlyForecastPoint[] = [];

  for (const raw of series) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as MetNoEntry;

    if (typeof entry.time !== 'string' || entry.time === '') continue;
    const time = toCircuitLocalTime(entry.time, timeZone);
    if (time === null) continue;

    points.push({
      time,
      cloudCoverPercent: numberOrNull(
        entry.data?.instant?.details?.cloud_area_fraction,
      ),
      precipitationMm: precipitationFrom(entry),
    });
  }

  return points;
}
