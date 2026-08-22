/**
 * Profile — "kind of like an account, but you don't have to make an account."
 *
 * No sign-in, no email, no password. This screen is a face on the identity
 * that already exists: `LOCAL_USER_ID` (`ui/state/useSpots.ts`) is already
 * attached to every spot, note and media row this app has ever written, so
 * the profile is that same id, not a second one — see
 * `storage-local/preferences.ts`'s `getProfileName`/`setProfileName`.
 *
 * Three sections, in the order they get used: Appearance, Performance, Gear.
 * Gear is the one with real content, and deliberately does not sit third on a
 * screen that scrolls out of view — it is last only because it is being built
 * concurrently elsewhere (see below), not because it matters least.
 *
 * ── Scaffold, now with Appearance wired up ─────────────────────────────────
 * Gear (the gear list) is being built by another agent against this same
 * shell — this file owns section order and that placeholder, not its
 * contents. Follows `CircuitScreen.tsx`'s shape for a top-level,
 * non-event-scoped screen (`useSafeAreaInsets` + `MENU_CLEARANCE`) and
 * `EventScreen.tsx`'s use of `Collapsible` for named sections.
 *
 * Appearance (TASKS-profile.md B3) is real: three options — System, Light,
 * Dark — read and write `useTheme()`'s `preference`/`setPreference`, which
 * round-trip through `storage-local/preferences.ts`'s
 * `getThemePreference`/`setThemePreference`. This screen (and `Collapsible`,
 * which it uses throughout) is migrated to `useTheme()` so the switch has a
 * real, visible effect end to end — see `MainMenu.tsx` for the migration
 * pattern this follows.
 *
 * ── The accent hue slider (TASKS-profile.md C1/C2) ──────────────────────────
 * A continuous drag strip, not a swatch grid — the ask was "a slider of
 * color". No gesture library and no `Animated` are installed in this project
 * (`SkyControl.tsx`'s header note explains why neither should be added), so
 * this follows that file's own `PanResponder` + `onLayout`-measured-width +
 * `latestRef` pattern exactly, down to the `pointerEvents="none"` on the
 * visual hue cells so Android hit-tests the strip itself rather than
 * whichever narrow cell sits under the finger (the bug `SkyControl`'s strip
 * hit and fixed). The strip is painted from `deriveAccent` at the *current*
 * `scheme`, not a fixed rainbow — what you see while dragging is exactly
 * what you get, in both palettes. `useTheme()`'s `accentHue`/`setAccentHue`
 * round-trip through `storage-local/preferences.ts`'s
 * `getThemeAccentHue`/`setThemeAccentHue`; the derivation itself (fixed
 * saturation, luminance-solved lightness per scheme) lives in
 * `core/logic/accentColor.ts`, not here — see that file for why the result
 * stays legible for every hue the strip can produce (C2).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveAccent } from '../../core/logic/accentColor';
import Collapsible from '../Collapsible';
import {
  HIT_SIZE,
  MENU_CLEARANCE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
  type ThemePreference,
} from '../theme';

/**
 * Labelled by the choice, not the mechanism — "System" rather than "Follow
 * device" — short enough that three fit in one row at `HIT_SIZE` each on a
 * phone-width screen, per `EventScreen.tsx`/`SpotSheet.tsx`'s existing
 * option-row convention (`SpotSheet.tsx`'s `ACCESS_OPTIONS`,
 * `MainMenu.tsx`'s `USE_OPTIONS`).
 */
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ProfileScreen({
  displayName,
  onChangeDisplayName,
}: {
  /** Null means unnamed — see `setProfileName`. */
  displayName: string | null;
  onChangeDisplayName: (name: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(displayName ?? '');
  const { color, scheme, preference, setPreference, accentHue, setAccentHue } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed !== (displayName ?? '')) onChangeDisplayName(trimmed);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <Text style={styles.kicker}>PROFILE</Text>
      <Text style={styles.title}>Local, not an account</Text>
      <Text style={styles.subtitle}>
        Nothing here leaves this device. There is no sign-in — just settings
        for how the app looks and behaves, and the gear you shoot with.
      </Text>

      <Text style={styles.label}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="Optional — shown nowhere but here"
        placeholderTextColor={color.textFaint}
        style={styles.input}
        returnKeyType="done"
      />

      <Collapsible
        title="Appearance"
        hint="Light, dark, and an accent colour"
        initiallyOpen
      >
        <Text style={styles.help}>
          System follows the phone's own setting, and updates immediately if
          that changes — a sunset switching your phone to dark will not fight
          a Light choice made this morning.
        </Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((option) => {
            const on = option.value === preference;
            return (
              <Pressable
                key={option.value}
                onPress={() => setPreference(option.value)}
                style={({ pressed }) => [
                  styles.themeOption,
                  on && styles.themeOptionOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.themeOptionLabel, on && styles.themeOptionLabelOn]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.label, styles.accentLabel]}>ACCENT COLOUR</Text>
        <AccentHueSlider
          scheme={scheme}
          hue={accentHue}
          onChange={setAccentHue}
          color={color}
        />
      </Collapsible>

      <Collapsible
        title="Performance"
        hint="Map detail, for slower devices"
      >
        <Text style={styles.placeholder}>
          Nothing yet — map detail toggles are coming here.
        </Text>
      </Collapsible>

      <Collapsible
        title="Gear"
        hint="Bodies and lenses, for the event dropdown"
      >
        <Text style={styles.placeholder}>
          Nothing yet — add a body or lens here once gear is built.
        </Text>
      </Collapsible>
    </ScrollView>
  );
}

/** Cells across the hue circle (6° each) — see `AccentHueSlider` below. */
const HUE_TRACK_SEGMENTS = 60;
const KNOB_SIZE = 28;

/**
 * The continuous hue drag strip itself — TASKS-profile.md C1. See this
 * file's header comment for why it follows `SkyControl.tsx`'s `PanResponder`
 * pattern exactly.
 *
 * `touchArea` (not the narrower visual `track`) carries both `onLayout` and
 * `panResponder.panHandlers`, so the width used to convert a touch's
 * `locationX` into a hue is the same element the touch coordinates are
 * reported relative to, and is `HIT_SIZE` tall regardless of how slim the
 * painted strip looks — §5.14's glove-sized touch target without visually
 * ballooning the track.
 */
function AccentHueSlider({
  scheme,
  hue,
  onChange,
  color,
}: {
  scheme: 'light' | 'dark';
  hue: number;
  onChange: (hue: number) => void;
  color: Theme['color'];
}) {
  const [trackWidth, setTrackWidth] = useState(0);

  // Written every render, read only from inside the PanResponder callbacks
  // below — see `SkyControl.tsx`'s file header for why a plain closure over
  // `hue`/`trackWidth` would go stale (PanResponder.create only runs once).
  const latestRef = useRef({ trackWidth });
  latestRef.current.trackWidth = trackWidth;

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const scrubToLocationX = useCallback(
    (evt: GestureResponderEvent) => {
      const { trackWidth: width } = latestRef.current;
      if (width <= 0) return;
      const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width));
      // 360 wraps back to 0 at the strip's own far edge — normalizeHue
      // (`core/logic/accentColor.ts`) would do the same, but the slider
      // itself never produces a value outside [0, 360) to begin with.
      onChange(Math.min(359, Math.round(fraction * 360)));
    },
    [onChange],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: scrubToLocationX,
      onPanResponderMove: scrubToLocationX,
    }),
  ).current;

  // Recomputed only when `scheme` changes, not on every drag frame — the
  // strip shows every hue's colour in the *current* palette, independent of
  // which one is currently selected.
  const cells = useMemo(
    () =>
      Array.from({ length: HUE_TRACK_SEGMENTS }, (_, i) =>
        deriveAccent((i / HUE_TRACK_SEGMENTS) * 360, scheme).accent,
      ),
    [scheme],
  );

  const knobLeft = trackWidth > 0 ? (hue / 360) * trackWidth - KNOB_SIZE / 2 : 0;
  const knobColor = useMemo(() => deriveAccent(hue, scheme).accent, [hue, scheme]);

  return (
    <View
      style={sliderStyles.touchArea}
      onLayout={onTrackLayout}
      {...panResponder.panHandlers}
    >
      <View style={[sliderStyles.track, { borderColor: color.border }]}>
        {cells.map((cellColor, i) => (
          // Purely visual, like SkyControl's hourCell — pointerEvents="none"
          // keeps `touchArea` (not one narrow cell) as the sole hit-test
          // target, which is the Android bug that file's own fix note
          // describes.
          <View key={i} pointerEvents="none" style={[sliderStyles.cell, { backgroundColor: cellColor }]} />
        ))}
      </View>
      {trackWidth > 0 && (
        <View
          pointerEvents="none"
          style={[
            sliderStyles.knob,
            { left: knobLeft, borderColor: color.text, backgroundColor: knobColor },
          ]}
        />
      )}
    </View>
  );
}

