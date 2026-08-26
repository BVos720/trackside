/**
 * Weather forecasts — B3-1. Fetch + cache boundary, spec §1.4.
 *
 * Talks to MET Norway's Locationforecast (https://api.met.no/, free, no API
 * key) and persists the result against an event. `core/logic/forecast.ts` is the pure
 * counterpart: it decides what a cached forecast *means* (fresh, stale,
 * too-far-out, nothing yet) — this file only ever moves bytes, the same split
 * `ollama.ts` uses for the timetable extractor.
 *
 * ── Why hourly cloud cover and precipitation, not a daily summary ──────────
 * A daily "partly cloudy, high 19°" tells a photographer nothing about
 * whether the 14:00 session is backlit or flat. What matters here is the
 * cloud cover and rain *for the hours the event is actually running*, which
 * is why this file reads only `cloud_area_fraction` and
 * `precipitation_amount` out of the response and ignores the rest of it —
 * no temperature, no wind, no fields this app has no use for.
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
 *
 * ── Why MET Norway rather than Open-Meteo ──────────────────────────────────
 * This used to call Open-Meteo. Its free tier is non-commercial, so the
 * moment Trackside charges for anything — and the plan is that it will, see
 * TASKS-premium.md — that call stops being licensed. MET Norway's
 * Locationforecast is free for commercial use too, needs no key either, and
 * its conditions are ones this app should meet regardless: an identifying
 * User-Agent, no hammering, and visible credit. See `metno.ts` for the
 * response-shape differences that came with the switch.
 */
import type { LatLon } from '../core/domain/common';
import type { EventId } from '../core/domain/ids';
import type { CachedForecast, HourlyForecastPoint } from '../core/logic/forecast';
import { kv } from './kv';
import { parseMetNoForecast, toCircuitLocalTime } from './metno';

const API_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

/**
 * Who is calling, as MET Norway's terms require.
 *
 * They block generic and absent User-Agents outright — this is not a courtesy
 * header, it is the condition of use, and it must carry a way to reach whoever
 * is responsible if a client starts misbehaving. The repository URL serves
 * that purpose without putting a personal email address into every outbound
 * request.
 *
 * NOT YET REACHABLE. The repository is private, so this URL 404s. MET Norway
 * accept a URL or an email, but it has to resolve to something that can be
 * contacted — an unreachable one is closer to no contact than to compliance.
 * Before release either make the repository public, or swap this for the app's
 * own site or a support address. It is one constant, and nothing else reads it.
 *
 * See https://api.met.no/doc/TermsOfService. Keep the version in step with
 * `app.json` when it changes; MET use it to identify badly-behaved releases.
 *
 * On web this header is unsettable — browsers forbid overriding User-Agent —
 * so the browser sends its own, which is identifying enough not to be blocked.
 * Nothing to work around; the native builds are what matter here.
 */
const USER_AGENT = 'Trackside/1.0 (https://github.com/BVos720/trackside)';

/**
 * Coordinates, truncated the way MET Norway asks for.
 *
 * They request no more than four decimals, because otherwise every phone
 * standing a few metres apart misses their cache and asks the models for an
 * answer that would have been identical. Four decimals is around 11 metres —
 * orders of magnitude finer than any weather model's grid, so nothing is lost
 * by rounding, and their rate limiting is friendlier to clients that comply.
 */
function coordinate(value: number): string {
  return value.toFixed(4);
}

const CACHE_KEY_PREFIX = 'trackside.weather.';
const CACHE_KEY_VERSION = 'v1';

function cacheKey(eventId: EventId): string {
  return `${CACHE_KEY_PREFIX}${eventId}.${CACHE_KEY_VERSION}`;
}

/**
 * A fetch to MET Norway failed — no signal, DNS down, a non-2xx response, or
 * a response shaped nothing like the documented one. Always catchable:
 * offline is the expected failure mode for this app (spec §1.4), not a bug,
 * so nothing in this file lets it propagate as an unhandled rejection.
 */
export class WeatherFetchError extends Error {
  constructor(cause: string) {
    super(`Could not fetch a forecast from MET Norway (${cause}).`);
    this.name = 'WeatherFetchError';
  }
}

/**
 * Fetch the hourly forecast for a position, in that position's own local
 * time.
 *
 * `timezone` is the circuit's IANA zone (`Circuit.timezone`). MET Norway
 * answers in UTC and offers no way to ask otherwise, so `metno.ts` converts
 * every hour into that zone on the way through. It has to be the circuit's
 * zone and not the phone's: a plan built at home for a circuit abroad must
 * show session times in *that circuit's* local time regardless of where the
 * phone answering this fetch happens to be — the same reasoning
 * `Circuit.timezone`'s own doc comment gives, and the reason
 * `HourlyForecastPoint.time` in `core/logic/forecast.ts` is documented as
 * local rather than UTC.
 *
 * Throws `WeatherFetchError` on any failure — no network, a non-OK response,
 * or a response with no usable hours. Callers wanting the offline-first
 * fallback behaviour should use `refreshForecast` instead of calling this
 * directly.
 */
export async function fetchForecast(input: {
  readonly position: LatLon;
  readonly timezone: string;
  readonly now?: Date;
}): Promise<CachedForecast> {
  const url = new URL(API_URL);
  url.searchParams.set('lat', coordinate(input.position.latitude));
  url.searchParams.set('lon', coordinate(input.position.longitude));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (e) {
    throw new WeatherFetchError(e instanceof Error ? e.message : String(e));
  }

  if (!response.ok) {
    throw new WeatherFetchError(`HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new WeatherFetchError(
      `bad response body: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const hourly = parseMetNoForecast(body, input.timezone);
  if (hourly.length === 0) {
    // Two very different failures land here, and they must not read the same.
    // "They sent nothing usable" is a server-side problem that will pass. "This
    // device cannot resolve the circuit's timezone" is an engine limitation —
    // the conversion in metno.ts needs Intl with timezone data — and it would
    // otherwise be indistinguishable from being offline, on a device where
    // weather silently never works and no bug report could explain why.
    const zoneResolves =
      toCircuitLocalTime('2026-01-01T12:00:00Z', input.timezone) !== null;
    throw new WeatherFetchError(
      zoneResolves
        ? 'response had no usable hourly data'
        : `this device could not resolve the timezone ${input.timezone}`,
    );
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
