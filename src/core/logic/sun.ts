/**
 * Solar and lunar position, twilight, and per-spot light direction — spec §5.2.
 *
 * Built in rather than delegated to PhotoPills or Sun Surveyor, because this is
 * pure astronomy: given a latitude, longitude and instant, the answer is
 * computable to far better precision than photography needs, with no API, no
 * key, and no network. That last property is the point. This has to work in the
 * Eifel with no signal, which is exactly where the almanac question gets asked.
 *
 * ── The differentiator ─────────────────────────────────────────────────────
 * Generic sun tools draw a compass overlay and leave the photographer to work
 * out what it means, because they have no idea which way the camera will point.
 * This app stores `shootingBearing` on every spot, so it can answer the actual
 * question directly: at 17:00 from this position, is the sun in my frame?
 *
 * That is a dozen lines of arithmetic and a better answer than the market
 * leader gives — not because the maths is cleverer, but because the data model
 * knows something theirs cannot.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * Flat-horizon only. Terrain shadowing — the fact that Adenauer Forst goes dark
 * long before the almanac's sunset because a ridge is in the way — is a
 * Milestone 3 refinement that needs the DSM-derived horizon profile. The
 * flat-horizon answer is already useful and ships first; see `HORIZON_CAVEAT`.
 */
// suncalc 2.x is ESM with named exports and no default export. Importing it
// as `import SunCalc from 'suncalc'` yields undefined at runtime while type-
// checking cleanly, which fails only when a function is first called.
import {
  getMoonIllumination,
  getMoonPosition,
  getMoonTimes,
  getPosition,
  getTimes,
} from 'suncalc';
import type { LatLon } from '../domain/common';
import { normaliseBearing, normaliseSigned } from './geo';

/**
 * ── suncalc version trap. Read before touching anything below. ─────────────
 *
 * suncalc **1.x** returned altitude and azimuth in RADIANS, with azimuth
 * measured from SOUTH. Every tutorial, StackOverflow answer, and the project
 * spec's own §5.2 snippet describes that convention, because it stood for a
 * decade.
 *
 * suncalc **2.x**, which this project uses, returns DEGREES with azimuth
 * measured from NORTH — already exactly the convention used everywhere else in
 * this codebase. No conversion is needed, and applying the documented one
 * yields altitudes 57× too large and bearings rotated 180°.
 *
 * What made this genuinely dangerous rather than merely annoying: the project
 * initially also had `@types/suncalc` installed, which is typed for 1.x. Both
 * conventions are plain `number`, so the wrong assumption typechecked
 * perfectly. It was caught only because sun.test.ts asserts against physical
 * facts — sun due south at solar noon, ~47° altitude swing across the year —
 * rather than against whatever the code happened to return.
 *
 * `@types/suncalc` has since been removed: suncalc 2.x ships its own accurate
 * typings, whose header states the convention explicitly. Do not reinstall the
 * DefinitelyTyped package; it would shadow nothing but mislead any reader.
 *
 * If you upgrade or downgrade suncalc, re-run those tests before trusting
 * anything here.
 */
const verifiedSunCalcConvention = 'degrees, azimuth from north' as const;
void verifiedSunCalcConvention;

/**
 * Displayed anywhere a sunset or twilight time is shown, until Milestone 3.
 *
 * Being explicit about this matters: a photographer who walks 3km to a valley
 * position on the strength of a sunset time that assumed a flat horizon has
 * been actively misled, not merely under-informed.
 */
export const HORIZON_CAVEAT =
  'Assumes a flat horizon. Terrain may block the sun earlier at this position.';

/** Where the sun is, from a given position at a given instant. */
export interface SolarPosition {
  /** Degrees above the horizon. Negative when below. */
  readonly altitude: number;
  /** Compass bearing to the sun, degrees true (0 = north, clockwise). */
  readonly azimuth: number;
}

/**
 * Solar position for a coordinate and instant.
 *
 * Values pass through unconverted — see the version-trap note at the top of
 * this file. `normaliseBearing` is applied defensively only, to guarantee the
 * [0, 360) range the rest of the codebase relies on.
 */
export function solarPosition(at: Date, position: LatLon): SolarPosition {
  const raw = getPosition(at, position.latitude, position.longitude);
  return {
    altitude: raw.altitude,
    azimuth: normaliseBearing(raw.azimuth),
  };
}

