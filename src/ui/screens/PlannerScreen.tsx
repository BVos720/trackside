import { Text, TextInput } from '../Typography';
/**
 * The plan — an ordered route through spots, with times.
 *
 * This is the screen the whole event system exists for. It answers one
 * question, repeatedly, for a whole weekend: given that I want to be at
 * Brünnchen for the GT3 race at 14:00, when do I have to leave Adenauer Forst?
 *
 * ── Times are arrivals, departures are derived ─────────────────────────────
 * You set when you want to be *in position*. The walk is computed backwards
 * from it. This is the right way round because the arrival is the real
 * constraint — the cars come through when they come through — and a departure
 * time you typed yourself would just be a guess you would then have to redo
 * every time the route changed.
 *
 * ── Where the numbers come from, and how far to trust them ─────────────────
 * Walking times come from `core/logic/route.ts` over extracted paths, and
 * `core/logic/walk.ts` for the pace. Both are honest about being estimates:
 * legs with no path are charged double and flagged, and every duration is
 * rounded up and prefixed "about". Nothing here should ever read as a promise —
 * a locked gate or a marshal saying no is invisible to any of it.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Event, type PlanStop, eventDays } from '../../core/domain/event';
import type { SpotId } from '../../core/domain/ids';
import type { Spot } from '../../core/domain/spot';
import type { Route, WalkNetwork } from '../../core/logic/route';
import { routeBetween } from '../../core/logic/route';
import {
  formatClock,
  parseClock,
  walkEstimate,
  type WalkEstimate,
} from '../../core/logic/walk';
import { formatDateRange, fromIsoDate } from '../DateRangePicker';
import DaySelector from '../DaySelector';
import PageHeader from '../PageHeader';
import PanelEmptyState from '../PanelEmptyState';
import {
  HIT_SIZE,
  MENU_CLEARANCE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

/** A stop with everything the row needs already resolved. */
interface PlannedStop {
  readonly stop: PlanStop;
  readonly spot: Spot | null;
  readonly route: Route | null;
  readonly walk: WalkEstimate | null;
  /** Minutes since midnight, or null when the stop has no time set. */
  readonly departAt: number | null;
  /** True when the previous stop cannot be left in time to make this one. */
  readonly impossible: boolean;
}

