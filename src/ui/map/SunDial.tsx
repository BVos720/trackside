/**
 * The sun, as a fixed on-screen dial — spec §5.2/§5.12, task A2.
 *
 * Not a map pin. The sun has no ground coordinate, so unlike `CircuitRuler`'s
 * neighbours on this screen it never anchors to a `lngLat` — it is a compass
 * fixed to the corner of the screen, the way a bezel compass is fixed to a
 * camera body rather than drawn on the map itself.
 *
 * ── Reading it ────────────────────────────────────────────────────────────
 * The map is north-up with no camera bearing applied (`MapScreen` never
 * rotates), so azimuth 0° is screen-up without any correction. A marker
 * orbits the ring at that bearing — stand at a corner, look at the ring, and
 * the marker points the way the light is coming from.
 *
 * Altitude reads on the same marker two ways at once, because colour alone
 * is too easy to misjudge at a glance in bright sun:
 *   - *Radius*: the marker sits on the ring at the horizon and slides toward
 *     the centre as the sun climbs, so a high sun and a low sun are never in
 *     the same place.
 *   - *Size, and a halo*: `lightQuality` drives both — daylight and golden
 *     draw bigger and warmer with a soft halo; blue and dark draw smaller,
 *     dimmer, with no halo at all. Below the horizon the marker still shows
 *     *where*, which is the whole point during golden/blue hour, but it never
 *     looks like daytime.
 *
 * Controlled, deliberately: `at` and `position` are props, not state read
 * from `useMapClock` directly. The wiring step (`B-wire`) supplies `at`, so
 * this file has no dependency on the clock hook and can be built and tested
 * against a plain `Date`.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { LatLon } from '../../core/domain/common';
import { LightQuality, lightQuality, solarPosition } from '../../core/logic/sun';
import { color, lightQualityColor, radius, space, type, weight } from '../theme';

/** Outer diameter of the compass ring. */
const RING_SIZE = 88;
const RING_RADIUS = RING_SIZE / 2;

/**
 * How far the marker can travel from the ring's centre.
 *
 * Kept a few pixels short of `RING_RADIUS` so the largest marker (daylight,
 * see `MARKER_SIZE`) sits just inside the ring stroke at the horizon rather
 * than overhanging it.
 */
const MARKER_TRAVEL_RADIUS = RING_RADIUS - 9;

/**
 * Marker diameter per light-quality band.
 *
 * Deliberately not a continuous function of altitude: the bands are already
 * the vocabulary the rest of the app uses (`lightQualityColor`, the sky strip
 * in `SkyControl`), and a size that snaps with the same four steps reads as
 * one system rather than two competing scales.
 */
const MARKER_SIZE: Record<LightQuality, number> = {
  [LightQuality.Daylight]: 16,
  [LightQuality.Golden]: 13,
  [LightQuality.Blue]: 10,
  [LightQuality.Dark]: 8,
};

/**
 * Which bands draw the soft halo behind the marker.
 *
 * Daylight and golden are light genuinely arriving — worth the extra glow.
 * Blue and dark are the sun below the horizon; the halo is what would make
 * that read as "still daytime" at a glance, so it is withheld rather than
 * merely dimmed.
 */
const HALO_QUALITIES: ReadonlySet<LightQuality> = new Set([
  LightQuality.Daylight,
  LightQuality.Golden,
]);

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Bearing to the nearest of 8 compass points.
 *
 * A text backstop beside the ring — the ring carries the real information,
 * but "NW" reads instantly where an angle on a small dial takes a beat.
 */
export function compassAbbrev(azimuthDegrees: number): string {
  const normalised = ((azimuthDegrees % 360) + 360) % 360;
  const index = Math.round(normalised / 45) % COMPASS_POINTS.length;
  // Always in [0, 7] by construction — the modulo above guarantees it.
  return COMPASS_POINTS[index]!;
}

/**
 * Azimuth to a screen offset from the ring's centre, at a given distance.
 *
 * The map is north-up with no bearing rotation (see the file header), so
 * azimuth is used directly as a screen angle measured clockwise from
 * straight up — no correction for camera bearing is needed or applied here.
 */
export function bearingOffset(
  azimuthDegrees: number,
  distance: number,
): { readonly dx: number; readonly dy: number } {
  const rad = (azimuthDegrees * Math.PI) / 180;
  return { dx: Math.sin(rad) * distance, dy: -Math.cos(rad) * distance };
}