/**
 * Standard astronomical twilight bands. Mutually exclusive.
 *
 * These partition the altitude axis: any instant is in exactly one.
 */
export const TwilightBand = {
  Day: 'day',
  Civil: 'civil',
  Nautical: 'nautical',
  Astronomical: 'astronomical',
  Night: 'night',
} as const;
export type TwilightBand = (typeof TwilightBand)[keyof typeof TwilightBand];

/**
 * Photographic light-quality bands. NOT mutually exclusive with the above.
 *
 * ── Why these are two separate types ───────────────────────────────────────
 * The spec table lists golden hour, blue hour and the twilights together, and
 * it is tempting to flatten them into one enum. They do not flatten. Golden
 * hour (−4° to +6°) straddles the horizon and so overlaps both `Day` and
 * `Civil`; blue hour (−6° to −4°) sits entirely inside `Civil`.
 *
 * They are two different classifications of the same axis: one astronomical,
 * one photographic. Collapsing them loses information at precisely the times
 * of day this app exists to describe.
 */
export const LightQuality = {
  /** −4° to +6°. Warm, low, directional. */
  Golden: 'golden',
  /** −6° to −4°. Sun below horizon, sky still lit. */
  Blue: 'blue',
  /** Above golden hour — high sun, hard shadows. */
  Daylight: 'daylight',
  /** Below blue hour — artificial light and long exposures. */
  Dark: 'dark',
} as const;
export type LightQuality = (typeof LightQuality)[keyof typeof LightQuality];

export function twilightBand(altitudeDegrees: number): TwilightBand {
  if (altitudeDegrees >= 0) return TwilightBand.Day;
  if (altitudeDegrees >= -6) return TwilightBand.Civil;
  if (altitudeDegrees >= -12) return TwilightBand.Nautical;
  if (altitudeDegrees >= -18) return TwilightBand.Astronomical;
  return TwilightBand.Night;
}

export function lightQuality(altitudeDegrees: number): LightQuality {
  if (altitudeDegrees > 6) return LightQuality.Daylight;
  if (altitudeDegrees >= -4) return LightQuality.Golden;
  if (altitudeDegrees >= -6) return LightQuality.Blue;
  return LightQuality.Dark;
}

/**
 * The sun's direction relative to where the camera is pointing.
 *
 * `Backlit` means the sun is in or near the frame — flare, rim light, silhouette
 * potential, and the reason a spot that is unusable at 14:00 is the best on the
 * circuit at 19:30.
 */
export const LightDirection = {
  /** Within 45° of the shooting bearing: sun in frame. */
  Backlit: 'backlit',
  /** Beyond 135°: sun behind the photographer, subject front-lit. */
  FrontLit: 'frontLit',
  /** Between the two: raking side light across the subject. */
  SideLit: 'sideLit',
} as const;
export type LightDirection =
  (typeof LightDirection)[keyof typeof LightDirection];

export interface SpotLight {
  readonly position: SolarPosition;
  readonly band: TwilightBand;
  readonly quality: LightQuality;
  /**
   * Null when the sun is below the horizon, or when the spot has no recorded
   * `shootingBearing`.
   *
   * Returning null rather than a value is deliberate in both cases. Reporting
   * "backlit" for a sun sitting 10° below the horizon is not a rounding error,
   * it is a confidently wrong answer — and an undocumented bearing must read as
   * "not yet documented" rather than defaulting to north, which would render a
   * correct-looking arrow pointing at nothing.
   */
  readonly direction: LightDirection | null;
  /**
   * Signed angle from the shooting bearing to the sun, in (-180, 180].
   * Negative is to the left of frame, positive to the right. Null as above.
   */
  readonly relativeAzimuth: number | null;
}

/**
 * The full light picture for a spot at an instant — the core §5.2 answer.
 *
 * `shootingBearing` is nullable because a spot documented from the map rather
 * than in the field genuinely does not have one yet.
 */
