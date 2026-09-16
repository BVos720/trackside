import { Text } from '../Typography';
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
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Event, type PlanStop, eventDays } from '../../core/domain/event';
import type { GearItem } from '../../core/domain/gear';
import type { SpotId, UserGearItemId } from '../../core/domain/ids';
import type { Spot } from '../../core/domain/spot';
import type { WalkNetwork } from '../../core/logic/route';
import { formatDateRange } from '../DateRangePicker';
import {
  MENU_CLEARANCE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';
import Collapsible from '../Collapsible';
import PageHeader from '../PageHeader';
import EntryListScreen, { type SavedEntryRow } from './EntryListScreen';
import GearScreen from './GearScreen';
import PlannerScreen from './PlannerScreen';
import TimetableScreen, { type PendingSession } from './TimetableScreen';
import WeatherScreen from './WeatherScreen';
import type { TextEntry } from '../../core/logic/entryList';
import type { ForecastDisplay } from '../../core/logic/forecast';

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
  onUpdateSession,
  entries,
  onCommitEntries,
  onTogglePhotographed,
  onRemoveEntry,
  gearItems,
  onToggleGear,
  weatherDisplay,
  onRefreshWeather,
  weatherRefreshing = false,
  weatherError = null,
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
  onUpdateSession: (
    id: string,
    patch: { title?: string; start?: string; end?: string },
  ) => void;
  entries: readonly SavedEntryRow[];
  onCommitEntries: (rows: TextEntry[]) => void;
  onTogglePhotographed: (id: string, photographed: boolean) => void;
  onRemoveEntry: (id: string) => void;
  /** The user's whole gear locker — not filtered to this event; see GearScreen. */
  gearItems: readonly GearItem[];
  onToggleGear: (id: UserGearItemId, included: boolean) => void;
  weatherDisplay: ForecastDisplay;
  onRefreshWeather: () => void;
  weatherRefreshing?: boolean;
  weatherError?: string | null;
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
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const insets = useSafeAreaInsets();
  const range = formatDateRange(event.startDate, event.endDate);
  const dayOptions = eventDays(event);
  const selectedGearIds = useMemo(
    () => new Set(event.gearItemIds),
    [event.gearItemIds],
  );

  return (
    <ScrollView
      /*
        The keyboard must not sit over the field being typed into.

        `automaticallyAdjustKeyboardInsets` is the iOS-native answer: the
        scroll view insets its own content by the keyboard height, so the
        focused field scrolls into view and everything below stays
        reachable. Better than a KeyboardAvoidingView around a ScrollView,
        which fights it for the same space and makes the layout jump.
        Ignored on Android, where `softwareKeyboardLayoutMode: resize` in
        app.json does the same at the window level.

        `keyboardShouldPersistTaps` is the other half. Without it the first
        tap after typing only dismisses the keyboard, so every button under
        a focused field quietly needs pressing twice.
      */
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      style={styles.root}
      // Clears the floating menu trigger. The back link is the first row, so
      // getting this wrong hides the way out behind the menu.
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.back}>‹ Events</Text>
      </Pressable>

      <PageHeader eyebrow="Weekend headquarters" title={event.name} description={`${circuitLabel}${range ? ` · ${range}` : ''}`} />
      <View style={styles.stats}>{[{ value: event.spotIds.length, label: 'SAVED SPOTS' }, { value: sessions.length, label: 'SESSIONS' }, { value: event.stops.length, label: 'PLAN STOPS' }].map(stat => <View key={stat.label} style={styles.stat}><Text style={styles.statValue}>{stat.value}</Text><Text style={styles.statLabel}>{stat.label}</Text></View>)}</View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Pressable
          onPress={onOpenMap}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed, { flex: 1, marginTop: 0 }]}
        >
          <Text style={styles.mapLabel}>Explore map ↗</Text>
          <Text style={styles.mapHint}>This event's waypoints</Text>
        </Pressable>

        <Pressable
          onPress={onStartEvent}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed, { flex: 1, marginTop: 0, backgroundColor: color.surfaceRaised }]}
        >
          <Text style={[styles.mapLabel, { color: color.text }]}>Start your day →</Text>
          <Text style={[styles.mapHint, { color: color.textMuted }]}>Navigate to next spot</Text>
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
          onUpdateSession={onUpdateSession}
          onCommit={onCommitSessions}
          onBack={onBack}
        />
      </Collapsible>

      <Collapsible
        title="Weather"
        hint={
          weatherDisplay.state === 'fresh' || weatherDisplay.state === 'stale'
            ? weatherDisplay.state === 'stale'
              ? 'Cached forecast — stale'
              : 'Cloud cover and rain for the weekend'
            : weatherDisplay.state === 'too-far-out'
              ? 'Not forecastable yet'
              : weatherDisplay.state === 'no-data-yet'
                ? 'Not fetched yet'
                : 'Set the event dates first'
        }
      >
        <WeatherScreen
          display={weatherDisplay}
          onRefresh={onRefreshWeather}
          refreshing={weatherRefreshing}
          error={weatherError}
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

{/*
        Gear appears only once there is some.

        An empty section that tells you to go somewhere else is a row of
        chrome on a screen that already has six, and it is on the page you
        look at during a race weekend rather than the one where gear is
        actually managed. The profile screen is where it is added; this is
        only where it is picked from.
      */}
      {gearItems.length > 0 && (
        <Collapsible
          title="Gear"
          badge={selectedGearIds.size || null}
          hint={
            selectedGearIds.size === 0
              ? 'Nothing attached — search and tap to add'
              : 'Bodies and lenses carried for this event'
          }
        >
          <GearScreen
            items={gearItems}
            selectedIds={selectedGearIds}
            onToggle={onToggleGear}
          />
        </Collapsible>
      )}

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

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.lg, paddingBottom: 64, width: '100%', maxWidth: 760, alignSelf: 'center' },
    stats: { flexDirection: 'row', borderWidth: 1, borderColor: color.border, borderRadius: 20, backgroundColor: color.surface, paddingVertical: 20 },
    stat: { flex: 1, alignItems: 'center', gap: 6 },
    statValue: { color: color.text, fontSize: 32, fontWeight: '700' },
    statLabel: { color: color.textMuted, fontSize: 9, letterSpacing: 1 },
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
      minHeight: 100,
      justifyContent: 'center',
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
    mapHint: { color: color.onAccent, fontSize: 11, lineHeight: 17, marginTop: 8 },

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
}