/**
 * Altitude to the marker's distance from the ring's centre, as a fraction of
 * `MARKER_TRAVEL_RADIUS` (0 = centre/zenith, 1 = ring edge/horizon).
 *
 * Clamped rather than mirrored below the horizon: once the sun is down, any
 * further descent stays pinned at the horizon edge — depth below the horizon
 * is not spatial information a viewer standing at a corner can use, but
 * *where* it went down still is, so bearing keeps moving while radius holds.
 */
export function altitudeToRadiusFraction(altitudeDegrees: number): number {
  if (altitudeDegrees <= 0) return 1;
  if (altitudeDegrees >= 90) return 0;
  return 1 - altitudeDegrees / 90;
}

/** "+24°" above the horizon, "−6°" below. Normalises `-0` to `0`. */
export function formatAltitude(altitudeDegrees: number): string {
  const rounded = Math.round(altitudeDegrees) || 0;
  return rounded > 0 ? `+${rounded}°` : `${rounded}°`;
}

export default function SunDial({
  at,
  position,
  /** Distance from the top of the screen, already clear of the safe area. */
  top,
}: {
  at: Date;
  position: LatLon;
  top?: number;
}) {
  const solar = solarPosition(at, position);
  const quality = lightQuality(solar.altitude);
  const qualityColor = lightQualityColor[quality];

  const distance = altitudeToRadiusFraction(solar.altitude) * MARKER_TRAVEL_RADIUS;
  const { dx, dy } = bearingOffset(solar.azimuth, distance);
  const markerSize = MARKER_SIZE[quality];
  const showHalo = HALO_QUALITIES.has(quality);

  return (
    <View
      style={[styles.root, top === undefined ? null : { top }]}
      pointerEvents="none"
    >
      <Text style={styles.title}>SUN</Text>

      <View style={styles.ringWrap}>
        <View style={styles.ring} />
        <Text style={styles.northLabel}>N</Text>
        <View style={styles.centreDot} />

        {showHalo && (
          <View
            style={[
              styles.halo,
              {
                width: markerSize * 2.4,
                height: markerSize * 2.4,
                borderRadius: markerSize * 1.2,
                backgroundColor: qualityColor,
                left: RING_RADIUS + dx - markerSize * 1.2,
                top: RING_RADIUS + dy - markerSize * 1.2,
              },
            ]}
          />
        )}

        <View
          style={[
            styles.marker,
            {
              width: markerSize,
              height: markerSize,
              borderRadius: markerSize / 2,
              backgroundColor: qualityColor,
              left: RING_RADIUS + dx - markerSize / 2,
              top: RING_RADIUS + dy - markerSize / 2,
            },
          ]}
        />
      </View>

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.bearingValue}>{compassAbbrev(solar.azimuth)}</Text>
        <Text style={styles.altitudeValue}>{formatAltitude(solar.altitude)}</Text>
      </View>
      <Text style={styles.qualityLabel}>{quality.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: space.md,
    width: RING_SIZE + space.sm * 2,
    padding: space.sm,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,13,16,0.86)',
    borderWidth: 1,
    borderColor: color.border,
  },
  title: {
    alignSelf: 'flex-start',
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },

  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    marginTop: space.sm,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_RADIUS,
    borderWidth: 1.5,
    borderColor: color.border,
  },
  northLabel: {
    position: 'absolute',
    top: -2,
    left: RING_RADIUS - 5,
    width: 10,
    textAlign: 'center',
    color: color.textFaint,
    fontSize: 9,
    fontWeight: weight.bold,
  },
  centreDot: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    left: RING_RADIUS - 1.5,
    top: RING_RADIUS - 1.5,
    backgroundColor: color.border,
  },
  halo: { position: 'absolute', opacity: 0.28 },
  /**
   * `color.border` rather than `color.background`: the marker sits on this
   * panel's own opaque background, not the map, so a border matched to
   * `color.background` is invisible by construction — worse, at
   * `LightQuality.Dark` the fill (`lightQualityColor.dark`, `#121722`) is
   * itself a near-match for that same background, so fill and border and
   * panel all collapsed into one indistinguishable smudge and the marker
   * all but disappeared exactly when it is doing its most important job
   * (below the horizon is still "where"). A neutral, already-defined edge
   * keeps every quality's marker legible as a shape without touching any
   * quality's own colour.
   */
  marker: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: color.border,
  },

  divider: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: color.border,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  bearingValue: {
    color: color.text,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  altitudeValue: {
    color: color.textMuted,
    fontSize: type.label,
    fontVariant: ['tabular-nums'],
  },
  qualityLabel: {
    marginTop: 1,
    color: color.textFaint,
    fontSize: 9,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
});
