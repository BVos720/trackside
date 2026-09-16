import { Text } from '../Typography';
/**
 * The sun, as a fixed on-screen dial — spec §5.2/§5.12, task A2/C2/D1.
 *
 * Not a map pin. The sun has no ground coordinate, so unlike `CircuitRuler`'s
 * neighbours on this screen it never anchors to a `lngLat` — it is a compass
 * fixed to the corner of the screen, the way a bezel compass is fixed to a
 * camera body rather than drawn on the map itself.
 *
 * ── Reading it ────────────────────────────────────────────────────────────
 * A marker orbits the ring at the sun's bearing — stand at a corner, look at
 * the ring, and the marker points the way the light is coming from.
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
 * ── C2: rotating with the phone ──────────────────────────────────────────
 * Task C0 decided egocentric markers on a north-up map: the map itself never
 * rotates, but the ring does, so its "up" tracks wherever the phone is
 * physically pointing. The whole `ringWrap` (ring, N label, halo, marker) gets
 * one `rotate` transform of `-heading` degrees. Because the marker's own
 * position inside that view is still placed by plain azimuth
 * (`bearingOffset`, unchanged from before C2), rotating the container is
 * mathematically the same as computing `azimuth − heading` directly, and it
 * carries the N label around for free — north still reads correctly wherever
 * it now points, with no separate rotation math for it.
 *
 * `heading == null` (no permission, no sensor, not yet calibrated — see
 * `useHeading.ts`) means "no rotation", not "rotation of 0": the ring simply
 * stays north-up, exactly as it always did, but a small caption says so
 * rather than silently implying the ring is phone-relative when it is not
 * (task C2: "degrade honestly"). Kept a pure function of props, same as
 * before — the subscription lives in `useHeading`, not here.
 *
 * ── D1/D4: reading as part of the map, not a card on top of it ──────────────
 * No enclosing rectangle, no border, no title bar. The only "solid" shape is
 * a disc sized to the ring itself — a compass rose sitting on the map, the
 * way a physical bezel compass would, rather than a panel that happens to
 * contain one. Loose text (bearing/altitude/quality) gets a drop shadow
 * instead of a background box for contrast, since the map's own brightness
 * changes under it as it moves (D4) and a big rectangle was the "clutter"
 * Branco named.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LatLon } from '../../core/domain/common';
import { LightQuality, lightQuality, solarPosition } from '../../core/logic/sun';
import {
  lightQualityColor,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

/** Outer diameter of the compass ring. */
/*
  A compass, not a dial.

  At 88px this was an instrument in its own right, and it had to be: it was
  the only way to see where the sun was. The 3D view now draws the sun itself,
  so the dial's job has shrunk to the one thing the sky cannot do — tell you
  which way you are facing, and give the exact figures when a glance at the
  horizon is not precise enough.

  So it keeps the ring, the north mark and the sun's position, and gives up
  the size and the running commentary. Small enough to sit in a corner without
  competing with the map it is describing.
*/
const RING_SIZE = 52;
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
 * Always plain azimuth, measured clockwise from the ring's own "up" — never
 * corrected for heading here. `ringWrap`'s own `transform: rotate(...)`
 * (C2) carries the whole ring, marker and N label around together, which is
 * equivalent to subtracting heading from azimuth without this function
 * needing to know heading exists.
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
  /**
   * True-north compass bearing from `useHeading()`, or `null` for "no usable
   * heading" — permission refused, no sensor, or not yet calibrated. `null`
   * (the default) renders the ring north-up, same as before C2 existed.
   */
  heading = null,
}: {
  at: Date;
  position: LatLon;
  top?: number;
  heading?: number | null;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const solar = solarPosition(at, position);
  const quality = lightQuality(solar.altitude);
  const qualityColor = lightQualityColor[quality];

  const distance = altitudeToRadiusFraction(solar.altitude) * MARKER_TRAVEL_RADIUS;
  const { dx, dy } = bearingOffset(solar.azimuth, distance);
  const markerSize = MARKER_SIZE[quality];
  const showHalo = HALO_QUALITIES.has(quality);
  const isNorthUp = heading === null;

  return (
    <View
      style={[styles.root, top === undefined ? null : { top }]}
      pointerEvents="none"
    >
      <View style={styles.ringSlot}>
        <View style={styles.ringBackdrop} />
        <View
          style={[
            styles.ringWrap,
            isNorthUp ? null : { transform: [{ rotate: `${-heading}deg` }] },
          ]}
        >
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
      </View>

      {isNorthUp && <Text style={styles.northUpNote}>NORTH-UP</Text>}

      {/*
        Bearing and elevation, on one line.

        Kept, and only these. The quality word went with the dial — the sky
        itself now says whether it is golden or dark far better than a caption
        could, and the strip already names it in words. These two are the part
        no view of the sky gives you: the exact figures you would otherwise be
        estimating by eye.
      */}
      <Text style={styles.reading}>
        {compassAbbrev(solar.azimuth)} {formatAltitude(solar.altitude)}
      </Text>
    </View>
  );
}

