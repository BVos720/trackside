/**
 * Which way the phone is pointing — spec: task file, Section C1.
 *
 * The sun dial (C2) needs to rotate `sunAzimuth − heading` so the mark sits
 * where the sun actually is relative to where the phone faces (task file
 * C0/C2: egocentric markers, north-up map — the map itself never rotates).
 * This hook owns only the sensor: reading it, smoothing it, and reporting
 * honestly when there is nothing usable to report.
 *
 * ── True north, not magnetic ────────────────────────────────────────────────
 * `suncalc` (via `src/core/logic/sun.ts`) gives azimuth from *true* north.
 * `expo-location`'s heading reading exposes both `trueHeading` and
 * `magHeading`; unlike `usePosition.ts` (which falls back to `magHeading` for
 * a rough facing cone), this hook feeds a value that gets subtracted from a
 * true-north azimuth, so a magnetic fallback would put the sun mark a few
 * degrees off in a way nobody could explain by looking at it. `trueHeading`
 * reads `-1` before the platform has a geomagnetic model for where you are;
 * that is surfaced as `heading: null` ("no usable heading"), never coerced to
 * 0 — a fabricated 0° is a rotation that is wrong and looks confident, which
 * is worse than admitting there isn't one. Downstream (C2) is told to fall
 * back to north-up and say so when this hook reports `null`.
 *
 * ── Smoothing that wraps at 360°/0° ────────────────────────────────────────
 * Raw compass output jitters several degrees a second. A naive low-pass
 * filter (`prev + alpha * (next - prev)`) breaks across the 359°→0°
 * boundary: averaging 359° and 1° must land near 0°, not swing through 180°.
 * `smoothHeading` below takes the short way around the circle instead, and is
 * exported and pure precisely so it can be unit-tested without touching
 * `expo-location` at all.
 *
 * ── Permission handling, matching `usePosition.ts` ─────────────────────────
 * Same convention as the position hook: request the foreground permission
 * once when enabled, treat refusal as a normal (not error) state, and do not
 * retry or nag. `usePosition` already requests foreground location
 * permission for its own heading watch — that grant is shared with this
 * hook's `watchHeadingAsync` (both are the same OS permission), but this hook
 * makes its own `requestForegroundPermissionsAsync` call rather than
 * depending on another hook instance having already asked, so it works
 * correctly whether or not `usePosition` is mounted alongside it.
 *
 * ── Only subscribe while wanted ─────────────────────────────────────────────
 * `enabled` (default `true`) lets a caller — C2, from `MapScreen.tsx`, once
 * wired — stop the compass watch when its screen loses focus, without this
 * hook needing to know anything about navigation/focus itself. Unsubscribes
 * on unmount and whenever `enabled` flips to `false`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

export type HeadingStatus =
  | 'idle'
  | 'requesting'
  | 'watching'
  | 'denied'
  | 'unavailable';

export interface UseHeadingResult {
  /**
   * True-north compass bearing in degrees, smoothed. `null` means "no usable
   * heading" — permission not granted, the sensor errored, or the platform
   * hasn't reported a calibrated `trueHeading` yet. Never a fabricated 0°.
   */
  readonly heading: number | null;
  readonly status: HeadingStatus;
}

/** Normalises any finite angle to the `[0, 360)` range. */
function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Low-pass filter for a compass bearing, wrapping correctly across the
 * 360°/0° boundary.
 *
 * Naive linear smoothing (`prev + alpha * (next - prev)`) is only correct on
 * a line, not a circle: averaging 359° and 1° that way produces 180°, which
 * is the exact opposite of the right answer (~0°). This instead finds the
 * signed shortest angular distance from `previous` to `next` (in
 * `[-180, 180)`) and steps `alpha` of the way along *that*, so the result
 * always takes the short way around the circle.
 *
 * @param previous The last smoothed heading, or `null` if there isn't one
 *   yet (first reading, or the hook just came back from "unavailable").
 * @param next The latest raw reading, degrees `[0, 360)`.
 * @param alpha How much of the gap to close towards `next`, `0..1`. `0`
 *   ignores `next` entirely (stays at `previous`); `1` snaps straight to it.
 */
export function smoothHeading(
  previous: number | null,
  next: number,
  alpha: number,
): number {
  const target = normalizeAngle(next);
  if (previous === null) return target;

  const from = normalizeAngle(previous);
  // Signed shortest distance from `from` to `target`, in (-180, 180].
  let delta = (target - from) % 360;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;

  return normalizeAngle(from + alpha * delta);
}

/** How much each new reading pulls the smoothed heading towards it. Lower is
 * steadier (more lag), higher tracks faster (more jitter). */
const SMOOTHING_ALPHA = 0.2;

export function useHeading(enabled: boolean = true): UseHeadingResult {
  const [status, setStatus] = useState<HeadingStatus>('idle');
  const [heading, setHeading] = useState<number | null>(null);
  const headingSub = useRef<Location.LocationSubscription | null>(null);
  // Smoothing state lives in a ref, not `heading` itself: `smoothHeading`
  // needs the previous *smoothed* value on every tick, and re-reading it out
  // of `heading` state inside the subscription callback would close over a
  // stale value across renders.
  const smoothed = useRef<number | null>(null);

  const stop = useCallback(() => {
    headingSub.current?.remove();
    headingSub.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      smoothed.current = null;
      setHeading(null);
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

        headingSub.current = await Location.watchHeadingAsync((reading) => {
          if (cancelled) return;

          // -1 before the platform has a geomagnetic model calibrated for
          // this location — an explicit "no usable heading", not a value to
          // smooth towards. Reset the smoothing state too, so heading coming
          // back later starts fresh rather than snapping from a stale value.
          if (reading.trueHeading < 0 || !Number.isFinite(reading.trueHeading)) {
            smoothed.current = null;
            setHeading(null);
            return;
          }

          smoothed.current = smoothHeading(
            smoothed.current,
            reading.trueHeading,
            SMOOTHING_ALPHA,
          );
          setHeading(smoothed.current);
        });

        if (cancelled) {
          headingSub.current?.remove();
          headingSub.current = null;
          return;
        }
        setStatus('watching');
      } catch {
        // No compass on this device/emulator, or the platform refused the
        // watch outright. Same treatment as `usePosition.ts`: not an error
        // worth surfacing beyond "unavailable here".
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, stop]);

  return { heading, status };
}
