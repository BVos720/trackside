/**
 * The scrub clock — the shared instant both the sun marker and the weather
 * overlay render at. Task file: "`useMapClock` is the shared contract between
 * the two objectives... the sun and the weather must be reading the *same
 * instant* or scrubbing desynchronises them, which is the one bug that makes
 * the whole feature feel broken." Both A (`SunDial`, via `SkyControl`) and B
 * (`WeatherOverlay`) read `now` from a single instance of this hook, wired up
 * one level above both in the eventual `B-wire` pass — this file owns none of
 * that wiring, only the clock itself.
 *
 * ── Live vs. scrubbed ───────────────────────────────────────────────────────
 * While live, `now` ticks forward on its own — the same shape as
 * `useWeather`'s own clock (see that file's header): a `setInterval`
 * re-reading `Date.now()` on a coarse cadence, because nothing downstream
 * needs second precision and a finer interval would just be more re-renders
 * for no visible gain.
 *
 * `scrubTo` marks the clock no longer live and pins `now` at the given
 * instant — it must NOT keep advancing from there, however long the strip
 * stays scrubbed. `resumeNow` is the only way back: it snaps `now` to the
 * real clock immediately (not the last-set scrub target) and re-arms the
 * live interval, so the "Now" control both jumps once and resumes following,
 * rather than jumping once and then sitting still again.
 */
import { useCallback, useEffect, useState } from 'react';

/** How often `now` advances while live. Matches `useWeather`'s cadence. */
const LIVE_TICK_MS = 30_000;

export interface MapClock {
  /** The instant everything (sun position, weather) should render at — a real Date/instant. */
  readonly now: Date;
  /** True when following the real clock; false while scrubbed away from it. */
  readonly isLive: boolean;
  /** Jump to an arbitrary instant. Marks the clock as no longer live. */
  scrubTo(at: Date): void;
  /** Snap back to the real clock and resume following it (ticks forward on its own again). */
  resumeNow(): void;
}

export function useMapClock(): MapClock {
  const [now, setNow] = useState(() => new Date());
  const [isLive, setIsLive] = useState(true);

  // Only ticks while live — once scrubbed, nothing should overwrite the
  // pinned instant on the next interval firing. Re-arms whenever `isLive`
  // flips back to true, which is what makes `resumeNow` "resume", not just
  // "jump once".
  useEffect(() => {
    if (!isLive) return undefined;
    const id = setInterval(() => setNow(new Date()), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [isLive]);

  const scrubTo = useCallback((at: Date) => {
    setIsLive(false);
    setNow(at);
  }, []);

  const resumeNow = useCallback(() => {
    setNow(new Date());
    setIsLive(true);
  }, []);

  return { now, isLive, scrubTo, resumeNow };
}
