/**
 * Events — pick a planning context, or make one.
 *
 * "Default map" is the absence of an event: every spot you have at the circuit
 * you are looking at. An event narrows the map to a chosen set, so a race
 * weekend is not cluttered by every position you have ever marked.
 *
 * ── Import copies references, not spots ────────────────────────────────────
 * "Start from my spots" seeds the event with the *ids* of your existing spots.
 * Duplicating the spots themselves would recreate the failure spec §4.2 exists
 * to prevent — four events meaning four Brünnchen pins, and a coordinate fix
 * needing four edits.
 *
 * ── The list spans circuits; an event does not ─────────────────────────────
 * You plan a season, so every event is listed here whichever venue is on
 * screen, grouped by circuit. Activating one switches the map to its circuit,
 * because an event's spots only exist there. That is also why a new event picks
 * its circuit up front rather than silently inheriting whatever you were last
 * looking at — creating "Spa Six Hours" while the Nürburgring is open should
 * not quietly make it a Nürburgring event.
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

import type { Event } from '../../core/domain/event';
import type { CircuitId, EventId } from '../../core/domain/ids';
import DateRangePicker, { formatDateRange } from '../DateRangePicker';
import { color, radius, space, type, weight } from '../theme';

export interface CircuitChoice {
  readonly id: CircuitId;
  readonly label: string;
}

export default function EventsScreen({
  circuitLabel,
  circuitId,
  circuits,
  events,
  activeId,
  spotCount,
  spotCountFor,
  onActivate,
  onCreate,
  onDelete,
  onOpen,
}: {
  circuitLabel: string;
  /** The circuit on screen — the default for a new event. */
  circuitId: CircuitId;
  circuits: readonly CircuitChoice[];
  /** Every event, across circuits. */
  events: Event[];
  activeId: EventId | null;
  /** Spots at the circuit on screen, for the count shown on "Default map". */
  spotCount: number;
  /** How many permanent spots each circuit has, for the seed hint. */
  spotCountFor: (circuit: CircuitId) => number;
  onActivate: (id: EventId | null) => void;
  onCreate: (
    name: string,
    startDate: string | null,
    endDate: string | null,
    /** Copy the chosen circuit's spots into the new event. */
    seedFromSpots: boolean,
    forCircuit: CircuitId,
  ) => void;
  /**
   * Open one event's own page — timetable, plan and its map, together.
   *
   * The list is for choosing; everything you do *to* an event happens there.
   */
  onOpen: (id: EventId) => void;
  onDelete: (id: EventId) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [forCircuit, setForCircuit] = useState<CircuitId>(circuitId);

  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of circuits) m.set(c.id, c.label);
    return (id: CircuitId) => m.get(id) ?? 'Unknown circuit';
  }, [circuits]);

  /** Events grouped by circuit, the circuit on screen first. */
  const grouped = useMemo(() => {
    const byCircuit = new Map<string, Event[]>();
    for (const e of events) {
      const bucket = byCircuit.get(e.circuitId);
      if (bucket) bucket.push(e);
      else byCircuit.set(e.circuitId, [e]);
    }
    return [...byCircuit.entries()].sort(([a], [b]) => {
      if (a === circuitId) return -1;
      if (b === circuitId) return 1;
      return labelFor(a as CircuitId).localeCompare(labelFor(b as CircuitId));
    });
  }, [events, circuitId, labelFor]);

  const seedCount = spotCountFor(forCircuit);

  const create = (seedFromSpots: boolean) => {
    if (name.trim() === '') return;
    onCreate(name, startDate, endDate, seedFromSpots, forCircuit);
    setName('');
    setStartDate(null);
    setEndDate(null);
    setAdding(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>EVENTS</Text>
      <Text style={styles.venue}>{circuitLabel}</Text>

      <Pressable
        onPress={() => onActivate(null)}
        style={({ pressed }) => [
          styles.row,
          activeId === null && styles.rowActive,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Default map</Text>
          <Text style={styles.rowSub}>
            {spotCount} spot{spotCount === 1 ? '' : 's'} — everything here
          </Text>
        </View>
        {activeId === null && <Text style={styles.tick}>✓</Text>}
      </Pressable>

      {grouped.map(([cid, list]) => (
        <View key={cid}>
          <Text style={styles.groupHeading}>
            {labelFor(cid as CircuitId).toUpperCase()}
            {cid !== circuitId ? ' · switches circuit' : ''}
          </Text>
          {list.map((e) => {
            const on = e.id === activeId;
            const range = formatDateRange(e.startDate, e.endDate);
            return (
              <Pressable
                key={e.id}
                onPress={() => {
                  onActivate(e.id);
                  onOpen(e.id);
                }}
                onLongPress={() => onDelete(e.id)}
                style={({ pressed }) => [
                  styles.row,
                  on && styles.rowActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{e.name}</Text>
                  <Text style={styles.rowSub}>
                    {e.spotIds.length} spot{e.spotIds.length === 1 ? '' : 's'}
                    {e.stops.length > 0 ? ` · ${e.stops.length} planned` : ''}
                    {range ? ` · ${range}` : ''}
                  </Text>
                </View>
                {on && <Text style={styles.tick}>✓</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}

      {events.length > 0 && (
        <Text style={styles.help}>
          Open an event for its timetable, plan and map.
        </Text>
      )}

      {!adding ? (
        <Pressable
          onPress={() => {
            setForCircuit(circuitId);
            setAdding(true);
          }}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>+ Add event</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.label}>NEW EVENT</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name — e.g. NLS10"
            placeholderTextColor={color.textFaint}
            style={styles.input}
          />

          <Text style={styles.label}>CIRCUIT</Text>
          <View style={styles.circuitChoices}>
            {circuits.map((c) => {
              const on = c.id === forCircuit;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setForCircuit(c.id)}
                  style={({ pressed }) => [
                    styles.circuitChip,
                    on && styles.circuitChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.circuitChipLabel,
                      on && styles.circuitChipLabelActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>DATES</Text>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(from, to) => {
              setStartDate(from);
              setEndDate(to);
            }}
          />

          <Text style={styles.help}>
            Starting from your spots makes the event its own copy of them.
            Anything you move, rename or delete here stays here — your main map
            is never touched.
          </Text>

          <View style={styles.choices}>
            <Pressable
              onPress={() => create(true)}
              disabled={seedCount === 0}
              style={({ pressed }) => [
                styles.choice,
                seedCount === 0 && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.choiceLabel}>Start from my spots</Text>
              <Text style={styles.choiceHint}>
                {seedCount === 0
                  ? 'No spots there yet'
                  : `Copies all ${seedCount}`}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => create(false)}
              style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
            >
              <Text style={styles.choiceLabel}>Start clean</Text>
              <Text style={styles.choiceHint}>Empty map, add as you go</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => setAdding(false)}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingTop: 96, paddingBottom: space.xxl },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },

  kicker: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
  },
  venue: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
    marginTop: space.xs,
    marginBottom: space.md,
  },
  label: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
    marginTop: space.lg,
  },
  groupHeading: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  help: {
    color: color.textMuted,
    fontSize: type.label,
    marginTop: space.sm,
    lineHeight: 17,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: { borderColor: color.accent },
  rowText: { flex: 1 },
  rowTitle: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  rowSub: { color: color.textMuted, fontSize: type.label, marginTop: 1 },
  tick: { color: color.accent, fontSize: 18, fontWeight: weight.bold },

  input: {
    marginTop: space.sm,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: color.text,
    fontSize: type.body,
    minHeight: 44,
  },

  circuitChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
  },
  circuitChip: {
    paddingHorizontal: space.md,
    height: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  circuitChipActive: { backgroundColor: color.accent },
  circuitChipLabel: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  circuitChipLabelActive: { color: color.onAccent },

  choices: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  choice: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  choiceLabel: {
    color: color.text,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  choiceHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },

  planButton: {
    marginTop: space.md,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.accent,
  },
  planLabel: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
  planHint: { color: color.textMuted, fontSize: type.label, marginTop: 2 },

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
    marginTop: space.md,
  },
});
