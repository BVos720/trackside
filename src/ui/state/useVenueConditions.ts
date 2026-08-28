/**
 * What the sky is doing at a circuit right now.
 *
 * ── Why this exists next to useWeather ────────────────────────────────────
 * `useWeather` is scoped to an event: it answers "what will Saturday be
 * like", caches against the event id, and reports nothing at all when no
 * event is open. That is right for planning, and useless for the map, which
 * is most often looked at on the default map with no event in sight.
 *
 * This asks a smaller question — cover and rainfall for the hour on screen —
 * for the venue itself. Same provider, same endpoint, so it adds no third
 * party to PRIVACY.md's list.
 *
 * Held in memory only. A forecast that failed to arrive is worth nothing
 * tomorrow, and the event cache remains the thing that survives a restart.
 * Failure is silent by design: no signal at a circuit is the normal case, and
 * a map that works offline must not report an error for it — the sky simply
 * stays clear.
 */
import { useEffect, useMemo, useState } from 'react';

import type { LatLon } from '../../core/domain/common';
import { conditionsAt, type HourlyForecastPoint } from '../../core/logic/forecast';
import { toCircuitLocalTime } from '../../storage-local/metno';
import { fetchForecast } from '../../storage-local/weather';

export interface VenueConditions {
  /** Percent, 0–100. */
  readonly cover: number;
  /** Millimetres in the hour. */
  readonly rain: number;
}

export function useVenueConditions(
  position: LatLon,
  timezone: string,
  at: Date,
): VenueConditions {
  const [points, setPoints] = useState<readonly HourlyForecastPoint[]>([]);

  const { latitude, longitude } = position;

  useEffect(() => {
    let cancelled = false;

    void fetchForecast({ position: { latitude, longitude }, timezone })
      .then((cached) => {
        if (!cancelled) setPoints(cached.hourly);
      })
      .catch(() => {
        // Offline, rate-limited, or the endpoint is down. All three mean the
        // same thing here: no sky effects, and nothing worth interrupting for.
      });

    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, timezone]);

  return useMemo(() => {
    const local = toCircuitLocalTime(at.toISOString(), timezone);
    const point = local === null ? null : conditionsAt(points, local);
    return {
      // Null means the provider omitted it for that hour, which is not the
      // same as zero — but for drawing, "unknown" and "clear" look alike and
      // inventing cloud would be worse.
      cover: point?.cloudCoverPercent ?? 0,
      rain: point?.precipitationMm ?? 0,
    };
  }, [points, at, timezone]);
}
