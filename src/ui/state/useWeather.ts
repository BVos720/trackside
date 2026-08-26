/**
 * Weather forecast state for the event screen — B3-1 wiring.
 *
 * Reads whatever is cached for the active event, resolves it against the
 * event's own dates through `resolveForecastDisplay`, and keeps it current on
 * its own. `refresh` is still exposed for the button, but nothing depends on
 * the button being pressed.
 *
 * ── Auto-refresh, and how it stays inside §1.4 ─────────────────────────────
 * This hook originally never fetched on its own: the forecast only existed if
 * you pressed "Fetch forecast", on the reasoning that §1.4 wants a
 * signal-gated action rather than a network call fired on every screen open.
 * That reading was too strict in one direction and not strict enough in the
 * other — a forecast nobody remembered to fetch is not offline-first, it is
 * just absent, and it left the panel showing "no forecast yet" for an event
 * two days away with the phone on wifi.
 *
 * What §1.4 actually rules out is *depending* on the network, and fetching
 * blind or repeatedly. So the refresh here is conditional on all of:
 *
 *   - the event's dates being close enough to forecast at all — the
 *     `too-far-out` state never fetches, so an event in November does not
 *     poll the forecast service every time it is opened;
 *   - there being nothing usable cached, or what is cached having gone stale
 *     (`resolveForecastDisplay` decides which, against the clock);
 *   - `RETRY_COOLDOWN_MS` having passed since the last attempt, so a circuit
 *     with no signal costs one failed request rather than one per render.
 *
 * `refreshForecast` never throws and falls back to the cache, so a failed
 * automatic attempt leaves the panel exactly as it was — with its age still
 * shown. Nothing here can turn into a spinner that never resolves.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
 * How long to wait before trying again after an automatic attempt.
 *
 * Fifteen minutes: long enough that a dead connection in a paddock is not
 * retried on every re-render, short enough that walking back into signal
 * fixes the panel without the user doing anything. A *manual* refresh ignores
 * this entirely — pressing the button is the user saying "try now".
 */
const RETRY_COOLDOWN_MS = 15 * 60_000;

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
   * crossing the 3-hour freshness line, not track seconds. It is also what
   * drives the automatic refresh below: the tick is what makes a forecast
   * turn stale while the screen is open, and turning stale is the trigger.
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

  /**
   * When the last automatic attempt was made, per event.
   *
   * A ref rather than state: writing it must not re-render, and it has to be
   * set *before* the await so two renders in the same tick cannot both get
   * past the cooldown check. Keyed by event id so switching events is not
   * blocked by the previous event's cooldown.
   */
  const lastAutoAttempt = useRef<{ eventId: EventId | null; at: number }>({
    eventId: null,
    at: 0,
  });

  const run = useCallback(
    async (opts: { manual: boolean }) => {
      if (!eventId || !position || !timezone) return;
      if (!opts.manual) {
        const last = lastAutoAttempt.current;
        if (last.eventId === eventId && Date.now() - last.at < RETRY_COOLDOWN_MS) {
          return;
        }
        lastAutoAttempt.current = { eventId, at: Date.now() };
      }
      setRefreshing(true);
      try {
        const result = await refreshForecast({ eventId, position, timezone });
        setCached(result.forecast);
        setError(result.error);
      } finally {
        setRefreshing(false);
      }
    },
    [eventId, position, timezone],
  );

  /** The button. Ignores the cooldown — pressing it is "try now". */
  const refresh = useCallback(() => run({ manual: true }), [run]);

  const display: ForecastDisplay = event
    ? resolveForecastDisplay({ event, cached, now })
    : { state: 'no-dates' };

  /**
   * Fetch when the panel has nothing usable, or what it has has aged out.
   *
   * `display.state` is the whole condition: `no-dates` and `too-far-out` are
   * states in which a fetch is meaningless, and `fresh` is one in which it is
   * unnecessary. That leaves exactly the two worth spending a request on.
   */
  const shouldFetch = display.state === 'no-data-yet' || display.state === 'stale';
  useEffect(() => {
    if (!shouldFetch || refreshing) return;
    void run({ manual: false });
  }, [shouldFetch, refreshing, run]);

  /**
   * Coming back to the app is the moment signal is most likely to have
   * changed — walking out of a tunnel of concrete grandstands, or off a plane.
   * Clearing the cooldown lets the effect above try again straight away
   * rather than waiting out the remainder of fifteen minutes.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      lastAutoAttempt.current = { eventId: null, at: 0 };
      setNow(new Date());
    });
    return () => sub.remove();
  }, []);

  return { display, refresh, refreshing, error, reload };
}
