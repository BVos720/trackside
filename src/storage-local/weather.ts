/**
 * Weather forecasts — B3-1. Fetch + cache boundary, spec §1.4.
 *
 * Talks to Open-Meteo (https://open-meteo.com/en/docs, free, no API key) and
 * persists the result against an event. `core/logic/forecast.ts` is the pure
 * counterpart: it decides what a cached forecast *means* (fresh, stale,
 * too-far-out, nothing yet) — this file only ever moves bytes, the same split
 * `ollama.ts` uses for the timetable extractor.
 *
 * ── Why hourly cloud cover and precipitation, not a daily summary ──────────
 * A daily "partly cloudy, high 19°" tells a photographer nothing about
 * whether the 14:00 session is backlit or flat. What matters here is the
 * cloud cover and rain *for the hours the event is actually running*, which
 * is why the Open-Meteo call below asks for `hourly=cloud_cover,precipitation`
 * and nothing else — no daily block, no current-conditions block, no fields
 * this app has no use for.
 *
 * ── Cached per event, not per circuit ───────────────────────────────────────
 * Two events at the same circuit months apart want independent forecasts —
 * caching by circuit would mean the second event's screen opens showing a
 * forecast for the first event's weekend. The event's own dates decide which
 * hours of the cached series are relevant; that filtering lives in
 * `resolveForecastDisplay` (`core/logic/forecast.ts`), not here.
 *
 * ── Offline-first, spec §1.4 ────────────────────────────────────────────────
 * `refreshForecast` is the one function a screen should call. It tries the
 * network, caches on success, and on failure falls back to whatever was
 * already cached rather than throwing — a marshal post at the Nordschleife
 * with no signal must still be able to open the forecast panel and see
 * *something*, even if it is Tuesday's data. What makes that safe rather than
 * misleading is `fetchedAt`: every cached forecast carries it, and
 * `core/logic/forecast.ts` is what turns "old" into a fact the UI states
 * rather than hides.
 */
import type { LatLon } from '../core/domain/common';
import type { EventId } from '../core/domain/ids';
import type { CachedForecast, HourlyForecastPoint } from '../core/logic/forecast';
import { kv } from './kv';

const API_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Open-Meteo's own forecast ceiling. Requested in full every time: this file
 * does not know an event's dates (only its id, for the cache key), so it
 * always asks for the widest window Open-Meteo will give it and lets
 * `resolveForecastDisplay` decide which hours of that window are relevant —
 * and refuse to fetch at all — see `MAX_FORECAST_HORIZON_DAYS` there, which
 * this intentionally matches.
 */
const FORECAST_DAYS = 16;

const CACHE_KEY_PREFIX = 'trackside.weather.';
const CACHE_KEY_VERSION = 'v1';

function cacheKey(eventId: EventId): string {
  return `${CACHE_KEY_PREFIX}${eventId}.${CACHE_KEY_VERSION}`;
}

/**
 * A fetch to Open-Meteo failed — no signal, DNS down, a non-2xx response, or
 * a response shaped nothing like the documented one. Always catchable:
 * offline is the expected failure mode for this app (spec §1.4), not a bug,
 * so nothing in this file lets it propagate as an unhandled rejection.
 */
export class WeatherFetchError extends Error {
  constructor(cause: string) {
    super(`Could not fetch a forecast from Open-Meteo (${cause}).`);
    this.name = 'WeatherFetchError';
  }
}

/** The shape of the fields this app actually reads from Open-Meteo's response. Everything else it returns is ignored. */
interface OpenMeteoResponse {
  readonly hourly?: {
    readonly time?: unknown;
    readonly cloud_cover?: unknown;
    readonly precipitation?: unknown;
  };
}

/**
 * Pull the three parallel arrays Open-Meteo returns into one array of points.
 *
 * Defensive rather than trusting: this app has no control over a third-party
 * API's response shape, and a malformed or short array here must degrade to
 * "fewer hours" rather than crash the fetch. `time` missing or non-string
 * drops that hour entirely — a point with no time is not placeable against
 * the event's days, so it is not useful data, it is noise.
 */
function parseHourly(body: OpenMeteoResponse): HourlyForecastPoint[] {
  const times = body.hourly?.time;
  if (!Array.isArray(times)) return [];
  const clouds = Array.isArray(body.hourly?.cloud_cover) ? body.hourly.cloud_cover : [];
  const precipitation = Array.isArray(body.hourly?.precipitation)
    ? body.hourly.precipitation
    : [];

  const points: HourlyForecastPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    if (typeof time !== 'string' || time === '') continue;
    const cloud = clouds[i];
    const rain = precipitation[i];
    points.push({
      time,
      cloudCoverPercent: typeof cloud === 'number' ? cloud : null,
      precipitationMm: typeof rain === 'number' ? rain : null,
    });
  }
  return points;
}

