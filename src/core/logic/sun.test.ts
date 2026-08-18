import { describe, expect, it } from 'vitest';
import {
  LightDirection,
  LightQuality,
  TwilightBand,
  lightQuality,
  moonState,
  sampleLight,
  solarDay,
  solarPosition,
  spotLight,
  twilightBand,
} from './sun';

/**
 * Approximate venue coordinates, used only as test inputs.
 *
 * These are not seed data and must not be copied into any preset file. Spec
 * §0.2 reserves circuit and marshal-post data for human sourcing from official
 * documents; a rough centroid good enough to assert that the sun is in the
 * southern half of the sky is nowhere near good enough to ship.
 */
const NURBURGRING = { latitude: 50.3356, longitude: 6.9475 };
const SOUTHERN_SITE = { latitude: -33.0, longitude: 18.0 };

describe('solarPosition — azimuth convention', () => {
  /**
   * The conversion these tests exist to protect.
   *
   * SunCalc measures azimuth in radians from SOUTH; everything else in this
   * codebase uses degrees true from NORTH. Getting that wrong yields a clean
   * 180° error that still produces sunrise-ish and sunset-ish looking numbers,
   * so it survives casual inspection and then quietly tells someone a spot is
   * front-lit when it is backlit.
   */
  it('puts the sun due south at solar noon in the northern hemisphere', () => {
    const noon = solarDay(new Date('2026-06-21T12:00:00Z'), NURBURGRING).solarNoon;
    expect(noon).not.toBeNull();

    const { azimuth } = solarPosition(noon!, NURBURGRING);
    expect(azimuth).toBeGreaterThan(179);
    expect(azimuth).toBeLessThan(181);
  });

  it('puts the sun due north at solar noon in the southern hemisphere', () => {
    const noon = solarDay(new Date('2026-06-21T12:00:00Z'), SOUTHERN_SITE).solarNoon;
    expect(noon).not.toBeNull();

    const { azimuth } = solarPosition(noon!, SOUTHERN_SITE);
    // Due north is 0/360, so measure the wrapped distance from north.
    const fromNorth = Math.min(azimuth, 360 - azimuth);
    expect(fromNorth).toBeLessThan(1);
  });

  it('tracks east in the morning and west in the evening', () => {
    const day = solarDay(new Date('2026-06-21T12:00:00Z'), NURBURGRING);
    const sunrise = solarPosition(day.sunrise!, NURBURGRING);
    const sunset = solarPosition(day.sunset!, NURBURGRING);

    expect(sunrise.azimuth).toBeGreaterThan(0);
    expect(sunrise.azimuth).toBeLessThan(180);
    expect(sunset.azimuth).toBeGreaterThan(180);
    expect(sunset.azimuth).toBeLessThan(360);
  });
});

describe('solarPosition — altitude', () => {
  it('climbs much higher at midsummer than at midwinter', () => {
    const summer = solarDay(new Date('2026-06-21T12:00:00Z'), NURBURGRING);
    const winter = solarDay(new Date('2026-12-21T12:00:00Z'), NURBURGRING);

    const summerNoon = solarPosition(summer.solarNoon!, NURBURGRING).altitude;
    const winterNoon = solarPosition(winter.solarNoon!, NURBURGRING).altitude;

    expect(summerNoon).toBeGreaterThan(winterNoon);
    // At ~50°N the swing across the year is roughly 47°, twice the obliquity.
    expect(summerNoon - winterNoon).toBeGreaterThan(40);
    expect(summerNoon - winterNoon).toBeLessThan(50);
  });

  it('is negative in the middle of the night', () => {
    const { altitude } = solarPosition(
      new Date('2026-12-21T01:00:00Z'),
      NURBURGRING,
    );
    expect(altitude).toBeLessThan(0);
  });

  /**
   * Unit regression guard.
   *
   * suncalc 1.x returned radians-from-south; 2.x returns degrees-from-north.
   * `@types/suncalc` is typed for 1.x and both are plain `number`, so a wrong
   * assumption typechecks cleanly and produces altitudes 57× too large. These
   * assertions are cheap and fail loudly if the convention ever moves again.
   */
  it('never reports an altitude outside the physically possible ±90°', () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 5, 21, hour));
      expect(Math.abs(solarPosition(at, NURBURGRING).altitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(moonState(at, NURBURGRING).altitude)).toBeLessThanOrEqual(90);
    }
  });

  it('matches the geometrically predicted midsummer noon altitude', () => {
    // At solar noon on the June solstice the sun's altitude is
    // 90 − latitude + axial tilt = 90 − 50.3356 + 23.44 ≈ 63.1°.
    const noon = solarDay(new Date('2026-06-21T12:00:00Z'), NURBURGRING).solarNoon;
    const { altitude } = solarPosition(noon!, NURBURGRING);
    expect(altitude).toBeGreaterThan(62.5);
    expect(altitude).toBeLessThan(63.7);
  });
});

