/**
 * Weather forecast state for the event screen — B3-1 wiring.
 *
 * Reads whatever is cached for the active event, resolves it against the
 * event's own dates through `resolveForecastDisplay`, and exposes a manual
 * `refresh`. Deliberately no fetch-on-mount: spec §1.4 wants a signal-gated
 * action, not a network call fired every time this screen is opened, which
 * `weather.ts`'s own header explains at length.
 */
import { useCallback, useEffect, useState } from 'react';

import type { LatLon } from '../../core/domain/common';
import type { Event } from '../../core/domain/event';
import type { EventId } from '../../core/domain/ids';
import {
  resolveForecastDisplay,
  type CachedForecast,
  type ForecastDisplay,
} from '../../core/logic/forecast';
import { getCachedForecast, refreshForecast } from '../../storage-local/weather';

/**
 * @param event the active event's dates, or null when there is none — in
 * which case the display is `no-dates` and nothing is ever fetched.
 * @param eventId the active event's id, for the cache key.
 * @param position the circuit's position, for the fetch. Null defers the
 * fetch (there is nowhere to ask for a forecast).
 * @param timezone the circuit's IANA timezone, for the fetch.
 */
export function useWeather(
  event: Pick<Event, 'startDate' | 'endDate'> | null,
  eventId: EventId | null,
  position: LatLon | null,
  timezone: string | null,
) {
  const [cached, setCached] = useState<CachedForecast | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Ticks the age of a cached forecast forward without a refetch.
   *
   * "Fresh" would otherwise silently read as "fresh" forever within one
   * session — the very failure `resolveForecastDisplay` exists to avoid, see
   * its header. A minute is plenty for something that only has to notice
   * crossing the 3-hour freshness line, not track seconds.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    setCached(eventId ? await getCachedForecast(eventId) : null);
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refresh = useCallback(async () => {
    if (!eventId || !position || !timezone) return;
    setRefreshing(true);
    try {
      const result = await refreshForecast({ eventId, position, timezone });
      setCached(result.forecast);
      setError(result.error);
    } finally {
      setRefreshing(false);
    }
  }, [eventId, position, timezone]);

  const display: ForecastDisplay = event
    ? resolveForecastDisplay({ event, cached, now })
    : { state: 'no-dates' };

  return { display, refresh, refreshing, error, reload };
}
