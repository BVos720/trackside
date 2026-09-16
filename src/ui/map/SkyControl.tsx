import { Text } from '../Typography';
/**
 * The 24-hour light-quality strip, date row, and "Now" control — the primary
 * UI for scrubbing the map's clock, task A3/D1/D2.
 *
 * `clock` is a prop, not a call to `useMapClock()` here — a second call to the
 * hook would create an independent clock instance with its own state, which
 * is exactly the desync bug the task file warns about (§ "the sun and the
 * weather must be reading the *same instant*"). `MapScreen` calls
 * `useMapClock()` exactly once, at its top level, and hands the same `clock`
 * object to this component and `SunDial` (as `at={clock.now}`) — one
 * instant, both consumers.
 *
 * ── Why the strip doesn't recompute astronomy per frame ─────────────────────
 * `solarPosition`/suncalc is not free, and a drag produces dozens of frames a
 * second. The strip instead samples the *day currently on screen* once, on
 * mount and whenever the calendar date changes (`sampleDayLight`, one call
 * per hour — 24 calls, matching the task note's own suggestion of "one
 * sample per hour, or a coarse grid"). A drag frame itself does only pixel
 * arithmetic (`instantAtFraction` — no `suncalc` call). The header's own
 * quality label is computed exactly instead of via the sampled set — see
 * the note beside `currentQuality` below for why that one value is cheap
 * enough not to need the same coarseness as the 24-cell strip.
 *
 * `fractionOfDay`/`instantAtFraction`/`sampleDayLight`/`nearestHourSample`
 * themselves live in `core/logic/lightStrip.ts`, not here — they touch no
 * React/RN API, and this project's `vitest.config.mts` only runs tests under
 * `src/core/`, `src/storage-local/` and `src/ui/state/` (component tests are
 * explicitly out of scope there pending `jest-expo`). Keeping them
 * framework-free is what makes them testable at all under the existing test
 * setup; see that file's header for the full reasoning.
 *
 * ── Dragging ─────────────────────────────────────────────────────────────
 * No gesture library and no `Animated` are installed in this project, and
 * neither should be added (`WeatherOverlay`'s old header noted the same
 * constraint for animation, for the same reason: a native module and a
 * component known to fight this app's map surface). `PanResponder` — part of
 * core `react-native`, no extra dependency — drives the strip directly, and
 * the collapse/expand below (D2) snaps between two fixed heights rather than
 * animating between them for the same reason.
 *
 * The strip's on-screen width is captured via `onLayout`. Because
 * `PanResponder.create` is called exactly once (`useRef`), its handlers close
 * over whatever was in scope on the *first* render, which is stale by the
 * time a drag actually happens — the classic PanResponder trap. `latestRef`
 * is the fix: it is written on every render (not just via effects) and read
 * from inside the gesture handlers instead of capturing values directly, so
 * the handlers always see the current strip width, clock and day.
 *
 * ── D2: quiet until touched ──────────────────────────────────────────────
 * The full 24-hour strip, hour ticks and date row are furniture for
 * something used a few seconds at a time (task: "it doesn't feel like it's
 * all cluttered"). Collapsed by default to a slim strip — same 24-cell
 * gradient, just short — that expands to the full interactive height for as
 * long as a thumb is down (`onPanResponderGrant`/`Release`/`Terminate`
 * toggle `expanded`) and recedes the moment it lifts. The header row (time,
 * quality, the Now/Live control) is a sibling that renders unconditionally —
 * "Now" has to stay reachable without expanding anything (task D2), and it
 * already lived outside the strip, so nothing moves to satisfy that.
 * `hitSlop` keeps the *touch* target glove-sized (§5.14, `HIT_SIZE`) even
 * though the *visible* collapsed strip is deliberately thin — the two are
 * allowed to disagree.
 *
 * ── D1/D4: reading as part of the map, not a card on top of it ──────────────
 * No enclosing rectangle, no border, no background fill — the strip itself
 * (already its own rounded, bordered bar; that shape is content, not
 * chrome) is the only solid object. Header and date-row text get a drop
 * shadow for contrast against the map's own brightness instead of a
 * background box (D4).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import type { LatLon } from '../../core/domain/common';
import {
  fractionOfDay,
  instantAtFraction,
  sampleDayLight,
} from '../../core/logic/lightStrip';
import { lightQuality, solarPosition } from '../../core/logic/sun';
import {
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';
import type { HourlyForecastPoint } from '../../core/logic/forecast';
import { rgbString, sampleDayRamp } from '../../core/logic/lightRamp';
import { weatherMarksForDay } from '../../core/logic/weatherMarks';
import type { MapClock } from '../state/useMapClock';

/** Full interactive height, while a thumb is down. Matches the old always-on height. */
const STRIP_HEIGHT_EXPANDED = 36;
/** D2's "quiet" height — a hint of the day's shape, not a control. */
const STRIP_HEIGHT_COLLAPSED = 10;

