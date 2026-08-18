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
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
import { color, radius, space, type, weight } from '../theme';

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
  onAddStop,
  onUpdateStop,
  onRemoveStop,
  onMoveStop,
  onNavigate,
  embedded = false,
}: {
  event: Event;
  /** Every spot at this circuit, for the picker. */
  spots: Spot[];
  network: WalkNetwork;
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
  const days = useMemo(() => eventDays(event), [event]);
  const [day, setDay] = useState<string | null>(days[0] ?? null);
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
        route = routeBetween(network, prevSpot.position, spot.position);
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
  }, [stopsForDay, spotById, network]);

  const unplanned = useMemo(
    () => spots.filter((s) => !event.stops.some((st) => st.spotId === s.id)),
    [spots, event.stops],
  );

  // A plain View when embedded: nesting one vertical ScrollView inside
  // another breaks scrolling on both.
  const Body = (embedded ? View : ScrollView) as typeof ScrollView;

  return (
    <Body
      style={embedded ? styles.embedded : styles.root}
      contentContainerStyle={embedded ? undefined : styles.content}
    >
      {!embedded && (
        <>
          <Text style={styles.kicker}>PLAN</Text>
          <Text style={styles.title}>{event.name}</Text>
          {formatDateRange(event.startDate, event.endDate) && (
            <Text style={styles.subtitle}>
              {formatDateRange(event.startDate, event.endDate)}
            </Text>
          )}
        </>
      )}

      {days.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dayStrip}
          contentContainerStyle={styles.dayStripContent}
        >
          {days.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDay(d)}
              style={({ pressed }) => [
                styles.dayChip,
                d === day && styles.dayChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.dayChipLabel,
                  d === day && styles.dayChipLabelActive,
                ]}
              >
                {dayLabel(d)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {days.length === 0 && (
        <Text style={styles.help}>
          No dates set on this event, so stops are not split by day. Add dates in
          Events to plan a multi-day weekend.
        </Text>
      )}

      {planned.length === 0 && (
        <Text style={styles.empty}>
          Nothing planned yet. Add a stop, give it a time and what it is for —
          the walk between stops is worked out from there.
        </Text>
      )}

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
                {p.walk.mostlyOffNetwork && (
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
            <View style={styles.index}>
              <Text style={styles.indexText}>{i + 1}</Text>
            </View>

            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>
                {p.spot?.name ?? 'Deleted spot'}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {p.stop.arriveAt ? `be there ${p.stop.arriveAt}` : 'no time set'}
                {p.stop.label ? ` · ${p.stop.label}` : ''}
              </Text>
            </View>

            <Pressable
              onPress={() =>
                setEditing(editing === p.stop.id ? null : p.stop.id)
              }
              hitSlop={8}
              style={({ pressed }) => [styles.small, pressed && styles.pressed]}
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
              Every spot at this circuit is already in the plan.
            </Text>
          ) : (
            unplanned.map((s) => (
              <Pressable
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
                <Text style={styles.pickName} numberOfLines={1}>
                  {s.name}
                </Text>
              </Pressable>
            ))
          )}
          <Pressable onPress={() => setPicking(false)}>
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
  onUpdate,
  onRemove,
  onMove,
  onNavigate,
}: {
  stop: PlanStop;
  index: number;
  count: number;
  onUpdate: (patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onNavigate: () => void;
}) {
  const [time, setTime] = useState(stop.arriveAt ?? '');
  const [label, setLabel] = useState(stop.label ?? '');

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

  return (
    <View style={styles.editor}>
      <Text style={styles.editorLabel}>BE IN POSITION AT</Text>
      <TextInput
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
      <TextInput
        value={label}
        onChangeText={setLabel}
        onBlur={() => onUpdate({ label: label.trim() || null })}
        placeholder="Racing legends race 1"
        placeholderTextColor={color.textFaint}
        style={styles.input}
      />

      <View style={styles.editorRow}>
        <Pressable
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
          onPress={onNavigate}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
        >
          <Text style={styles.navLabel}>Navigate</Text>
        </Pressable>
      </View>

      <Pressable onPress={onRemove} hitSlop={8}>
        <Text style={styles.remove}>Remove from plan</Text>
      </Pressable>
      <Text style={styles.removeHint}>
        The spot stays on your map — only the scheduled stop goes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  embedded: { paddingTop: space.sm },
  content: { padding: space.md, paddingTop: 96, paddingBottom: space.xxl },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },

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
  empty: {
    color: color.textFaint,
    fontSize: type.body,
    lineHeight: 21,
    paddingVertical: space.lg,
  },

  dayStrip: { marginTop: space.md, marginBottom: space.xs },
  dayStripContent: { gap: space.sm },
  dayChip: {
    paddingHorizontal: space.md,
    height: 40,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  dayChipActive: { backgroundColor: color.accent },
  dayChipLabel: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  dayChipLabelActive: { color: color.onAccent },

  stopBlock: { marginTop: space.sm },

  legRow: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 15 },
  legLine: {
    width: 2,
    backgroundColor: color.border,
    marginRight: space.md,
    marginVertical: 2,
  },
  legBody: { flex: 1, paddingVertical: space.xs },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 60,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowBad: { borderColor: color.danger },
  index: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceRaised,
  },
  indexText: {
    color: color.textMuted,
    fontSize: 11,
    fontWeight: weight.bold,
  },
  rowBody: { flex: 1 },
  rowName: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
  rowMeta: { color: color.textMuted, fontSize: type.label, marginTop: 2 },

  small: {
    height: 40,
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
    flex: 1,
    height: 40,
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
    padding: space.sm,
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
    minHeight: 44,
  },
  remove: {
    color: color.danger,
    fontSize: type.label,
    fontWeight: weight.bold,
    marginTop: space.md,
  },
  removeHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },

  picker: { marginTop: space.md },
  pickRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    marginBottom: space.sm,
  },
  pickName: { color: color.text, fontSize: type.body, fontWeight: weight.bold },

  primary: {
    marginTop: space.md,
    height: 52,
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
    marginTop: space.sm,
  },
});
