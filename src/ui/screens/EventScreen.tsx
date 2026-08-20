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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Event, type PlanStop, eventDays } from '../../core/domain/event';
import type { SpotId } from '../../core/domain/ids';
import type { Spot } from '../../core/domain/spot';
import type { WalkNetwork } from '../../core/logic/route';
import { formatDateRange } from '../DateRangePicker';
import { MENU_CLEARANCE, color, radius, space, type, weight } from '../theme';
import Collapsible from '../Collapsible';
import EntryListScreen, { type SavedEntryRow } from './EntryListScreen';
import PlannerScreen from './PlannerScreen';
import TimetableScreen, { type PendingSession } from './TimetableScreen';
import type { TextEntry } from '../../core/logic/entryList';

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
  barriers,
  sessions,
  onCommitSessions,
  onRemoveSession,
  entries,
  onCommitEntries,
  onTogglePhotographed,
  onRemoveEntry,
  onAddStop,
  onUpdateStop,
  onRemoveStop,
  onMoveStop,
  onNavigate,
  onOpenMap,
  savedTo = null,
  filesFolder = null,
  onSaveNow,
  onStartEvent,
  onBack,
  onDelete,
}: {
  event: Event;
  circuitLabel: string;
  spots: Spot[];
  network: WalkNetwork;
  barriers?: readonly (readonly (readonly [number, number])[])[];
  sessions: SavedSessionRow[];
  onCommitSessions: (rows: PendingSession[]) => void;
  onRemoveSession: (id: string) => void;
  entries: readonly SavedEntryRow[];
  onCommitEntries: (rows: TextEntry[]) => void;
  onTogglePhotographed: (id: string, photographed: boolean) => void;
  onRemoveEntry: (id: string) => void;
  onAddStop: (spotId: SpotId, day: string | null) => void;
  onUpdateStop: (
    stopId: string,
    patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>,
  ) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, toIndex: number) => void;
  onNavigate: (stopId: string) => void;
  onOpenMap: () => void;
  /** Path of the last successful bundle write, or null. */
  savedTo?: string | null;
  /** Where bundles live, or null where the platform has no file storage. */
  filesFolder?: string | null;
  onSaveNow?: () => void;
  onStartEvent: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const range = formatDateRange(event.startDate, event.endDate);
  const dayOptions = eventDays(event);

  return (
    <ScrollView
      style={styles.root}
      // Clears the floating menu trigger. The back link is the first row, so
      // getting this wrong hides the way out behind the menu.
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
      keyboardShouldPersistTaps="handled"
    >
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

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Pressable
          onPress={onOpenMap}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed, { flex: 1, marginTop: 0 }]}
        >
          <Text style={styles.mapLabel}>Go to the map</Text>
          <Text style={styles.mapHint}>This event's waypoints</Text>
        </Pressable>

        <Pressable
          onPress={onStartEvent}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed, { flex: 1, marginTop: 0, backgroundColor: '#F2A03D' }]}
        >
          <Text style={styles.mapLabel}>Start Event</Text>
          <Text style={styles.mapHint}>Navigate to next spot</Text>
        </Pressable>
      </View>

      <Collapsible
        title="Timetable"
        badge={sessions.length || null}
        hint={
          sessions.length === 0
            ? 'Nothing yet — import or add sessions'
            : 'What is running, and when'
        }
      >
        <TimetableScreen
          embedded
          circuitLabel={circuitLabel}
          eventName={event.name}
          eventDates={range}
          eventDayOptions={dayOptions}
          savedCount={sessions.length}
          sessions={sessions}
          onRemoveSession={onRemoveSession}
          onCommit={onCommitSessions}
          onBack={onBack}
        />
      </Collapsible>

      <Collapsible
        title="Entry list"
        badge={entries.length > 0 ? `${entries.filter((e) => e.photographed).length}/${entries.length}` : null}
        hint={
          entries.length === 0
            ? 'Nothing yet — paste the entry list'
            : 'Which cars are running, and which you have shot'
        }
      >
        <EntryListScreen
          entries={entries}
          onCommit={onCommitEntries}
          onTogglePhotographed={onTogglePhotographed}
          onRemoveEntry={onRemoveEntry}
        />
      </Collapsible>

      <Collapsible
        title="Plan"
        badge={event.stops.length || null}
        hint={
          event.stops.length === 0
            ? 'No stops yet — where you will be, and when'
            : 'Route, times and when to leave'
        }
      >
        <PlannerScreen
          embedded
          event={event}
          spots={spots}
          network={network}
          barriers={barriers}
          sessions={sessions}
          onAddStop={onAddStop}
          onUpdateStop={onUpdateStop}
          onRemoveStop={onRemoveStop}
          onMoveStop={onMoveStop}
          onNavigate={onNavigate}
        />
      </Collapsible>

      {/*
        Where this event lives on disk.

        Shown rather than assumed: "saved" with no location is not a claim
        anyone can check, and being able to go and find the file is most of the
        reason bundles exist at all.
      */}
      <Collapsible
        title="Backup"
        hint={savedTo === null ? 'Not saved yet' : 'Saved to your files'}
      >
        <Text style={styles.fileHint}>
          {filesFolder === null
            ? 'This build has no app storage, so nothing is saved automatically. Download a copy to keep it.'
            : savedTo === null
              ? 'Saving a copy of this event — its spots, timetable and plan — to your files.'
              : 'Saved automatically. The file holds this event, its spots, its timetable and its plan.'}
        </Text>
        {savedTo !== null && (
          <Text style={styles.filePath} numberOfLines={2}>
            {savedTo.replace('file://', '')}
          </Text>
        )}
        {onSaveNow && (
          <Pressable
            onPress={onSaveNow}
            style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
          >
            <Text style={styles.saveLabel}>
              {filesFolder === null ? 'Download a copy' : 'Save now'}
            </Text>
          </Pressable>
        )}
      </Collapsible>

      {/*
        Delete is folded away too — it is the one action on this page you can
        reach by accident and cannot undo, so it should take a deliberate tap
        to even see.
      */}
      <Collapsible title="Danger zone" hint="Delete this event">
      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.delete}>Delete this event</Text>
      </Pressable>
      <Text style={styles.deleteHint}>
        Its own copies of the spots go with it. Your main map is untouched.
      </Text>
      </Collapsible>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingBottom: space.xxl },
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

  fileHint: {
    color: color.textMuted,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.xs,
  },
  filePath: {
    color: color.textFaint,
    fontSize: 10,
    marginTop: space.xs,
    fontVariant: ['tabular-nums'],
  },
  saveBtn: {
    marginTop: space.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    height: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.border,
  },
  saveLabel: {
    color: color.text,
    fontSize: type.label,
    fontWeight: weight.bold,
  },

  delete: {
    color: color.danger,
    fontSize: type.label,
    fontWeight: weight.bold,
    marginTop: space.xl,
  },
  deleteHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },
});
