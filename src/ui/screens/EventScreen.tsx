/**
 * One event, in one page.
 *
 * Everything a weekend consists of, in the order you deal with it: what is
 * running, where you will be for it, and the map you will be standing on.
 *
 * ── Why it is one page and not three ───────────────────────────────────────
 * The timetable and the plan are the same act split in two — you read "GT3
 * race 14:00" and immediately want to say "Brünnchen, be there 13:45". Putting
 * them behind separate navigation means holding a time in your head while you
 * go and find the other screen. They sit in one scroll so the answer is visible
 * while you enter it.
 */
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import type { Event, PlanStop } from '../../core/domain/event';
import type { SpotId } from '../../core/domain/ids';
import type { Spot } from '../../core/domain/spot';
import type { WalkNetwork } from '../../core/logic/route';
import { formatDateRange } from '../DateRangePicker';
import { color, radius, space, type, weight } from '../theme';
import PlannerScreen from './PlannerScreen';
import TimetableScreen, { type PendingSession } from './TimetableScreen';

export interface SavedSessionRow {
  id: string;
  title: string;
  day: string;
  start: string;
  end: string;
}

export default function EventScreen({
  event,
  circuitLabel,
  spots,
  network,
  sessions,
  onCommitSessions,
  onRemoveSession,
  onAddStop,
  onUpdateStop,
  onRemoveStop,
  onMoveStop,
  onNavigate,
  onOpenMap,
  onBack,
  onDelete,
}: {
  event: Event;
  circuitLabel: string;
  spots: Spot[];
  network: WalkNetwork;
  sessions: SavedSessionRow[];
  onCommitSessions: (rows: PendingSession[]) => void;
  onRemoveSession: (id: string) => void;
  onAddStop: (spotId: SpotId, day: string | null) => void;
  onUpdateStop: (
    stopId: string,
    patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>,
  ) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, toIndex: number) => void;
  onNavigate: (stopId: string) => void;
  onOpenMap: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const range = formatDateRange(event.startDate, event.endDate);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.back}>‹ Events</Text>
      </Pressable>

      <Text style={styles.kicker}>EVENT</Text>
      <Text style={styles.title}>{event.name}</Text>
      <Text style={styles.subtitle}>
        {circuitLabel}
        {range ? ` · ${range}` : ''}
      </Text>
      <Text style={styles.subtitle}>
        {event.spotIds.length} spot{event.spotIds.length === 1 ? '' : 's'} ·{' '}
        {sessions.length} session{sessions.length === 1 ? '' : 's'} ·{' '}
        {event.stops.length} planned
      </Text>

      <Pressable
        onPress={onOpenMap}
        style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
      >
        <Text style={styles.mapLabel}>Go to the map</Text>
        <Text style={styles.mapHint}>
          This event&apos;s waypoints, on the circuit
        </Text>
      </Pressable>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Timetable</Text>
        <TimetableScreen
          embedded
          circuitLabel={circuitLabel}
          eventName={event.name}
          eventDates={range}
          savedCount={sessions.length}
          sessions={sessions}
          onRemoveSession={onRemoveSession}
          onCommit={onCommitSessions}
          onBack={onBack}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plan</Text>
        <PlannerScreen
          embedded
          event={event}
          spots={spots}
          network={network}
          onAddStop={onAddStop}
          onUpdateStop={onUpdateStop}
          onRemoveStop={onRemoveStop}
          onMoveStop={onMoveStop}
          onNavigate={onNavigate}
        />
      </View>

      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.delete}>Delete this event</Text>
      </Pressable>
      <Text style={styles.deleteHint}>
        Its own copies of the spots go with it. Your main map is untouched.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingTop: 96, paddingBottom: space.xxl },
  pressed: { opacity: 0.7 },

  back: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
    marginBottom: space.sm,
  },
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
  subtitle: { color: color.textMuted, fontSize: type.label, marginTop: 2 },

  mapButton: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.accent,
  },
  mapLabel: {
    color: color.onAccent,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  mapHint: { color: color.onAccent, fontSize: type.label, opacity: 0.8 },

  section: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  sectionTitle: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    letterSpacing: 0.5,
  },

  delete: {
    color: color.danger,
    fontSize: type.label,
    fontWeight: weight.bold,
    marginTop: space.xl,
  },
  deleteHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },
});
