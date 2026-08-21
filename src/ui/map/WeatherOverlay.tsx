/**
 * Ambient weather over the map — B2.
 *
 * "Like Pokémon Go": atmosphere, not a radar overlay. The map is the tool a
 * photographer is reading corners and walk times off of; the weather is
 * context sitting on top of it, and it must never win that fight — see the
 * per-condition notes below for how each one stays out of the way.
 *
 * This component does not resolve *which* condition applies to the clock's
 * current instant — B1's logic does that (`skyConditionAt` or equivalent, in
 * `core/logic/`), and the wiring pass calls it and passes the result down as
 * `condition`. Keeping that resolution outside this file means it never needs
 * to know B1's exact signature, matches how `SunDial` takes an already-
 * resolved `at` rather than the clock hook itself, and keeps this file about
 * rendering only.
 *
 * `condition === 'unknown'` renders nothing at all, not a default/clear-sky
 * look — an hour the forecast never covered is not "probably fine", and
 * guessing here is worse than an honest blank (§0.2).
 *
 * No particle library, no `react-native-svg`, no `Animated` — deliberately,
 * per the task notes: a particle library is a native module nobody wants to
 * rebuild for, and RN's `Animated` is known to fight MapLibre's own view
 * updates on this project. Rain is a fixed set of `View`s whose `top`/
 * `opacity` are recomputed from a single `requestAnimationFrame`-driven tick
 * and written back through plain style props — the same dependency-free
 * approach as the rest of `src/ui/map/`. The tick updates are throttled to
 * ~30fps: raindrops are ambient background, and re-rendering ~40 elements on
 * every one of the map's own 60 frames would be pure waste for a gain no one
 * would see.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { color } from '../theme';
import type { SkyCondition } from '../../core/logic/forecast';

export interface WeatherOverlayProps {
  /**
   * The condition at the clock's current instant, already resolved by the
   * caller — see the file header. `'unknown'` means the forecast does not
   * cover this instant.
   */
  condition: SkyCondition | 'unknown';
  style?: StyleProp<ViewStyle>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pure helpers — the fixed scatter and the condition→visual mapping. Kept
 * free of React and RN so they are plain to test.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * mulberry32 — a small, fast, deterministic PRNG.
 *
 * The scatter has to be *fixed*, not merely random: reshuffling the streaks'
 * positions on every render would read as flicker, not weather (see the task
 * note this file was built against). Seeding a deterministic generator once
 * and drawing every element from it up front, rather than reaching for
 * `Math.random()`, is what makes the layout stable across re-renders without
 * needing to memoise a `Math.random()`-built array and hope nothing ever
 * forces it to run twice.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RainStreak {
  readonly leftPercent: number;
  readonly lengthPx: number;
  readonly thicknessPx: number;
  readonly opacity: number;
  readonly speedPxPerSec: number;
  /** 0–1, so streaks don't all start their fall from the same offset. */
  readonly phaseOffset: number;
}

export interface CloudPatch {
  readonly leftPercent: number;
  readonly topPercent: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly opacity: number;
}

const RAIN_SEED = 0x5eed;
const CLOUD_SEED = 0xc10d;

/** The full fixed pool of rain streaks. A condition draws its slice of this
 * via `visualFor().rainStreakCount` rather than generating a fresh array per
 * intensity, so switching between e.g. `cloudy` and `rain` never reshuffles
 * the streaks that were already on screen. */
export function makeRainStreaks(count: number, seed = RAIN_SEED): RainStreak[] {
  const rand = mulberry32(seed);
  const streaks: RainStreak[] = [];
  for (let i = 0; i < count; i++) {
    streaks.push({
      leftPercent: rand() * 100,
      lengthPx: 14 + rand() * 14,
      thicknessPx: 1 + rand() * 1,
      opacity: 0.25 + rand() * 0.35,
      speedPxPerSec: 320 + rand() * 220,
      phaseOffset: rand(),
    });
  }
  return streaks;
}

/** Same fixed-pool idea as `makeRainStreaks`, for the flat cloud patches. */
export function makeCloudPatches(count: number, seed = CLOUD_SEED): CloudPatch[] {
  const rand = mulberry32(seed);
  const patches: CloudPatch[] = [];
  for (let i = 0; i < count; i++) {
    patches.push({
      leftPercent: rand() * 100,
      topPercent: rand() * 100,
      widthPx: 140 + rand() * 160,
      heightPx: 60 + rand() * 70,
      opacity: 0.05 + rand() * 0.06,
      // eslint-disable-next-line no-empty -- placeholder to keep formatting stable
    });
  }
  return patches;
}