const KNOB_SIZE = 18;
/**
 * Extra invisible touch margin so the collapsed strip stays glove-sized
 * (§5.14) despite reading thin. `top` is deliberately much smaller than the
 * other three sides — the "Now"/"Live" button sits directly above with only
 * `space.sm` of real gap, and this hitSlop must not reach up far enough to
 * steal a tap meant for that button. `bottom`/`left`/`right` face open map,
 * so they can be generous.
 */
const STRIP_HIT_SLOP = { top: 6, bottom: 24, left: 4, right: 4 };
/** The Now/Live control gets its own slop rather than relying on the strip's falling short of it. */
const NOW_BUTTON_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * The time at the circuit, not on this phone.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 * The dial's sun comes from the venue's latitude and longitude, so it has
 * always described the right sky. The clock beside it did not — it was the
 * device's. Opening Suzuka from the Netherlands read "13:41 · DARK": two true
 * statements that together look like a contradiction. It is dark at Suzuka,
 * because there it is 20:41.
 *
 * A photographer plans against a session sheet, and a session sheet is always
 * in the circuit's local time. So that is what this shows, wherever you are.
 *
 * ── Falls back rather than lying ──────────────────────────────────────────
 * If the engine cannot resolve the zone, this returns the device's own time
 * rather than nothing: a clock that is an hour out is still a clock, and a
 * blank where the time should be helps nobody. That path should not happen —
 * every venue carries a real IANA zone — but this is drawn over a live map and
 * is not worth an exception.
 */
