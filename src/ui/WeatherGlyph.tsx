/**
 * Weather icons, drawn from plain views.
 *
 * ── Why not an icon font or an SVG library ─────────────────────────────────
 * The same reasoning `scripts/build-sprites.mjs` sets out for the map's
 * scenery sprites: five shapes are not worth a dependency, and
 * `react-native-svg` is a native module — adding one means every contributor
 * rebuilds the dev client before the app will start again. Circles and
 * rounded rectangles are things React Native already draws, so these are
 * built out of `borderRadius` and `transform`, and they scale off one `size`
 * prop rather than shipping at fixed pixel sizes.
 *
 * Every glyph draws inside a `size` x `size` box and centres itself in it, so
 * a row of them lines up without the caller measuring anything.
 */
import { StyleSheet, View } from 'react-native';

import type { SkyCondition } from '../core/logic/forecast';
import { color, lightQualityColor } from './theme';

/** The sun, and the cloud in front of it, never share a colour — see `theme.ts`. */
const SUN = lightQualityColor.golden;
const CLOUD = '#B7C2CE';
const CLOUD_DARK = '#7C8794';
const RAIN = lightQualityColor.daylight;

function Sun({ size, offset }: { size: number; offset?: { x: number; y: number } }) {
  const disc = size * 0.44;
  const ray = { length: size * 0.13, thickness: Math.max(1.5, size * 0.055) };
  return (
    <View
      style={[
        styles.centred,
        offset && { transform: [{ translateX: offset.x }, { translateY: offset.y }] },
      ]}
    >
      {/* Eight rays, each rotated about the centre of the box it sits in. */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <View
          key={deg}
          style={[
            styles.centred,
            { transform: [{ rotate: `${deg}deg` }] },
          ]}
          pointerEvents="none"
        >
          <View
            style={{
              position: 'absolute',
              width: ray.thickness,
              height: ray.length,
              borderRadius: ray.thickness,
              backgroundColor: SUN,
              // Pushed out past the disc's edge, not measured from the box.
              transform: [{ translateY: -(disc / 2 + ray.length * 0.75) }],
            }}
          />
        </View>
      ))}
      <View
        style={{
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: SUN,
        }}
      />
    </View>
  );
}

/**
 * A cloud: one wide rounded base with two lobes sitting on it.
 *
 * Drawn as three overlapping shapes rather than one rounded rectangle because
 * a rectangle at this size reads as a button, not weather.
 */
function Cloud({
  size,
  tint = CLOUD,
  offset,
}: {
  size: number;
  tint?: string;
  offset?: { x: number; y: number };
}) {
  const w = size * 0.72;
  const h = size * 0.3;
  const big = size * 0.34;
  const small = size * 0.26;
  return (
    <View
      style={[
        styles.centred,
        offset && { transform: [{ translateX: offset.x }, { translateY: offset.y }] },
      ]}
      pointerEvents="none"
    >
      <View style={{ width: w, height: h * 1.6 }}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: w,
            height: h,
            borderRadius: h / 2,
            backgroundColor: tint,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: w * 0.16,
            bottom: h * 0.5,
            width: big,
            height: big,
            borderRadius: big / 2,
            backgroundColor: tint,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: w * 0.52,
            bottom: h * 0.45,
            width: small,
            height: small,
            borderRadius: small / 2,
            backgroundColor: tint,
          }}
        />
      </View>
    </View>
  );
}

/** Three falling strokes under a cloud, raked over so they read as falling. */
function Rain({ size }: { size: number }) {
  const drop = { w: Math.max(1.5, size * 0.05), h: size * 0.16 };
  return (
    <View
      style={[styles.centred, { transform: [{ translateY: size * 0.28 }] }]}
      pointerEvents="none"
    >
      <View style={{ flexDirection: 'row', gap: size * 0.11 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: drop.w,
              height: drop.h,
              borderRadius: drop.w,
              backgroundColor: RAIN,
              transform: [{ rotate: '14deg' }, { translateY: i === 1 ? size * 0.04 : 0 }],
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The icon for a `SkyCondition`.
 *
 * `overcast` is the same cloud as `cloudy` in a darker tint plus a second one
 * behind it — a distinct shape would imply a distinct kind of weather, when
 * the only difference is how much of the sky it covers.
 */
export default function WeatherGlyph({
  condition,
  size = 40,
}: {
  condition: SkyCondition;
  size?: number;
}) {
  return (
    <View style={{ width: size, height: size }}>
      {condition === 'clear' && <Sun size={size} />}

      {condition === 'partly' && (
        <>
          <Sun size={size * 0.78} offset={{ x: size * 0.16, y: -size * 0.14 }} />
          <Cloud size={size} offset={{ x: -size * 0.06, y: size * 0.12 }} />
        </>
      )}

      {condition === 'cloudy' && <Cloud size={size} />}

      {condition === 'overcast' && (
        <>
          <Cloud
            size={size * 0.82}
            tint={CLOUD_DARK}
            offset={{ x: size * 0.14, y: -size * 0.14 }}
          />
          <Cloud size={size} offset={{ x: -size * 0.04, y: size * 0.06 }} />
        </>
      )}

      {condition === 'rain' && (
        <>
          <Cloud size={size} tint={CLOUD_DARK} offset={{ x: 0, y: -size * 0.1 }} />
          <Rain size={size} />
        </>
      )}
    </View>
  );
}

/** Plain-English name for a condition, for the line beside the glyph. */
export function conditionLabel(condition: SkyCondition): string {
  switch (condition) {
    case 'clear':
      return 'Clear';
    case 'partly':
      return 'Partly cloudy';
    case 'cloudy':
      return 'Cloudy';
    case 'overcast':
      return 'Overcast';
    case 'rain':
      return 'Rain';
  }
}

/**
 * The colour a cloud-cover figure is drawn in.
 *
 * A ramp from the sky blue the light strip already uses for daylight to the
 * muted grey of `textFaint`, so a column chart of cloud reads as "how grey is
 * it" without a legend. Interpolated in sRGB, which is good enough across two
 * colours this close in luminance.
 */
export function cloudColor(percent: number | null): string {
  if (percent === null) return color.undocumented;
  const t = Math.max(0, Math.min(1, percent / 100));
  const from = [0x7f, 0xb2, 0xe5];
  const to = [0x6b, 0x74, 0x80];
  const mix = from.map((c, i) => Math.round(c + (to[i]! - c) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

const styles = StyleSheet.create({
  centred: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