export interface WeatherVisual {
  /** Flat grey wash over the whole map. 0 draws nothing. */
  readonly tintOpacity: number;
  readonly rainStreakCount: number;
  readonly cloudPatchCount: number;
}

/** The largest pool either helper is ever asked to slice from. */
export const RAIN_STREAK_POOL = 42;
export const CLOUD_PATCH_POOL = 6;

/**
 * What to draw for a condition, or `null` to draw nothing.
 *
 * `'unknown'` and `'clear'` both draw nothing — `'unknown'` because guessing
 * is worse than an honest blank (§0.2), `'clear'` because it is the baseline
 * most events never leave. `'partly'` stays close to that baseline: a couple
 * of faint patches, no tint, easy to miss on purpose. `'cloudy'`/`'overcast'`
 * step up as flat grey light rather than a drawn-in cloud layer — the tint
 * carries the read, the patches only add texture. `'rain'` is the one
 * condition worth animating.
 */
export function visualFor(condition: SkyCondition | 'unknown'): WeatherVisual | null {
  switch (condition) {
    case 'unknown':
    case 'clear':
      return null;
    case 'partly':
      return { tintOpacity: 0, rainStreakCount: 0, cloudPatchCount: 2 };
    case 'cloudy':
      return { tintOpacity: 0.12, rainStreakCount: 0, cloudPatchCount: 4 };
    case 'overcast':
      return { tintOpacity: 0.22, rainStreakCount: 0, cloudPatchCount: 6 };
    case 'rain':
      return { tintOpacity: 0.18, rainStreakCount: 40, cloudPatchCount: 5 };
    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The component
 * ──────────────────────────────────────────────────────────────────────────── */

export default function WeatherOverlay({ condition, style }: WeatherOverlayProps) {
  const visual = visualFor(condition);
  const needsAnimation = (visual?.rainStreakCount ?? 0) > 0;

  // Generated once and sliced per-condition, never re-rolled — see the file
  // header and `makeRainStreaks`/`makeCloudPatches` above.
  const streaks = useMemo(() => makeRainStreaks(RAIN_STREAK_POOL), []);
  const patches = useMemo(() => makeCloudPatches(CLOUD_PATCH_POOL), []);

  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!needsAnimation) return undefined;

    let mounted = true;
    const loop = (now: number) => {
      if (!mounted) return;
      // Throttled to ~30fps — see the file header.
      if (now - lastTickRef.current >= 33) {
        lastTickRef.current = now;
        setTick(now);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      mounted = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [needsAnimation]);

  if (!visual) return null;

  const windowHeight = Dimensions.get('window').height;

  return (
    <View style={[styles.root, style]} pointerEvents="none">
      {visual.tintOpacity > 0 && (
        <View style={[styles.tint, { opacity: visual.tintOpacity }]} />
      )}

      {patches.slice(0, visual.cloudPatchCount).map((p, i) => (
        <View
          key={i}
          style={[
            styles.patch,
            {
              left: `${p.leftPercent}%`,
              top: `${p.topPercent}%`,
              width: p.widthPx,
              height: p.heightPx,
              borderRadius: p.heightPx / 2,
              opacity: p.opacity,
            },
          ]}
        />
      ))}

      {visual.rainStreakCount > 0 &&
        streaks.slice(0, visual.rainStreakCount).map((s, i) => {
          const travel = windowHeight + s.lengthPx * 2;
          const y =
            (((tick / 1000) * s.speedPxPerSec + s.phaseOffset * travel) % travel) -
            s.lengthPx;
          return (
            <View
              key={i}
              style={[
                styles.streak,
                {
                  left: `${s.leftPercent}%`,
                  top: y,
                  height: s.lengthPx,
                  width: s.thicknessPx,
                  opacity: s.opacity,
                },
              ]}
            />
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // `StyleSheet.absoluteFillObject` isn't in this RN version's typings
    // (only the opaque `absoluteFill` is) — spelled out explicitly instead.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.textFaint,
  },
  patch: {
    position: 'absolute',
    backgroundColor: color.textFaint,
  },
  streak: {
    position: 'absolute',
    backgroundColor: color.textMuted,
    borderRadius: 2,
    transform: [{ rotate: '12deg' }],
  },
});
