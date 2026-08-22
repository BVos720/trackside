/**
 * Top-left menu — the app's only navigation.
 *
 * The map is home; everything else is a destination reached from here. That
 * keeps the map full-bleed, which matters more on a phone at a circuit than a
 * persistent tab bar does — §5.14 wants the field view brutally legible, and a
 * bar eating 60pt of a 6" screen is 60pt not showing the track.
 *
 * The trigger doubles as the status line: it shows which circuit and which
 * event you are in, because those two facts change what every other screen is
 * about, and getting them wrong wastes a day.
 */
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpotUse } from '../core/domain/spot';
import { VENUE_VIEW, type VenueKey } from './map/style';
import {
  MENU_HEIGHT,
  MENU_TOP,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from './theme';

/**
 * The two things you can be at a circuit to do.
 *
 * Labelled by the activity rather than the noun — "Photography" and
 * "Spectating" read as what you are here for, which is the question the switch
 * is actually asking.
 */
const USE_OPTIONS: { value: SpotUse; label: string }[] = [
  { value: SpotUse.Photography, label: 'Photography' },
  { value: SpotUse.Spectating, label: 'Spectating' },
];

export type Destination =
  | 'map'
  | 'list'
  | 'times'
  | 'events'
  | 'event'
  | 'plan'
  | 'circuit'
  | 'profile';

/**
 * Top-level destinations.
 *
 * Two destinations are deliberately absent.
 *
 * `plan` belongs to one event, so it is reached from inside that event. Listing
 * it here would offer a destination that means nothing until something else is
 * selected, and would need a "no event active" state on a menu row.
 *
 * `times` is a property of an event — a timetable is *this weekend's* running
 * order, not the circuit's — so it lives inside the event alongside the plan
 * it feeds. Sessions with no event to belong to have nothing to schedule
 * against.
 *
 * `list` sits on the map itself, bottom left. It is the one screen you open
 * *while* looking at the map — to find the spot you can see a pin for — so
 * putting it two taps deep in a menu was one tap too many for the thing you do
 * most.
 *
 * `profile` belongs here, unlike those three: it is not scoped to an event or
 * a spot, so there is no "which one" question a menu row would leave
 * unanswered.
 */
const ITEMS: { key: Destination; label: string; hint: string }[] = [
  { key: 'map', label: 'Map', hint: 'Waypoints and the circuit' },
  { key: 'events', label: 'Events', hint: 'Pick a weekend, or start clean' },
  { key: 'circuit', label: 'Circuit', hint: 'Switch venue' },
  { key: 'profile', label: 'Profile', hint: 'Appearance, performance, gear' },
];

export default function MainMenu({
  open,
  onOpenChange,
  venue,
  eventName,
  counts,
  spotUse,
  useCounts,
  onSpotUseChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venue: VenueKey;
  /** Null means the default map — every spot at this circuit. */
  eventName: string | null;
  counts: { spots: number; sessions: number; events: number; stops: number };
  /** Camera positions or watching positions — what the map is showing. */
  spotUse: SpotUse;
  /** How many spots each mode would show, for the switch's labels. */
  useCounts: Record<SpotUse, number>;
  onSpotUseChange: (use: SpotUse) => void;
  onNavigate: (to: Destination) => void;
}) {
  const insets = useSafeAreaInsets();
  const { color } = useTheme();
  // `StyleSheet.create` freezes whatever it is given at call time, so the
  // styles are rebuilt here — inside the render, keyed on the theme's colour
  // object — rather than once at module import (see theme.ts's ThemeProvider
  // doc comment for why that matters).
  const styles = useMemo(() => makeStyles(color), [color]);

  const badge = (key: Destination): string | null => {
    if (key === 'list' || key === 'map') return counts.spots ? String(counts.spots) : null;
    if (key === 'times') return counts.sessions ? String(counts.sessions) : null;
    if (key === 'events') return counts.events ? String(counts.events) : null;
    if (key === 'plan') return counts.stops ? String(counts.stops) : null;
    return null;
  };

  return (
    <>
      <Pressable
        onPress={() => onOpenChange(true)}
        style={({ pressed }) => [
          styles.trigger,
          // Below the status bar, not under the clock.
          { top: insets.top + MENU_TOP },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.glyph}>☰</Text>
        <View style={styles.triggerText}>
          <Text style={styles.triggerTitle} numberOfLines={1}>
            {VENUE_VIEW[venue].label}
          </Text>
          <Text style={styles.triggerSub} numberOfLines={1}>
            {eventName ?? 'Default map'}
          </Text>
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => onOpenChange(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
          {/* Swallow presses inside the sheet so it does not dismiss itself. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.venueTitle}>{VENUE_VIEW[venue].label}</Text>
            <Text style={styles.venueSub}>
              {eventName ?? 'Default map — all your spots here'}
            </Text>

            {/*
              Why you are here, which is a different question from where.

              A camera position and a place to watch from are rarely the same
              place, so this changes what the map is *showing* rather than how
              it looks. It sits in the menu rather than on the map because it is
              set once for a weekend, not tapped between corners — and the map's
              corner already holds as many controls as it can.

              Each side carries its own count, so switching to an empty mode
              reads as a choice rather than a map that has broken.
            */}
            <View style={styles.modeRow}>
              {USE_OPTIONS.map((option) => {
                const on = option.value === spotUse;
                const count = useCounts[option.value];
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onSpotUseChange(option.value)}
                    style={({ pressed }) => [
                      styles.mode,
                      on && styles.modeOn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.modeLabel, on && styles.modeLabelOn]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.modeCount, on && styles.modeCountOn]}>
                      {count} spot{count === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView style={styles.items}>
              {ITEMS.map((item) => {
                const count = badge(item.key);
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => {
                      onNavigate(item.key);
                      onOpenChange(false);
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      pressed && styles.itemPressed,
                    ]}
                  >
                    <View style={styles.itemText}>
                      <Text style={styles.itemLabel}>{item.label}</Text>
                      <Text style={styles.itemHint}>{item.hint}</Text>
                    </View>
                    {count && <Text style={styles.count}>{count}</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Built per-render from the current theme rather than once at import — see
 * the `styles` call site above and theme.ts's `ThemeProvider` doc comment.
 */
function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    trigger: {
      position: 'absolute',
      left: space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      maxWidth: 260,
      paddingLeft: space.md,
      paddingRight: space.lg,
      // Gloves are the normal operating condition (§5.14).
      height: MENU_HEIGHT,
      borderRadius: radius.md,
      backgroundColor: 'rgba(11,13,16,0.92)',
      borderWidth: 1,
      borderColor: color.border,
    },
    pressed: { opacity: 0.7 },
    glyph: { color: color.text, fontSize: 18, fontWeight: weight.bold },
    triggerText: { flexShrink: 1 },
    triggerTitle: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    triggerSub: { color: color.accent, fontSize: type.label },

    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: color.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: space.md,
      maxHeight: '80%',
    },
    venueTitle: {
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
    },
    venueSub: { color: color.textMuted, fontSize: type.label, marginTop: 2 },

    modeRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    /**
     * Sized for §5.14 — a gloved thumb, in the rain, without looking carefully.
     * 56pt is the floor for a control that changes what the whole map means.
     */
    mode: {
      flex: 1,
      minHeight: 56,
      justifyContent: 'center',
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    modeOn: { borderColor: color.accent, backgroundColor: color.surface },
    modeLabel: { color: color.textMuted, fontSize: type.body, fontWeight: weight.bold },
    modeLabelOn: { color: color.text },
    modeCount: { color: color.textFaint, fontSize: 11, marginTop: 2 },
    modeCountOn: { color: color.accent },

    items: { marginTop: space.md },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 60,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      marginBottom: space.sm,
    },
    itemPressed: { backgroundColor: color.accent },
    itemText: { flex: 1 },
    itemLabel: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    itemHint: { color: color.textFaint, fontSize: type.label, marginTop: 1 },
    count: {
      color: color.accent,
      fontSize: type.body,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },
  });
}
