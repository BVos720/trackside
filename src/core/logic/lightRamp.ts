/**
 * The day's light as a continuous ramp — TASKS.md F4.
 *
 * The strip already had the day's shape, in four flat colours and 24 steps.
 * That is honest about the *category* of light and dishonest about how it
 * arrives: sunrise is not a boundary you cross between two hours, it is a
 * twenty-minute slide, and the one thing a photographer is reading the strip
 * for is exactly where in that slide a session falls.
 *
 * So this interpolates rather than buckets. The anchor colours are the same
 * four the strip has always used (`lightQualityColor` in ../../ui/theme.ts),
 * kept deliberately identical so the gradient reads as the same instrument
 * with the steps taken out, not as a new palette.
 *
 * Altitudes, not times, because the ramp is a fact about the sun's angle and
 * holds at any latitude and any date — including the polar cases where a
 * time-based ramp would invent a sunrise that never happens.
 */
import type { LatLon } from '../domain/common';
import { solarPosition } from './sun';

export type Rgb = readonly [number, number, number];

const NIGHT: Rgb = [18, 23, 34]; // lightQualityColor.dark
const BLUE: Rgb = [60, 91, 168]; // lightQualityColor.blue
const GOLDEN: Rgb = [242, 160, 61]; // lightQualityColor.golden
const DAY: Rgb = [127, 178, 229]; // lightQualityColor.daylight

/**
 * Anchor points, in degrees of solar altitude.
 *
 * The boundaries are the conventional ones — -18 astronomical, -6 civil, 0
 * the horizon, +6 the usual end of golden hour — so the ramp changes colour
 * where the light actually changes, and agrees with `lightQuality` about
 * which band any given moment is in.
 */
const STOPS: readonly (readonly [number, Rgb])[] = [
  [-18, NIGHT],
  [-9, BLUE],
  [0, GOLDEN],
  [6, GOLDEN],
  [14, DAY],
];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The colour of the sky at a given solar altitude.
 *
 * Clamped at both ends: below the first stop it is simply night, and above
 * the last it is simply day. Deep night and high noon have no further to go,
 * and extrapolating past the anchors would produce colours that are not in
 * the palette at all.
 */
export function skyRampColor(altitudeDegrees: number): Rgb {
  const first = STOPS[0]!;
  const last = STOPS[STOPS.length - 1]!;
  if (!Number.isFinite(altitudeDegrees)) return NIGHT;
  if (altitudeDegrees <= first[0]) return first[1];
  if (altitudeDegrees >= last[0]) return last[1];

  for (let i = 0; i < STOPS.length - 1; i++) {
    const [lo, loColor] = STOPS[i]!;
    const [hi, hiColor] = STOPS[i + 1]!;
    if (altitudeDegrees >= lo && altitudeDegrees <= hi) {
      const span = hi - lo;
      // Two stops can share a colour (the golden plateau), and a zero-width
      // span would divide by zero rather than simply being that colour.
      const t = span === 0 ? 0 : (altitudeDegrees - lo) / span;
      return mix(loColor, hiColor, t);
    }
  }
  return last[1];
}

/** `rgb(r, g, b)`, for a style prop. */
export function rgbString(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export interface RampStep {
  /** Where this step starts, as a 0–1 fraction of the local day. */
  readonly at: number;
  /** Solar altitude in degrees at that moment. */
  readonly altitude: number;
  readonly color: Rgb;
}

/**
 * The whole day, sampled evenly.
 *
 * `steps` is the resolution of the gradient. It is a parameter rather than a
 * constant because it is a straight trade the caller owns: every step is a
 * view on screen, and the strip redraws on every frame of a drag.
 */
export function sampleDayRamp(
  date: Date,
  position: LatLon,
  steps = 96,
): RampStep[] {
  const midnight = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const out: RampStep[] = [];

  for (let i = 0; i < steps; i++) {
    // Sampled at the middle of each step rather than its edge, so a step's
    // colour is representative of the slice it covers instead of leading it.
    const at = (i + 0.5) / steps;
    const when = new Date(midnight.getTime() + at * dayMs);
    const altitude = solarPosition(when, position).altitude;
    out.push({ at: i / steps, altitude, color: skyRampColor(altitude) });
  }

  return out;
}