describe('twilightBand', () => {
  it('partitions the altitude axis at the standard boundaries', () => {
    expect(twilightBand(10)).toBe(TwilightBand.Day);
    expect(twilightBand(0)).toBe(TwilightBand.Day);
    expect(twilightBand(-0.1)).toBe(TwilightBand.Civil);
    expect(twilightBand(-6)).toBe(TwilightBand.Civil);
    expect(twilightBand(-6.1)).toBe(TwilightBand.Nautical);
    expect(twilightBand(-12)).toBe(TwilightBand.Nautical);
    expect(twilightBand(-12.1)).toBe(TwilightBand.Astronomical);
    expect(twilightBand(-18)).toBe(TwilightBand.Astronomical);
    expect(twilightBand(-18.1)).toBe(TwilightBand.Night);
  });
});

describe('lightQuality', () => {
  it('bands the photographic ranges from the spec table', () => {
    expect(lightQuality(20)).toBe(LightQuality.Daylight);
    expect(lightQuality(6.1)).toBe(LightQuality.Daylight);
    expect(lightQuality(6)).toBe(LightQuality.Golden);
    expect(lightQuality(0)).toBe(LightQuality.Golden);
    expect(lightQuality(-4)).toBe(LightQuality.Golden);
    expect(lightQuality(-4.1)).toBe(LightQuality.Blue);
    expect(lightQuality(-6)).toBe(LightQuality.Blue);
    expect(lightQuality(-6.1)).toBe(LightQuality.Dark);
  });

  it('overlaps the twilight bands rather than partitioning with them', () => {
    // Golden hour straddles the horizon: at +2° it is simultaneously Day and
    // Golden, and at -5° it is simultaneously Civil and Blue. This is why the
    // two classifications are separate types and not one flattened enum.
    expect(twilightBand(2)).toBe(TwilightBand.Day);
    expect(lightQuality(2)).toBe(LightQuality.Golden);

    expect(twilightBand(-5)).toBe(TwilightBand.Civil);
    expect(lightQuality(-5)).toBe(LightQuality.Blue);
  });
});

describe('spotLight — relative light direction', () => {
  // Fix an instant with the sun well up so `direction` is populated, then vary
  // the shooting bearing against the sun's actual azimuth.
  const at = new Date('2026-06-21T11:00:00Z');
  const sunAzimuth = solarPosition(at, NURBURGRING).azimuth;

  it('reports backlit when the camera points at the sun', () => {
    const light = spotLight(at, NURBURGRING, sunAzimuth);
    expect(light.direction).toBe(LightDirection.Backlit);
    expect(light.relativeAzimuth).toBeCloseTo(0, 6);
  });

  it('reports front-lit when the sun is behind the photographer', () => {
    const light = spotLight(at, NURBURGRING, sunAzimuth + 180);
    expect(light.direction).toBe(LightDirection.FrontLit);
  });

  it('reports side-lit at 90 degrees off', () => {
    expect(spotLight(at, NURBURGRING, sunAzimuth + 90).direction).toBe(
      LightDirection.SideLit,
    );
    expect(spotLight(at, NURBURGRING, sunAzimuth - 90).direction).toBe(
      LightDirection.SideLit,
    );
  });

  it('signs relativeAzimuth so left and right of frame are distinguishable', () => {
    expect(spotLight(at, NURBURGRING, sunAzimuth - 60).relativeAzimuth).toBeCloseTo(60, 6);
    expect(spotLight(at, NURBURGRING, sunAzimuth + 60).relativeAzimuth).toBeCloseTo(-60, 6);
  });

  it('holds the boundaries at 45 and 135 degrees', () => {
    expect(spotLight(at, NURBURGRING, sunAzimuth + 44).direction).toBe(
      LightDirection.Backlit,
    );
    expect(spotLight(at, NURBURGRING, sunAzimuth + 46).direction).toBe(
      LightDirection.SideLit,
    );
    expect(spotLight(at, NURBURGRING, sunAzimuth + 134).direction).toBe(
      LightDirection.SideLit,
    );
    expect(spotLight(at, NURBURGRING, sunAzimuth + 136).direction).toBe(
      LightDirection.FrontLit,
    );
  });

  it('survives bearings given outside 0-360 without wrapping wrong', () => {
    expect(spotLight(at, NURBURGRING, sunAzimuth + 360).direction).toBe(
      LightDirection.Backlit,
    );
    expect(spotLight(at, NURBURGRING, sunAzimuth - 360).direction).toBe(
      LightDirection.Backlit,
    );
  });
});