/**
 * Structural only (size, radius, border width) — every colour applied to
 * these is theme-derived and passed inline where the element is used, so
 * nothing here goes stale the way a colour baked into a module-level
 * `StyleSheet.create` would (see `theme.ts`'s `ThemeProvider` doc comment).
 */
const sliderStyles = StyleSheet.create({
  touchArea: {
    height: HIT_SIZE,
    justifyContent: 'center',
  },
  track: {
    flexDirection: 'row',
    height: 16,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cell: { flex: 1, height: '100%' },
  knob: {
    position: 'absolute',
    top: (HIT_SIZE - (KNOB_SIZE + 6)) / 2,
    width: KNOB_SIZE,
    height: KNOB_SIZE + 6,
    borderRadius: KNOB_SIZE / 2,
    borderWidth: 3,
  },
});

/**
 * Built per-render from the current theme rather than once at import — see
 * `MainMenu.tsx`'s `makeStyles` and theme.ts's `ThemeProvider` doc comment.
 */
function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.md, paddingBottom: space.xxl },
    pressed: { opacity: 0.7 },

    kicker: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 2,
    },
    title: {
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
      marginTop: space.xs,
    },
    subtitle: {
      color: color.textMuted,
      fontSize: type.label,
      lineHeight: 17,
      marginTop: space.xs,
      marginBottom: space.md,
    },

    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },
    input: {
      marginTop: space.sm,
      marginBottom: space.md,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      color: color.text,
      fontSize: type.body,
      minHeight: 44,
    },

    help: {
      color: color.textMuted,
      fontSize: type.label,
      lineHeight: 17,
      marginBottom: space.sm,
    },
    /**
     * Three options in a row, each `HIT_SIZE` tall — §5.14, and this
     * screen's own instruction that the switch needs "a large enough touch
     * target for HIT_SIZE/gloves". Same shape as `MainMenu.tsx`'s
     * `modeRow`/`mode` (two options) and `SpotSheet.tsx`'s `ACCESS_OPTIONS`
     * rows (a taller single column) — this is the row variant of the same
     * option-picker convention.
     */
    themeRow: { flexDirection: 'row', gap: space.sm },
    themeOption: {
      flex: 1,
      minHeight: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    themeOptionOn: { borderColor: color.accent, backgroundColor: color.surface },
    themeOptionLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    themeOptionLabelOn: { color: color.text },

    accentLabel: { marginTop: space.md, marginBottom: space.xs },

    placeholder: {
      color: color.textFaint,
      fontSize: type.label,
      lineHeight: 17,
      marginTop: space.sm,
    },
  });
}