/**
 * Shared by every loose text label below — the map behind this control moves
 * and changes brightness as it pans (D4), so a drop shadow does the contrast
 * job a background box used to do, without reintroducing the box. `'#000'`
 * matches the one drop-shadow convention already in the app
 * (`PlannerScreen.tsx`'s raised card) rather than inventing a new value.
 */
const textLegibility = {
  textShadowColor: '#000',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    reading: {
      ...textLegibility,
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
      marginTop: 2,
      letterSpacing: 0.5,
    },
    root: {
      position: 'absolute',
      right: space.md,
      width: RING_SIZE + space.sm * 2,
      alignItems: 'center',
      backgroundColor: color.surface,
      borderRadius: 18,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: color.border,
    },
    title: {
      ...textLegibility,
      color: color.text,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },

    ringSlot: {
      width: RING_SIZE,
      height: RING_SIZE,
      marginTop: space.xs,
    },
    /**
     * The one solid shape left — a disc sized to the ring, not a rectangle
     * around the whole widget. Reads as a physical object resting on the map
     * (a bezel compass) rather than a UI panel that happens to contain one, and
     * still gives the ring's thin border and small marker the opaque backing
     * §5.14 asks for against a map whose own colour varies underneath it. Same
     * `rgba(11,13,16,0.86)` already used for this elsewhere in the app
     * (`MapScreen`'s mode button, `CircuitRuler`) — reused, not reinvented.
     */
    ringBackdrop: {
      position: 'absolute',
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_RADIUS,
      backgroundColor: color.surface,
    },
    // Rotated by C2 as one unit — see the file header. Must stay a plain
    // wrapper with no padding/margin of its own so RING_RADIUS-based placement
    // inside it stays correct regardless of rotation.
    ringWrap: {
      position: 'absolute',
      width: RING_SIZE,
      height: RING_SIZE,
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
      color: color.textMuted,
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
     * `color.border` rather than `color.background`: the marker sits on the
     * ring backdrop, not the map, so a border matched to `color.background` is
     * invisible by construction — worse, at `LightQuality.Dark` the fill
     * (`lightQualityColor.dark`, `#121722`) is itself a near-match for that
     * same background, so fill and border and backdrop all collapsed into one
     * indistinguishable smudge and the marker all but disappeared exactly when
     * it is doing its most important job (below the horizon is still "where").
     * A neutral, already-defined edge keeps every quality's marker legible as a
     * shape without touching any quality's own colour.
     */
    marker: {
      position: 'absolute',
      borderWidth: 1,
      borderColor: color.border,
    },

    /**
     * C2's honesty note. Same micro-label vocabulary as `title`/`qualityLabel`
     * (all-caps, `textFaint`, tight tracking) so it reads as part of the same
     * system rather than a warning banner — this is a normal, expected state
     * (no permission yet, no sensor, indoors), not an error.
     */
    northUpNote: {
      ...textLegibility,
      marginTop: space.xs,
      color: color.textFaint,
      fontSize: 9,
      fontWeight: weight.bold,
      letterSpacing: 1,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: space.xs,
      marginTop: space.xs,
    },
    bearingValue: {
      ...textLegibility,
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    altitudeValue: {
      ...textLegibility,
      color: color.textMuted,
      fontSize: type.label,
      fontVariant: ['tabular-nums'],
    },
    qualityLabel: {
      ...textLegibility,
      marginTop: 1,
      color: color.textFaint,
      fontSize: 9,
      fontWeight: weight.bold,
      letterSpacing: 1,
    },
  });
}