function dayLabel(iso: string): string {
  const d = fromIsoDate(iso);
  if (!d) return iso;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${weekday} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function PlannerScreen({
  event,
  spots,
  network,
  barriers = [],
  onAddStop,
  onUpdateStop,
  onRemoveStop,
  onMoveStop,
  onNavigate,
  embedded = false,
  sessions = [],
}: {
  event: Event;
  /** Every spot at this circuit, for the picker. */
  spots: Spot[];
  network: WalkNetwork;
  /** Lines a walk may not cross — the racing surface. */
  barriers?: readonly (readonly (readonly [number, number])[])[];
  sessions?: readonly {
    id: string;
    title: string;
    day: string;
    start: string;
    end: string;
  }[];
  onAddStop: (spotId: SpotId, day: string | null) => void;
  onUpdateStop: (
    stopId: string,
    patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>,
  ) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, toIndex: number) => void;
  /** Open the navigator on a stop. */
  onNavigate: (stopId: string) => void;
  /** Rendered inside the event page rather than as its own screen. */
  embedded?: boolean;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const days = useMemo(() => eventDays(event), [event]);
  const [pickedDay, setDay] = useState<string | null>(null);
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : days[0] ?? null;
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const spotById = useMemo(() => {
    const m = new Map<string, Spot>();
    for (const s of spots) m.set(s.id, s);
    return m;
  }, [spots]);

  /** Stops on the selected day, in route order. */
  const stopsForDay = useMemo(
    () => event.stops.filter((s) => (days.length === 0 ? true : s.day === day)),
    [event.stops, day, days.length],
  );

  /**
   * Resolve routes and times for the day.
   *
   * Each stop's walk is measured from the *previous* stop, which is what makes
   * the list a route rather than a set of independent errands. The first stop
   * has no predecessor, so it has no walk — where you start the day from is not
   * something the app knows.
   */
  const planned: PlannedStop[] = useMemo(() => {
    const out: PlannedStop[] = [];

    stopsForDay.forEach((stop, i) => {
      const spot = spotById.get(stop.spotId) ?? null;
      const prev = i > 0 ? stopsForDay[i - 1] : undefined;
      const prevSpot = prev ? (spotById.get(prev.spotId) ?? null) : null;

      let route: Route | null = null;
      let walk: WalkEstimate | null = null;
      if (spot && prevSpot) {
        route = routeBetween(
          network,
          prevSpot.position,
          spot.position,
          barriers,
        );
        walk = walkEstimate({
          metres: route.metres,
          offNetworkMetres: route.offNetworkMetres,
        });
      }

      const arriveAt = stop.arriveAt ? parseClock(stop.arriveAt) : null;
      const departAt =
        arriveAt !== null && walk ? arriveAt - walk.minutes : null;

      // If you cannot leave the previous stop until after you were meant to be
      // there, the plan does not hold — say so rather than showing a departure
      // time that has already passed.
      const prevArrive = prev?.arriveAt ? parseClock(prev.arriveAt) : null;
      const impossible =
        departAt !== null && prevArrive !== null && departAt < prevArrive;

      out.push({ stop, spot, route, walk, departAt, impossible });
    });

    return out;
  }, [stopsForDay, spotById, network, barriers]);

  const unplanned = useMemo(
    () => spots.filter((s) => !event.stops.some((st) => st.spotId === s.id)),
    [spots, event.stops],
  );

  // A plain View when embedded: nesting one vertical ScrollView inside
  // another breaks scrolling on both.
  const Body = (embedded ? View : ScrollView) as typeof ScrollView;

  // Only the standalone page floats under the menu trigger; embedded, it is
  // already below the event page's own clearance.
  const insets = useSafeAreaInsets();

  return (
    <Body
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
      style={embedded ? styles.embedded : styles.root}
      contentContainerStyle={
        embedded
          ? undefined
          : [styles.content, { paddingTop: insets.top + MENU_CLEARANCE, paddingBottom: insets.bottom + space.xxl }]
      }
    >
      {!embedded && (
        <PageHeader eyebrow="Your day at the circuit" title={event.name} description={formatDateRange(event.startDate, event.endDate) || 'Build your route, one spot at a time.'} />
      )}

      {days.length > 1 && (
        <DaySelector dates={days} selectedDate={day} onSelect={setDay} label={dayLabel} />
      )}

      {days.length === 0 && (
        <Text style={styles.help}>
          No dates set on this event, so stops are not split by day. Add dates in
          Events to plan a multi-day weekend.
        </Text>
      )}

      {planned.length === 0 && (
        <PanelEmptyState eyebrow="Your route" title="Find your next vantage point" description="Add a spot and an arrival time. Walking estimates and leave-by times connect the stops in your day." />
      )}

      {planned.length > 0 && <View style={styles.planHeading}>
        <Text accessibilityRole="header" style={styles.planTitle}>Your route</Text>
        <Text style={styles.planCount}>{planned.length} {planned.length === 1 ? 'stop' : 'stops'}{day ? ` · ${dayLabel(day)}` : ''}</Text>
      </View>}

      {planned.map((p, i) => (
        <View key={p.stop.id} style={styles.stopBlock}>
          {/* The walk from the previous stop lives between the two rows,
              because it belongs to neither — it is the gap. */}
          {p.walk && (
            <View style={styles.legRow}>
              <View style={styles.legLine} />
              <View style={styles.legBody}>
                <Text style={styles.legText}>
                  about {p.walk.minutes} min · {Math.round(p.walk.metres)} m
                </Text>
                {p.route?.blocked && (
                  <Text style={styles.legBad}>
                    crosses the track — no mapped way round
                  </Text>
                )}
                {p.walk.mostlyOffNetwork && !p.route?.blocked && (
                  <Text style={styles.legWarn}>
                    mostly off-path — no route data for this stretch
                  </Text>
                )}
                {p.departAt !== null && (
                  <Text
                    style={[styles.legDepart, p.impossible && styles.legBad]}
                  >
                    {p.impossible
                      ? `does not fit — needs to leave ${formatClock(p.departAt)}`
                      : `leave by ${formatClock(p.departAt)}`}
                  </Text>
                )}
              </View>
            </View>
          )}

          <View style={[styles.row, p.impossible && styles.rowBad]}>
            <View style={styles.stopTop}>
              <View style={styles.index}>
                <Text style={styles.indexText}>{String(i + 1).padStart(2, '0')}</Text>
              </View>
              <View style={styles.timeBlock}>
                <Text style={styles.timeLabel}>{p.stop.arriveAt ? 'BE IN POSITION' : 'ARRIVAL'}</Text>
                <Text style={[styles.arrival, !p.stop.arriveAt && styles.arrivalUnset]}>{p.stop.arriveAt ?? 'Not set'}</Text>
              </View>
            </View>

            <Text accessibilityRole="header" style={styles.rowName}>{p.spot?.name ?? 'Deleted spot'}</Text>
            {p.stop.label && <Text style={styles.rowMeta}>{p.stop.label}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${editing === p.stop.id ? 'Done editing' : 'Edit'} ${p.spot?.name ?? 'deleted spot'}`}
              accessibilityState={{ expanded: editing === p.stop.id }}
              onPress={() =>
                setEditing(editing === p.stop.id ? null : p.stop.id)
              }
              style={({ pressed }) => [styles.editStop, pressed && styles.pressed]}
            >
              <Text style={styles.smallLabel}>
                {editing === p.stop.id ? 'Done' : 'Edit'}
              </Text>
            </Pressable>
          </View>

          {editing === p.stop.id && (
            <StopEditor
              stop={p.stop}
              index={i}
              count={planned.length}
              sessions={sessions}
              onUpdate={(patch) => onUpdateStop(p.stop.id, patch)}
              onRemove={() => {
                setEditing(null);
                onRemoveStop(p.stop.id);
              }}
              onMove={(to) => onMoveStop(p.stop.id, to)}
              onNavigate={() => onNavigate(p.stop.id)}
            />
          )}
        </View>
      ))}

      {!picking ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>+ Add a stop</Text>
        </Pressable>
      ) : (
        <View style={styles.picker}>
          <Text style={styles.label}>ADD A STOP</Text>
          {unplanned.length === 0 ? (
            <Text style={styles.help}>
              {spots.length === 0 ? 'Add a spot from the event map, then return here to plan your day.' : 'Every spot at this circuit is already in the plan.'}
            </Text>
          ) : (
            unplanned.map((s) => (
              <Pressable
                accessibilityRole="button"
                key={s.id}
                onPress={() => {
                  onAddStop(s.id, day);
                  setPicking(false);
                }}
                style={({ pressed }) => [
                  styles.pickRow,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.pickName}>
                  {s.name}
                </Text>
              </Pressable>
            ))
          )}
          <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={() => setPicking(false)}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </Body>
  );
}

/** Time, label and position controls for one stop. */
function StopEditor({
  stop,
  index,
  count,
  sessions,
  onUpdate,
  onRemove,
  onMove,
  onNavigate,
}: {
  stop: PlanStop;
  index: number;
  count: number;
  sessions: readonly { id: string; title: string; day: string; start: string; end: string }[];
  onUpdate: (patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onNavigate: () => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [time, setTime] = useState(stop.arriveAt ?? '');
  const [label, setLabel] = useState(stop.label ?? '');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Held locally and committed on blur: writing every keystroke would persist
  // "1", "14", "14:" as arrival times and recompute the whole route each time.
  const commitTime = () => {
    const trimmed = time.trim();
    if (trimmed === '') {
      onUpdate({ arriveAt: null });
      return;
    }
    const parsed = parseClock(trimmed);
    if (parsed === null) {
      // Reject rather than store nonsense — a stop timed at "25:00" would
      // silently drop out of every calculation.
      setTime(stop.arriveAt ?? '');
      return;
    }
    const normalised = formatClock(parsed);
    setTime(normalised);
    onUpdate({ arriveAt: normalised });
  };

  const commitLabel = (text: string, sessionId?: string, start?: string) => {
    const trimmed = text.trim();
    setLabel(trimmed);
    setShowSuggestions(false);
    
    let patch: Partial<Omit<PlanStop, 'id' | 'spotId'>> = {
      label: trimmed || null, 
      // Sessions here are persisted timetable rows, whose IDs are branded in storage.
      sessionId: (sessionId as PlanStop['sessionId'] | undefined) ?? stop.sessionId,
    };

    // Auto-fill time if the stop doesn't have one set yet
    if (start && !time) {
      const parsed = parseClock(start);
      if (parsed !== null) {
        const normalised = formatClock(parsed);
        setTime(normalised);
        patch = { ...patch, arriveAt: normalised };
      }
    }

    onUpdate(patch);
  };

  const activeDay = stop.day;
  const suggestions = useMemo(() => {
    if (!showSuggestions || !label.trim()) return [];
    const lower = label.toLowerCase();
    
    return [...sessions]
      // Only include sessions that match the text AND (if the stop has a day set) are on the same day
      .filter((s) => s.title.toLowerCase().includes(lower) && (!activeDay || s.day === activeDay))
      // Sort by start time chronologically
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 5); // Limit to 5 suggestions to avoid clutter
  }, [sessions, label, showSuggestions, activeDay]);

  return (
    <View style={styles.editor}>
      <Text style={styles.editorLabel}>BE IN POSITION AT</Text>
      <TextInput
        accessibilityLabel="Be in position at"
        value={time}
        onChangeText={setTime}
        onBlur={commitTime}
        onSubmitEditing={commitTime}
        placeholder="14:00"
        placeholderTextColor={color.textFaint}
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />

      <Text style={styles.editorLabel}>WHAT FOR</Text>
      <View>
        <TextInput
          accessibilityLabel="What this stop is for"
          value={label}
          onChangeText={(text) => {
            setLabel(text);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Keep inline suggestions mounted so a tap can complete after blur.
            // Saving immediately avoids a delayed draft overwriting that selection.
            onUpdate({ label: label.trim() || null });
          }}
          placeholder="Racing legends race 1"
          placeholderTextColor={color.textFaint}
          style={styles.input}
        />
        {suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <Text style={styles.suggestionsHeading}>MATCHING SESSIONS</Text>
            {suggestions.map((s) => (
              <Pressable
                accessibilityRole="button"
                key={s.id}
                onPress={() => commitLabel(s.title, s.id, s.start)}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.suggestionTitle}>
                  {s.title}
                </Text>
                <Text style={styles.suggestionMeta}>
                  {s.start}–{s.end} {s.day ? `· ${s.day}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.editorRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: index === 0 }}
          onPress={() => onMove(index - 1)}
          disabled={index === 0}
          style={({ pressed }) => [
            styles.small,
            index === 0 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.smallLabel}>↑ Earlier</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: index >= count - 1 }}
          onPress={() => onMove(index + 1)}
          disabled={index >= count - 1}
          style={({ pressed }) => [
            styles.small,
            index >= count - 1 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.smallLabel}>↓ Later</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onNavigate}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
        >
          <Text style={styles.navLabel}>Navigate</Text>
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" onPress={onRemove} style={styles.removeButton}>
        <Text style={styles.remove}>Remove from plan</Text>
      </Pressable>
      <Text style={styles.removeHint}>
        The spot stays on your map — only the scheduled stop goes.
      </Text>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    embedded: { paddingTop: space.sm },
    content: { padding: space.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.35 },

    planHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, marginTop: space.md },
    planTitle: { color: color.text, fontSize: 28, fontWeight: weight.bold },
    planCount: { color: color.textMuted, fontSize: type.label },
    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginBottom: space.xs,
    },
    help: {
      color: color.textMuted,
      fontSize: type.label,
      marginTop: space.sm,
      lineHeight: 17,
    },
    stopBlock: { marginTop: space.md },

    legRow: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 15 },
    legLine: {
      width: 2,
      backgroundColor: color.border,
      marginRight: space.md,
      marginVertical: 2,
    },
    legBody: { flex: 1, paddingVertical: space.sm },
    legText: { color: color.textMuted, fontSize: type.label },
    legWarn: { color: color.undocumented, fontSize: 11, marginTop: 1 },
    legDepart: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      marginTop: 1,
    },
    legBad: { color: color.danger },

    row: {
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    stopTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md, marginBottom: space.md },
    timeBlock: { flex: 1, alignItems: 'flex-end' },
    timeLabel: { color: color.textMuted, fontSize: 10, letterSpacing: 1.2, textAlign: 'right' },
    arrival: { color: color.accent, fontSize: 36, fontWeight: weight.bold, fontVariant: ['tabular-nums'], textAlign: 'right' },
    arrivalUnset: { color: color.textMuted, fontSize: 24 },
    editStop: { minHeight: HIT_SIZE, justifyContent: 'center', alignItems: 'center', padding: space.sm, backgroundColor: color.surfaceRaised, borderRadius: radius.sm, marginTop: space.md },
    rowBad: { borderColor: color.danger },
    index: {
      minWidth: 40,
      minHeight: 40,
      padding: space.sm,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.surfaceRaised,
    },
    indexText: {
      color: color.accent,
      fontSize: 16,
      fontWeight: weight.bold,
    },
    rowName: { color: color.text, fontSize: 24, fontWeight: weight.bold },
    rowMeta: { color: color.textMuted, fontSize: 14, lineHeight: 22, marginTop: space.xs },

    small: {
      minHeight: HIT_SIZE,
      paddingVertical: space.sm,
      flexGrow: 1,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    smallLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    navBtn: {
      flexGrow: 1,
      minWidth: 112,
      minHeight: HIT_SIZE,
      padding: space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    navLabel: {
      color: color.onAccent,
      fontSize: type.label,
      fontWeight: weight.bold,
    },

    editor: {
      padding: space.md,
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    editorLabel: {
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.sm,
    },
    editorRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.md,
      alignItems: 'center',
    },
    input: {
      marginTop: space.xs,
      backgroundColor: color.surface,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      color: color.text,
      fontSize: type.body,
      minHeight: HIT_SIZE,
    },
    remove: {
      color: color.danger,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    removeButton: { minHeight: HIT_SIZE, justifyContent: 'center', marginTop: space.sm },
    removeHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },
  
    suggestionsContainer: {
      marginTop: space.sm,
      backgroundColor: color.surface,
      borderRadius: radius.md,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: color.border,
    },
    suggestionsHeading: { color: color.textMuted, fontSize: 10, letterSpacing: 1, padding: space.md },
    suggestionRow: {
      padding: space.md,
      minHeight: HIT_SIZE,
      justifyContent: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.border,
    },
    suggestionTitle: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    suggestionMeta: {
      color: color.textMuted,
      fontSize: 11,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },

    picker: { marginTop: space.md },
    pickRow: {
      minHeight: HIT_SIZE,
      paddingVertical: space.sm,
      justifyContent: 'center',
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      marginBottom: space.sm,
    },
    pickName: { color: color.text, fontSize: type.body, fontWeight: weight.bold },

    primary: {
      marginTop: space.md,
      minHeight: HIT_SIZE,
      padding: space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    primaryLabel: {
      color: color.onAccent,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    cancel: {
      color: color.textMuted,
      fontSize: type.label,
      textAlign: 'center',
    },
    cancelButton: { minHeight: HIT_SIZE, justifyContent: 'center' },
  });
}
