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
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VENUE_VIEW, type VenueKey } from './map/style';
import { MENU_HEIGHT, MENU_TOP, color, radius, space, type, weight } from './theme';

export type Destination =
  | 'map'
  | 'list'
  | 'times'
  | 'light'
  | 'events'
  | 'event'
  | 'plan'
  | 'circuit';

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
 */
const ITEMS: { key: Destination; label: string; hint: string }[] = [
  { key: 'map', label: 'Map', hint: 'Waypoints and the circuit' },
  { key: 'events', label: 'Events', hint: 'Pick a weekend, or start clean' },
  { key: 'circuit', label: 'Circuit', hint: 'Switch venue' },
  { key: 'light', label: 'Light', hint: 'Sun, twilight and direction' },
];

export default function MainMenu({
  open,
  onOpenChange,
  venue,
  eventName,
  counts,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venue: VenueKey;
  /** Null means the default map — every spot at this circuit. */
  eventName: string | null;
  counts: { spots: number; sessions: number; events: number; stops: number };
  onNavigate: (to: Destination) => void;
}) {
  const insets = useSafeAreaInsets();

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

const styles = StyleSheet.create({
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