/**
 * Fetch the hourly forecast for a position, in that position's own local
 * time.
 *
 * `timezone` is the circuit's IANA zone (`Circuit.timezone`), passed through
 * explicitly rather than Open-Meteo's `timezone=auto`: a plan built at home
 * for a circuit abroad must show session times in *that circuit's* local
 * time regardless of where the phone answering this fetch happens to be —
 * the same reasoning `Circuit.timezone`'s own doc comment gives, and the
 * reason `HourlyForecastPoint.time` in `core/logic/forecast.ts` is documented
 * as local rather than UTC.
 *
 * Throws `WeatherFetchError` on any failure — no network, a non-OK response,
 * or a response with no usable `hourly.time`. Callers wanting the
 * offline-first fallback behaviour should use `refreshForecast` instead of
 * calling this directly.
 */
export async function fetchForecast(input: {
  readonly position: LatLon;
  readonly timezone: string;
  readonly now?: Date;
}): Promise<CachedForecast> {
  const url = new URL(API_URL);
  url.searchParams.set('latitude', String(input.position.latitude));
  url.searchParams.set('longitude', String(input.position.longitude));
  url.searchParams.set('hourly', 'cloud_cover,precipitation');
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));
  url.searchParams.set('timezone', input.timezone);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (e) {
    throw new WeatherFetchError(e instanceof Error ? e.message : String(e));
  }

  if (!response.ok) {
    throw new WeatherFetchError(`HTTP ${response.status}`);
  }

  let body: OpenMeteoResponse;
  try {
    body = (await response.json()) as OpenMeteoResponse;
  } catch (e) {
    throw new WeatherFetchError(
      `bad response body: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const hourly = parseHourly(body);
  if (hourly.length === 0) {
    throw new WeatherFetchError('response had no usable hourly data');
  }

  return {
    fetchedAt: (input.now ?? new Date()).toISOString(),
    hourly,
  };
}

/**
 * Read whatever is cached for `eventId`, or `null` if nothing has ever been
 * fetched — or if what is there is corrupt. A corrupt cache entry is treated
 * the same as an absent one: `core/logic/forecast.ts` already has a
 * `no-data-yet` state built for exactly "nothing usable here", and inventing
 * a second way to say the same thing at this layer would only give a future
 * caller two cases to handle instead of one.
 */
export async function getCachedForecast(
  eventId: EventId,
): Promise<CachedForecast | null> {
  const raw = await kv.get(cacheKey(eventId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CachedForecast>;
    if (typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.hourly)) {
      return null;
    }
    return { fetchedAt: parsed.fetchedAt, hourly: parsed.hourly as HourlyForecastPoint[] };
  } catch {
    return null;
  }
}

/** Persist `forecast` as the cached forecast for `eventId`, replacing whatever was there. */
async function saveCachedForecast(
  eventId: EventId,
  forecast: CachedForecast,
): Promise<void> {
  await kv.set(cacheKey(eventId), JSON.stringify(forecast));
}

/**
 * Drop the cached forecast for `eventId`.
 *
 * Not a domain delete — same distinction `kv.remove` itself documents:
 * nothing here is a tombstoned record with a sync story, it is a cache entry,
 * and this app has no shortage of reasons to want a clean one (an event's
 * dates changing enough that the old cached hours no longer land anywhere
 * near them, say). Not called anywhere yet; wiring is a later pass.
 */
export async function clearCachedForecast(eventId: EventId): Promise<void> {
  await kv.remove(cacheKey(eventId));
}

export interface RefreshForecastResult {
  /**
   * The best forecast available after the attempt: the freshly fetched one on
   * success, or whatever was already cached (however old) if the fetch
   * failed. `null` only when the fetch failed *and* nothing was cached
   * before — genuinely nothing to show.
   */
  readonly forecast: CachedForecast | null;
  /** Why the fetch failed, for showing the user alongside the fallback data. Null on success. */
  readonly error: string | null;
}

/**
 * Fetch a fresh forecast for an event's circuit and cache it — or, offline,
 * fall back to whatever was cached before.
 *
 * This is the one function most callers want. It never throws: a bad
 * connection at a circuit is the normal case this whole file exists to
 * handle, not an exceptional one, so the failure path returns a result like
 * the success path rather than rejecting. What the caller shows for a
 * fallback result — including how stale it is — is `resolveForecastDisplay`'s
 * job (`core/logic/forecast.ts`), fed the returned `forecast` and its
 * `fetchedAt`.
 */
export async function refreshForecast(input: {
  readonly eventId: EventId;
  readonly position: LatLon;
  readonly timezone: string;
  readonly now?: Date;
}): Promise<RefreshForecastResult> {
  try {
    const forecast = await fetchForecast(input);
    await saveCachedForecast(input.eventId, forecast);
    return { forecast, error: null };
  } catch (e) {
    const cached = await getCachedForecast(input.eventId);
    return {
      forecast: cached,
      error:
        e instanceof WeatherFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not fetch a forecast.',
    };
  }
}