export function spotLight(
  at: Date,
  position: LatLon,
  shootingBearing: number | null,
): SpotLight {
  const solar = solarPosition(at, position);
  const band = twilightBand(solar.altitude);
  const quality = lightQuality(solar.altitude);

  if (shootingBearing === null || solar.altitude < 0) {
    return {
      position: solar,
      band,
      quality,
      direction: null,
      relativeAzimuth: null,
    };
  }

  const relative = normaliseSigned(solar.azimuth - shootingBearing);
  const magnitude = Math.abs(relative);

  const direction =
    magnitude < 45
      ? LightDirection.Backlit
      : magnitude > 135
        ? LightDirection.FrontLit
        : LightDirection.SideLit;

  return {
    position: solar,
    band,
    quality,
    direction,
    relativeAzimuth: relative,
  };
}

/**
 * Key solar times for a date at a position.
 *
 * Any field may be null: above the Arctic Circle the sun does not always rise
 * or set, and SunCalc reports `Invalid Date` in those cases. None of the
 * venues in scope are anywhere near that, but a null-returning signature costs
 * nothing and prevents an `Invalid Date` propagating silently into the
 * timeline strip.
 */
export interface SolarDay {
  readonly sunrise: Date | null;
  readonly sunset: Date | null;
  readonly solarNoon: Date | null;
  readonly goldenHourMorningEnd: Date | null;
  readonly goldenHourEveningStart: Date | null;
  readonly civilDawn: Date | null;
  readonly civilDusk: Date | null;
  readonly nauticalDawn: Date | null;
  readonly nauticalDusk: Date | null;
  readonly astronomicalDawn: Date | null;
  readonly astronomicalDusk: Date | null;
}

/**
 * Collapse suncalc's three "no such time" representations into one.
 *
 * `getTimes` reports a missing sunrise as `null`, `getMoonTimes` reports a
 * missing moonrise as `undefined`, and an out-of-range computation can yield a
 * `Date` whose value is NaN. All three must reach the timeline strip as a
 * single absent case, or `Invalid Date` renders as "NaN" in the UI instead of
 * failing loudly.
 */
const orNull = (d: Date | null | undefined): Date | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;

export function solarDay(on: Date, position: LatLon): SolarDay {
  const t = getTimes(on, position.latitude, position.longitude);
  return {
    sunrise: orNull(t.sunrise),
    sunset: orNull(t.sunset),
    solarNoon: orNull(t.solarNoon),
    goldenHourMorningEnd: orNull(t.goldenHourEnd),
    goldenHourEveningStart: orNull(t.goldenHour),
    civilDawn: orNull(t.dawn),
    civilDusk: orNull(t.dusk),
    nauticalDawn: orNull(t.nauticalDawn),
    nauticalDusk: orNull(t.nauticalDusk),
    astronomicalDawn: orNull(t.nightEnd),
    astronomicalDusk: orNull(t.night),
  };
}

/**
 * Moon position and illumination.
 *
 * Not decoration: for a late-September Spa Six Hours running into darkness, a
 * full moon behind Blanchimont changes what is achievable, and a new moon
 * changes it back.
 */
export interface MoonState {
  readonly altitude: number;
  readonly azimuth: number;
  /** 0 = new, 0.5 = full, 1 = new again. */
  readonly phase: number;
  /** Illuminated fraction of the disc, 0–1. */
  readonly illumination: number;
  readonly rise: Date | null;
  readonly set: Date | null;
}

export function moonState(at: Date, position: LatLon): MoonState {
  const pos = getMoonPosition(at, position.latitude, position.longitude);
  const illum = getMoonIllumination(at);
  const times = getMoonTimes(at, position.latitude, position.longitude);

  return {
    altitude: pos.altitude,
    azimuth: normaliseBearing(pos.azimuth),
    phase: illum.phase,
    illumination: illum.fraction,
    rise: orNull(times.rise),
    set: orNull(times.set),
  };
}

/**
 * Sample light across a window — the data behind the §5.2 timeline strip.
 *
 * Returns one sample per `stepMinutes` from `from` to `to` inclusive.
 */
export function sampleLight(
  position: LatLon,
  shootingBearing: number | null,
  from: Date,
  to: Date,
  stepMinutes = 15,
): readonly { readonly at: Date; readonly light: SpotLight }[] {
  if (stepMinutes <= 0) throw new RangeError('stepMinutes must be positive');

  const samples: { at: Date; light: SpotLight }[] = [];
  const stepMs = stepMinutes * 60_000;

  for (let t = from.getTime(); t <= to.getTime(); t += stepMs) {
    const at = new Date(t);
    samples.push({ at, light: spotLight(at, position, shootingBearing) });
  }
  return samples;
}