describe('spotLight — refusing to answer', () => {
  it('gives no direction when the spot has no recorded bearing', () => {
    // Must read as "not yet documented", never as a default of north — which
    // would render a confident arrow pointing at nothing.
    const light = spotLight(new Date('2026-06-21T11:00:00Z'), NURBURGRING, null);
    expect(light.direction).toBeNull();
    expect(light.relativeAzimuth).toBeNull();
    expect(light.position.altitude).toBeGreaterThan(0);
  });

  it('gives no direction when the sun is below the horizon', () => {
    // "Backlit" for a sun 10° underground is a confidently wrong answer.
    const light = spotLight(new Date('2026-12-21T01:00:00Z'), NURBURGRING, 90);
    expect(light.position.altitude).toBeLessThan(0);
    expect(light.direction).toBeNull();
    expect(light.relativeAzimuth).toBeNull();
  });

  it('still reports band and quality when it cannot report direction', () => {
    const light = spotLight(new Date('2026-12-21T01:00:00Z'), NURBURGRING, null);
    expect(light.band).toBe(TwilightBand.Night);
    expect(light.quality).toBe(LightQuality.Dark);
  });
});

describe('solarDay', () => {
  it('orders dawn before sunrise and sunset before dusk', () => {
    const d = solarDay(new Date('2026-10-10T12:00:00Z'), NURBURGRING);
    expect(d.astronomicalDawn!.getTime()).toBeLessThan(d.nauticalDawn!.getTime());
    expect(d.nauticalDawn!.getTime()).toBeLessThan(d.civilDawn!.getTime());
    expect(d.civilDawn!.getTime()).toBeLessThan(d.sunrise!.getTime());
    expect(d.sunrise!.getTime()).toBeLessThan(d.solarNoon!.getTime());
    expect(d.solarNoon!.getTime()).toBeLessThan(d.sunset!.getTime());
    expect(d.sunset!.getTime()).toBeLessThan(d.civilDusk!.getTime());
    expect(d.civilDusk!.getTime()).toBeLessThan(d.nauticalDusk!.getTime());
    expect(d.nauticalDusk!.getTime()).toBeLessThan(d.astronomicalDusk!.getTime());
  });

  it('returns null rather than an Invalid Date in polar summer', () => {
    // Not a venue in scope, but an Invalid Date propagating into the timeline
    // strip would render as "NaN" rather than failing loudly.
    const d = solarDay(new Date('2026-06-21T12:00:00Z'), {
      latitude: 78.9,
      longitude: 11.9,
    });
    expect(d.sunset).toBeNull();
    expect(d.sunrise).toBeNull();
  });
});

describe('moonState', () => {
  it('reports a phase and illumination within range', () => {
    const m = moonState(new Date('2026-09-26T20:00:00Z'), NURBURGRING);
    expect(m.phase).toBeGreaterThanOrEqual(0);
    expect(m.phase).toBeLessThanOrEqual(1);
    expect(m.illumination).toBeGreaterThanOrEqual(0);
    expect(m.illumination).toBeLessThanOrEqual(1);
    expect(m.azimuth).toBeGreaterThanOrEqual(0);
    expect(m.azimuth).toBeLessThan(360);
  });

  it('reports a near-full disc at a known full moon', () => {
    // 2026-10-26 is a full moon; illumination should be close to 1.
    const m = moonState(new Date('2026-10-26T12:00:00Z'), NURBURGRING);
    expect(m.illumination).toBeGreaterThan(0.97);
  });
});

describe('sampleLight', () => {
  it('samples inclusively across the window at the given step', () => {
    const from = new Date('2026-10-10T06:00:00Z');
    const to = new Date('2026-10-10T07:00:00Z');
    const samples = sampleLight(NURBURGRING, 90, from, to, 15);

    expect(samples).toHaveLength(5); // 06:00, 06:15, 06:30, 06:45, 07:00
    expect(samples[0]!.at.toISOString()).toBe(from.toISOString());
    expect(samples.at(-1)!.at.toISOString()).toBe(to.toISOString());
  });

  it('rejects a non-positive step rather than looping forever', () => {
    const from = new Date('2026-10-10T06:00:00Z');
    const to = new Date('2026-10-10T07:00:00Z');
    expect(() => sampleLight(NURBURGRING, 90, from, to, 0)).toThrow(RangeError);
  });
});
