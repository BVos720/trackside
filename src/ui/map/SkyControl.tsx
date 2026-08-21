/**
 * The 24-hour light-quality strip, date row, and "Now" control — the primary
 * UI for scrubbing the map's clock, task A3.
 *
 * `clock` is a prop, not a call to `useMapClock()` here — a second call to the
 * hook would create an independent clock instance with its own state, which
 * is exactly the desync bug the task file warns about (§ "the sun and the
 * weather must be reading the *same instant*"). The wiring pass (`B-wire`)
 * calls `useMapClock()` exactly once, at `MapScreen`'s top level, and hands
 * the same `clock` object to this component, `SunDial` (as `at={clock.now}`)
 * and `WeatherOverlay` (as a resolved `condition`) — one instant, three
 * consumers.
 *
 * ── Why the strip doesn't recompute astronomy per frame ─────────────────────
 * `solarPosition`/suncalc is not free, and a drag produces dozens of frames a
 * second. The strip instead samples the *day currently on screen* once, on
 * mount and whenever the calendar date changes (`sampleDayLight`, one call
 * per hour — 24 calls, matching the task note's own suggestion of "one
 * sample per hour, or a coarse grid"). A drag frame itself does only pixel
 * arithmetic (`instantAtFraction` — no `suncalc` call); the one place a
 * render looks quality up rather than recomputing it is the header's
 * quality label, via `nearestHourSample` against the precomputed set.
 *
 * `fractionOfDay`/`instantAtFraction`/`sampleDayLight`/`nearestHourSample`
 * themselves live in `core/logic/lightStrip.ts`, not here — they touch no
 * React/RN API, and this project's `vitest.config.mts` only runs tests under
 * `src/core/` and `src/storage-local/` (component tests are explicitly out
 * of scope there pending `jest-expo`). Keeping them framework-free is what
 * makes them testable at all under the existing test setup; see that file's
 * header for the full reasoning.
 *
 * ── Dragging ─────────────────────────────────────────────────────────────
 * No gesture library and no `Animated` are installed in this project, and
 * neither should be added (`WeatherOverlay`'s header notes the same
 * constraint for animation, for the same reason: a native module and a
 * component known to fight this app's map surface). `PanResponder` — part of
 * core `react-native`, no extra dependency — drives the strip directly.
 *
 * The strip's on-screen width is captured via `onLayout`. Because
 * `PanResponder.create` is called exactly once (`useRef`), its handlers close
 * over whatever was in scope on the *first* render, which is stale by the
 * time a drag actually happens — the classic PanResponder trap. `latestRef`
 * is the fix: it is written on every render (not just via effects) and read
 * from inside the gesture handlers instead of capturing values directly, so
 * the handlers always see the current strip width, clock and day.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import type { LatLon } from '../../core/domain/common';
import {
  fractionOfDay,
  instantAtFraction,
  nearestHourSample,
  sampleDayLight,
} from '../../core/logic/lightStrip';
import { color, lightQualityColor, radius, space, type, weight } from '../theme';
import type { MapClock } from '../state/useMapClock';

const STRIP_HEIGHT = 36;
const KNOB_SIZE = 18;

function formatClock(at: Date): string {
  const h = at.getHours().toString().padStart(2, '0');
  const m = at.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(at: Date): string {
  return at.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function shiftDay(at: Date, deltaDays: number): Date {
  const next = new Date(at);
  next.setDate(next.getDate() + deltaDays);
  return next;
}

export default function SkyControl({
  clock,
  position,
  /** Distance from the top of the screen, already clear of the safe area. */
  top,
  /** Distance from the bottom of the screen, already clear of the safe area. */
  bottom,
}: {
  clock: MapClock;
  position: LatLon;
  top?: number;
  bottom?: number;
}) {
  const [stripWidth, setStripWidth] = useState(0);

  // Written every render, read only from inside PanResponder callbacks — see
  // the file header for why a plain closure over `clock`/`stripWidth` would
  // go stale.
  const latestRef = useRef<{ clock: MapClock; stripWidth: number }>({
    clock,
    stripWidth,
  });
  latestRef.current.clock = clock;
  latestRef.current.stripWidth = stripWidth;

  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    setStripWidth(e.nativeEvent.layout.width);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => scrubToLocationX(evt),
      onPanResponderMove: (evt: GestureResponderEvent) => scrubToLocationX(evt),
    }),
  ).current;

  function scrubToLocationX(evt: GestureResponderEvent) {
    const { clock: currentClock, stripWidth: width } = latestRef.current;
    if (width <= 0) return;
    const fraction = evt.nativeEvent.locationX / width;
    currentClock.scrubTo(instantAtFraction(currentClock.now, fraction));
  }

  // Keyed on the calendar day (plus position) rather than `clock.now`
  // itself, which changes every live tick — the sample set only needs
  // rebuilding when the day actually changes. See the file header.
  const dayKey = clock.now.toDateString();
  const samples = useMemo(
    () => sampleDayLight(clock.now, position),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately
    // keyed on the day string and coordinates, not the `Date`/`LatLon`
    // objects (fresh references every render) or the full `clock.now`
    // (changes every live tick without changing the sample set).
    [dayKey, position.latitude, position.longitude],
  );

  const fraction = fractionOfDay(clock.now);
  const knobLeft = stripWidth > 0 ? fraction * stripWidth - KNOB_SIZE / 2 : 0;
  // Cheap per-render lookup into the precomputed samples — no `suncalc` call,
  // just the same helper a drag frame would use if it needed the quality
  // rather than the raw instant.
  const currentQuality = nearestHourSample(samples, fraction)?.quality ?? null;

  const goToDay = (deltaDays: number) => {
    clock.scrubTo(shiftDay(clock.now, deltaDays));
  };

  return (
    <View
      style={[
        styles.root,
        top === undefined ? null : { top },
        bottom === undefined ? null : { bottom },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>SKY</Text>
        <Text style={styles.timeLabel}>{formatClock(clock.now)}</Text>
        {currentQuality && (
          <Text style={styles.qualityLabel}>{currentQuality.toUpperCase()}</Text>
        )}
        <Text
          accessibilityRole="button"
          onPress={() => clock.resumeNow()}
          style={[styles.nowButton, clock.isLive && styles.nowButtonLive]}
        >
          {clock.isLive ? 'LIVE' : 'NOW'}
        </Text>
      </View>

      <View style={styles.strip} onLayout={onStripLayout} {...panResponder.panHandlers}>
        {samples.map((s) => (
          <View
            key={s.hour}
            // Purely visual — must not be a touch target. Without this,
            // Android hit-tests to whichever hour cell is under the finger
            // and reports `locationX` relative to *that* narrow cell (about
            // 1/24 of the strip's width) instead of the strip itself, which
            // makes every drag land within a few minutes of the cell's own
            // start regardless of where on the strip you actually touch —
            // the strip's own `panResponder.panHandlers` must stay the sole
            // hit-test target.
            pointerEvents="none"
            style={[styles.hourCell, { backgroundColor: lightQualityColor[s.quality] }]}
          />
        ))}
        {stripWidth > 0 && (
          <View style={[styles.knob, { left: knobLeft }]} pointerEvents="none" />
        )}
      </View>

      <View style={styles.hourTicks} pointerEvents="none">
        <Text style={styles.hourTick}>00</Text>
        <Text style={styles.hourTick}>06</Text>
        <Text style={styles.hourTick}>12</Text>
        <Text style={styles.hourTick}>18</Text>
        <Text style={styles.hourTick}>24</Text>
      </View>

      <View style={styles.dateRow}>
        <Text
          style={styles.dateArrow}
          accessibilityRole="button"
          onPress={() => goToDay(-1)}
        >
          ‹
        </Text>
        <Text style={styles.dateLabel}>{formatDate(clock.now)}</Text>
        <Text
          style={styles.dateArrow}
          accessibilityRole="button"
          onPress={() => goToDay(1)}
        >
          ›
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,13,16,0.86)',
    borderWidth: 1,
    borderColor: color.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  title: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },
  timeLabel: {
    marginLeft: space.sm,
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  qualityLabel: {
    marginLeft: space.sm,
    color: color.textFaint,
    fontSize: 9,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  nowButton: {
    marginLeft: 'auto',
    color: color.text,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  nowButtonLive: {
    color: color.onAccent,
    backgroundColor: color.accent,
    borderColor: color.accent,
  },

  strip: {
    flexDirection: 'row',
    height: STRIP_HEIGHT,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  hourCell: { flex: 1, height: '100%' },
  knob: {
    position: 'absolute',
    top: -3,
    width: KNOB_SIZE,
    height: STRIP_HEIGHT + 6,
    borderRadius: KNOB_SIZE / 2,
    borderWidth: 2,
    borderColor: color.text,
    backgroundColor: 'transparent',
  },

  hourTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  hourTick: { color: color.textFaint, fontSize: 9, fontVariant: ['tabular-nums'] },

  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
    gap: space.md,
  },
  dateArrow: {
    color: color.textMuted,
    fontSize: type.title,
    fontWeight: weight.bold,
    paddingHorizontal: space.md,
    // Assume gloves — HIT_SIZE-ish tap target without literally reserving
    // that much visual space either side of a small date label.
    paddingVertical: space.xs,
  },
  dateLabel: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    minWidth: 120,
    textAlign: 'center',
  },
});
