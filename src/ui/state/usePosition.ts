/**
 * Where you actually are — spec §5.1, §5.14.
 *
 * The navigator is worthless without this: "leave in 6 minutes" assumes it
 * knows where you are leaving from. Everything else in the app works fine
 * offline and stationary; this is the one piece that needs the device.
 *
 * ── Permission is asked for once, and refusal is a normal state ────────────
 * Location is refused often and for good reasons. Nothing here retries, nags,
 * or degrades the rest of the app when it is denied — the planner still shows
 * stop-to-stop times, it just cannot show "from here". A hook that treated
 * denial as an error would push every caller into handling a failure that is
 * really a preference.
 *
 * ── Accuracy is reported, not hidden ──────────────────────────────────────
 * A fix with 400m of error at a circuit where spots are 80m apart is worse than
 * no fix, because it looks authoritative. `accuracyMetres` comes back with the
 * position so the UI can show the uncertainty rather than a confident dot in
 * the wrong place.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import type { LatLon } from '../../core/domain/common';

export type PositionStatus =
  | 'idle'
  | 'requesting'
  | 'watching'
  | 'denied'
  | 'unavailable';

export interface Fix {
  readonly position: LatLon;
  /** Reported horizontal accuracy in metres, when the platform gives one. */
  readonly accuracyMetres: number | null;
  /** Device heading in degrees from north, when moving. */
  readonly headingDegrees: number | null;
  readonly at: number;
}

export function usePosition(enabled: boolean) {
  const [status, setStatus] = useState<PositionStatus>('idle');
  const [fix, setFix] = useState<Fix | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const stop = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      setStatus('idle');
      return;
    }

    let cancelled = false;

    (async () => {
      setStatus('requesting');
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!granted) {
          setStatus('denied');
          return;
        }

        subscription.current = await Location.watchPositionAsync(
          {
            // Circuits are big and spots are tens of metres apart; the balanced
            // preset drifts far enough to point at the wrong corner. The cost
            // is battery, on a day when the phone is mostly in a pocket.
            accuracy: Location.Accuracy.High,
            distanceInterval: 5,
            timeInterval: 3000,
          },
          (reading) => {
            if (cancelled) return;
            setFix({
              position: {
                latitude: reading.coords.latitude,
                longitude: reading.coords.longitude,
              },
              accuracyMetres: reading.coords.accuracy ?? null,
              headingDegrees:
                reading.coords.heading !== null &&
                reading.coords.heading !== undefined &&
                reading.coords.heading >= 0
                  ? reading.coords.heading
                  : null,
              at: reading.timestamp,
            });
            setStatus('watching');
          },
        );
      } catch {
        // No location services, an emulator without a mock, or a browser
        // refusing over plain HTTP. Not an error state worth surfacing beyond
        // "we cannot do this here".
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, stop]);

  return { status, fix };
}
