/**
 * Pure day/time math behind `SkyControl`'s 24-hour light-quality strip (A3).
 *
 * Split out of `SkyControl.tsx` rather than defined alongside it, for one
 * concrete reason: `SkyControl.tsx` imports `react-native`, and this
 * project's `vitest.config.mts` deliberately keeps UI/component tests out of
 * its run (see that file's header — "will need jest-expo; they do not
 * belong in this config"). Importing anything from `SkyControl.tsx` in a
 * test — even just its pure exports — pulls in `react-native`'s own Flow-
 * typed source, which this project's plain-Node vitest setup cannot parse.
 * None of these functions touch React or React Native at all, so — like
 * `sun.ts` itself (spec §2.3: `core/` has no RN dependency by construction)
 * — they belong in `core/logic/` instead, where they're both framework-free
 * *and* already covered by the existing `vitest.config.mts` include glob
 * with no config changes needed.
 *
 * `SkyControl.tsx` imports these rather than redefining them.
 */
import type { LatLon } from '../domain/common';
import { LightQuality, lightQuality, solarPosition } from './sun';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

/** Midnight, local time, for whatever day `at` falls on. */
function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/**
 * Where `at` falls across its own calendar day, as a 0–1 fraction.
 *
 * Local time, deliberately: the strip is read off a phone in someone's hand,
 * not off the circuit's own timezone, so "local" here means the device's.
 * Clamped defensively so a `Date` a few ms either side of midnight (DST
 * transitions, floating-point edge cases) never reads as belonging to a
 * different day than the one it's actually drawn against.
 */
export function fractionOfDay(at: Date): number {
  const ms = at.getTime() - startOfLocalDay(at).getTime();
  return Math.min(1, Math.max(0, ms / MS_PER_DAY));
}

/** The instant at a given 0–1 fraction through `day`'s own calendar day. */
export function instantAtFraction(day: Date, fraction: number): Date {
  const clamped = Math.min(1, Math.max(0, fraction));
  return new Date(startOfLocalDay(day).getTime() + clamped * MS_PER_DAY);
}

export interface HourSample {
  readonly hour: number;
  readonly quality: LightQuality;
}

/**
 * One light-quality sample per hour of `date`'s local day — the data behind
 * the strip's colouring, computed once per day rather than per drag frame.
 * See `SkyControl.tsx`'s header for why that matters for 60fps dragging.
 */
export function sampleDayLight(date: Date, position: LatLon): readonly HourSample[] {
  const midnight = startOfLocalDay(date);
  const samples: HourSample[] = [];
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const at = new Date(midnight.getTime() + hour * 60 * 60 * 1000);
    samples.push({ hour, quality: lightQuality(solarPosition(at, position).altitude) });
  }
  return samples;
}

/**
 * The precomputed sample nearest a 0–1 fraction of the day — a lookup, not a
 * recomputation. `samples` is expected to hold one entry per hour
 * (`sampleDayLight`'s output); falls back to the first entry if it doesn't,
 * rather than throwing mid-gesture.
 */
export function nearestHourSample(
  samples: readonly HourSample[],
  fraction: number,
): HourSample | null {
  if (samples.length === 0) return null;
  const hour = Math.min(
    samples.length - 1,
    Math.max(0, Math.round(fraction * (samples.length - 1))),
  );
  return samples[hour] ?? samples[0]!;
}