function formatClock(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      // h23 rather than hour12:false — some engines render midnight as "24".
      hourCycle: 'h23',
    }).format(at);
  } catch {
    const h = at.getHours().toString().padStart(2, '0');
    const m = at.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

/**
 * The date at the circuit.
 *
 * Follows the clock for the same reason: at Suzuka seen from Europe the day
 * turns over eight hours before this phone's does, and a dial whose time and
 * date disagreed about which day it was would be worse than either being
 * wrong on its own.
 */
function formatDate(at: Date, timeZone: string): string {
  return at.toLocaleDateString(undefined, {
    timeZone,
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
  timeZone,
  forecast = [],
  onHeightChange,
}: {
  clock: MapClock;
  position: LatLon;
  top?: number;
  bottom?: number;
  /** The circuit's IANA zone — see `formatClock`. */
  timeZone: string;
  /**
   * The venue's hourly forecast, for the weather marks.
   *
   * Optional and defaulting to empty, because there is often no forecast at
   * all — no signal, or a circuit nobody has an event at — and the strip has
   * to be complete without it. No marks then, rather than a row of question
   * marks.
   */
  forecast?: readonly HourlyForecastPoint[];
  onHeightChange?: (height: number) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [stripWidth, setStripWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  /**
   * Tap to open, tap again to close — and drag to scrub.
   *
   * ── The bug this fixes ────────────────────────────────────────────────
   * The date row lives inside the expanded section, and expansion used to last
   * exactly as long as a thumb was down. So changing the day meant holding the
   * strip with one finger and reaching the arrows with another — and letting go
   * to do it collapsed the very row you were reaching for.
   *
   * ── The complication, and how it is resolved ──────────────────────────
   * This strip is also the scrubber, so "tap to close" and "tap to pick a
   * time" want the same gesture. They are separated by movement rather than by
   * position, which is the only division that does not need a second control:
   *
   *   collapsed + tap   -> open, and scrub to where you touched
   *   expanded  + drag  -> scrub, stay open
   *   expanded  + tap   -> close, and do *not* scrub
   *
   * That last one matters. Closing is not a request to change the time, and a
   * panel that moved the sun on its way out would be its own bug report.
   *
   * ── Why not a timer ───────────────────────────────────────────────────
   * There was one, briefly: it lingered five seconds and closed itself. It is
   * gone because two closing mechanisms are worse than one — a panel that
   * sometimes vanishes on its own and sometimes waits is a panel you cannot
   * predict. D2's "quiet until touched" is still honoured; closing it is now
   * simply something you do rather than something that happens to you.
   */
  const startedExpanded = useRef(false);
  const moved = useRef(false);

  const stripHeight = expanded ? STRIP_HEIGHT_EXPANDED : STRIP_HEIGHT_COLLAPSED;

  // Written every render, read only from inside PanResponder callbacks — see
  // the file header for why a plain closure over `clock`/`stripWidth` would
  // go stale.
  const latestRef = useRef<{
    clock: MapClock;
    stripWidth: number;
    expanded: boolean;
    setExpanded: (on: boolean) => void;
    startedExpanded: { current: boolean };
    moved: { current: boolean };
  }>({
    clock,
    stripWidth,
    expanded,
    setExpanded,
    startedExpanded,
    moved,
  });
  latestRef.current.clock = clock;
  latestRef.current.stripWidth = stripWidth;
  // Through the ref like everything else the PanResponder touches: it is built
  // once, so a value captured directly would be the first render's forever —
  // and `expanded` is precisely the value that must not go stale here.
  latestRef.current.expanded = expanded;
  latestRef.current.setExpanded = setExpanded;

  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    setStripWidth(e.nativeEvent.layout.width);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const wasExpanded = latestRef.current.expanded;
        latestRef.current.startedExpanded.current = wasExpanded;
        latestRef.current.moved.current = false;

        // Opening and scrubbing are the same act; closing is not. So a touch
        // that starts on an already-open strip commits to nothing until we
        // know whether it becomes a drag.
        if (!wasExpanded) {
          latestRef.current.setExpanded(true);
          scrubToLocationX(evt);
        }
      },

      onPanResponderMove: (evt: GestureResponderEvent) => {
        latestRef.current.moved.current = true;
        scrubToLocationX(evt);
      },

      onPanResponderRelease: () => {
        const { startedExpanded: was, moved: didMove, setExpanded } = latestRef.current;
        // A tap on an open strip is the close gesture. Everything else leaves
        // it open — including a drag, which is someone still working.
        if (was.current && !didMove.current) setExpanded(false);
      },

      // A gesture taken away by the OS is not a decision about anything.
      onPanResponderTerminate: () => {},
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
  /*
    The day as a gradient rather than 24 steps.

    The four flat colours were honest about the *category* of light and
    dishonest about how it arrives: sunrise is not a boundary between two
    hours, it is a twenty-minute slide, and where in that slide a session
    falls is the thing the strip is being read for.

    96 steps is 15 minutes each — fine enough that the seams disappear at this
    width, coarse enough that redrawing it on every frame of a drag stays
    cheap. Same anchor colours as before, so this reads as the same instrument
    with the steps taken out rather than a new palette.
  */
  const ramp = useMemo(
    () => sampleDayRamp(clock.now, position, 96),
    // Keyed like `samples` below: on the day and the place, not on objects
    // that are fresh on every render or a clock that ticks every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayKey, position.latitude, position.longitude],
  );

  /*
    What the sky will be doing, hour by hour.

    Light and weather are not separable in practice: golden hour under a
    closed sky is not golden hour, and a shot that needs the sun behind you
    needs to know whether there will be one.

    Only cloudy and wet hours get a mark. An absent mark is the honest
    rendering of both "clear" and "we have no forecast for that hour" — a
    clear-sky symbol for an hour the provider never sent would be a claim.
  */
  const weatherMarks = useMemo(() => {
    const d = clock.now;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    return weatherMarksForDay(forecast, iso);
  }, [forecast, dayKey]);

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
  /**
   * The header's quality label, computed exactly for `clock.now` — not looked
   * up via `nearestHourSample`. That helper's per-hour coarseness exists to
   * keep the *strip's 24 cells* cheap to colour, which matters because they
   * redraw on every drag frame; the header label is a single value computed
   * once per render, exactly as cheap as `SunDial`'s own per-render
   * `solarPosition` call, so there is no perf reason to accept its coarseness
   * here too. Using the sampled version was found to visibly disagree with
   * `SunDial` near a light-quality transition (e.g. the strip's own hour
   * bucket still reading `golden` a few minutes into `blue`) — two widgets
   * showing contradictory quality for the same instant, worse than the cost
   * of one extra `solarPosition` call.
   */
  const currentQuality = lightQuality(solarPosition(clock.now, position).altitude);

  const goToDay = (deltaDays: number) => {
    clock.scrubTo(shiftDay(clock.now, deltaDays));
  };

  return (
    <View
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        styles.root,
        top === undefined ? null : { top },
        bottom === undefined ? null : { bottom },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>SKY</Text>
        <Text style={styles.timeLabel}>{formatClock(clock.now, timeZone)}</Text>
        {currentQuality && (
          <Text style={styles.qualityLabel}>{currentQuality.toUpperCase()}</Text>
        )}
        {/*
          A `Pressable`, not a `Text` with `onPress` — the strip immediately
          below carries its own `hitSlop` (D2, so the thin collapsed strip
          stays glove-easy to grab) and the two controls sit only
          `space.sm` apart. `Text` has no `hitSlop` of its own to defend
          this button's edge with; `Pressable` does, so the button owns its
          touch area outright instead of hoping the strip's slop stops short.
        */}
        <Pressable
          accessibilityRole="button"
          hitSlop={NOW_BUTTON_HIT_SLOP}
          onPress={() => clock.resumeNow()}
          style={[styles.nowButton, clock.isLive && styles.nowButtonLive]}
        >
          <Text style={[styles.nowButtonLabel, clock.isLive && styles.nowButtonLabelLive]}>
            {clock.isLive ? 'LIVE' : 'NOW'}
          </Text>
        </Pressable>
      </View>

      <View
        style={[styles.strip, { height: stripHeight }]}
        onLayout={onStripLayout}
        hitSlop={STRIP_HIT_SLOP}
        {...panResponder.panHandlers}
      >
        {ramp.map((step, i) => (
          <View
            key={i}
            // Purely visual — must not be a touch target. Without this,
            // Android hit-tests to whichever hour cell is under the finger
            // and reports `locationX` relative to *that* narrow cell (about
            // 1/24 of the strip's width) instead of the strip itself, which
            // makes every drag land within a few minutes of the cell's own
            // start regardless of where on the strip you actually touch —
            // the strip's own `panResponder.panHandlers` must stay the sole
            // hit-test target.
            pointerEvents="none"
            style={[styles.hourCell, { backgroundColor: rgbString(step.color) }]}
          />
        ))}
        {/*
          Weather over the light, under the knob.

          Positioned by hour across the same axis as the gradient, so a mark
          sits above the light it qualifies. pointerEvents none for the same
          reason the gradient cells have it: the strip's own pan handler must
          stay the only hit-test target, or a drag starting on a mark reports
          coordinates relative to the mark instead of the strip.
        */}
        {stripWidth > 0 &&
          expanded &&
          weatherMarks.map((m) => (
            <Text
              key={m.hour}
              pointerEvents="none"
              style={[
                styles.weatherMark,
                { left: ((m.hour + 0.5) / 24) * stripWidth - 6 },
              ]}
            >
              {m.kind === 'rain' ? '☂' : '☁'}
            </Text>
          ))}

        {stripWidth > 0 && (
          <View
            style={[
              styles.knob,
              { left: knobLeft, height: stripHeight + 6 },
            ]}
            pointerEvents="none"
          />
        )}
      </View>

      {expanded && (
        <>
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
            <Text style={styles.dateLabel}>{formatDate(clock.now, timeZone)}</Text>
            <Text
              style={styles.dateArrow}
              accessibilityRole="button"
              onPress={() => goToDay(1)}
            >
              ›
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

/**
 * Shared by every loose text label below — see `SunDial.tsx`'s identical
 * constant for why a drop shadow replaces the background box this control
 * used to sit on (D4), and why `'#000'` specifically (matches the app's one
 * existing drop-shadow convention in `PlannerScreen.tsx`).
 */
const textLegibility = {
  textShadowColor: '#000',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: {
      position: 'absolute',
      left: space.md,
      right: space.md,
      padding: 14,
      borderRadius: 20,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      flexWrap: 'wrap',
      rowGap: 8,
    },
    title: {
      ...textLegibility,
      color: color.text,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },
    timeLabel: {
      ...textLegibility,
      marginLeft: space.sm,
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },
    qualityLabel: {
      ...textLegibility,
      marginLeft: space.sm,
      color: color.textMuted,
      fontSize: 9,
      fontWeight: weight.bold,
      letterSpacing: 1,
    },
    /**
     * The one button on this control, so it keeps its own opaque fill even
     * though the panel around it lost its own (D1) — a tap target has to stay
     * legible and feel pressable regardless of what the "quiet" strip below it
     * is doing, and `HIT_SIZE`-style controls elsewhere in the app are always
     * solid, never see-through. A `Pressable` now (see the JSX comment above),
     * so layout/paint lives here and text styling lives in `nowButtonLabel`.
     */
    nowButton: {
      marginLeft: 'auto',
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      minHeight: 36,
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    },
    nowButtonLive: {
      backgroundColor: color.accent,
      borderColor: color.accent,
    },
    nowButtonLabel: {
      ...textLegibility,
      color: color.text,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1,
    },
    nowButtonLabelLive: {
      color: color.onAccent,
      textShadowColor: 'transparent',
    },

    strip: {
      flexDirection: 'row',
      borderRadius: radius.sm,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: color.border,
    },
    /*
   * Small, and only while the strip is open.
   *
   * The collapsed strip is a hint of the day's shape rather than a control,
   * and symbols on it would be unreadable at that height as well as noisy.
   */
  weatherMark: {
    position: 'absolute',
    top: -2,
    width: 12,
    textAlign: 'center',
    fontSize: 10,
    color: color.text,
    opacity: 0.85,
  },

  hourCell: { flex: 1, height: '100%' },
    knob: {
      position: 'absolute',
      top: -3,
      width: KNOB_SIZE,
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
    hourTick: { ...textLegibility, color: color.textMuted, fontSize: 9, fontVariant: ['tabular-nums'] },

    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.sm,
      gap: space.md,
    },
    dateArrow: {
      ...textLegibility,
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
      paddingHorizontal: space.md,
      // Assume gloves — HIT_SIZE-ish tap target without literally reserving
      // that much visual space either side of a small date label.
      paddingVertical: space.xs,
    },
    dateLabel: {
      ...textLegibility,
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
      minWidth: 120,
      textAlign: 'center',
    },
  });
}
