/**
 * Events — pick a planning context, or make one.
 *
 * "Default map" is the absence of an event: every spot you have at the circuit
 * you are looking at. An event narrows the map to a chosen set, so a race
 * weekend is not cluttered by every position you have ever marked.
 *
 * ── "Start from my spots" makes copies ─────────────────────────────────────
 * The event gets its own duplicates, not references to your collection. This
 * reverses what §4.2 implies, for reasons argued in core/logic/cloneSpots.ts:
 * with references, tidying a race-weekend map deleted spots permanently from
 * the map they had been gathered on over years.
 *
 * ── "Import an event" is a different thing entirely ────────────────────────
 * That reads a saved bundle file back in — a whole event with its spots,
 * timetable and plan. It offers restore and copy as separate choices and shows
 * what each would do, because the two are not interchangeable and the wrong one
 * is only noticed later. The rules live in core/logic/importBundle.ts.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Event } from '../../core/domain/event';
import type { CircuitId, EventId } from '../../core/domain/ids';
import type { ImportConflict, ImportMode } from '../../core/logic/importBundle';
import { partitionEventsByFinished } from '../../core/logic/eventLifecycle';
import Collapsible from '../Collapsible';
import DateRangePicker, { formatDateRange } from '../DateRangePicker';
import { MENU_CLEARANCE, color, radius, space, type, weight } from '../theme';

export interface CircuitChoice {
  readonly id: CircuitId;
  readonly label: string;
}

/** A bundle sitting in the app's own folder, offered without a file picker. */
export interface StoredBundleOption {
  readonly uri: string;
  readonly title: string;
  readonly subtitle: string;
}

/** What one mode would do, worked out before the user commits to it. */
export interface ImportOutcome {
  readonly summary: string;
  readonly warnings: readonly string[];
}

/**
 * A file that has been read and understood, waiting on a decision.
 *
 * Both outcomes are computed up front so each button can show its own
 * consequences. Choosing between "restore" and "import a copy" with nothing to
 * go on but the words is how someone overwrites a weekend they meant to keep.
 */
export interface PendingImport {
  readonly fileName: string;
  readonly eventName: string;
  readonly circuitLabel: string;
  readonly conflict: ImportConflict;
  readonly restore: ImportOutcome;
  readonly copy: ImportOutcome;
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
  storedBundles = [],
  pendingImport = null,
  importError = null,
  onChooseImportFile,
  onOpenStoredBundle,
  onConfirmImport,
  onCancelImport,
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

  // ── import ────────────────────────────────────────────────────────────────
  /** Bundles found in the app's own folder. Empty where there is no folder. */
  storedBundles?: readonly StoredBundleOption[];
  /** A file that has been read and is waiting on restore-or-copy. */
  pendingImport?: PendingImport | null;
  /** Why the last attempt failed, in words the user can act on. */
  importError?: string | null;
  onChooseImportFile?: () => void;
  onOpenStoredBundle?: (uri: string) => void;
  onConfirmImport?: (mode: ImportMode) => void;
  onCancelImport?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [forCircuit, setForCircuit] = useState<CircuitId>(circuitId);
  /**
   * Finished events start hidden — a weekend that is over is clutter on the
   * list you actually use to plan the next one. Derived rather than filtered
   * server-side (see core/logic/eventLifecycle.ts), so flipping this never
   * touches a row.
   */
  const [showFinished, setShowFinished] = useState(false);

  const { active: activeEvents, finished: finishedEvents } = useMemo(
    () => partitionEventsByFinished(events),
    [events],
  );
  const visibleEventList = showFinished ? events : activeEvents;

  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of circuits) m.set(c.id, c.label);
    return (id: CircuitId) => m.get(id) ?? 'Unknown circuit';
  }, [circuits]);

  /** Events grouped by circuit, the circuit on screen first. */
  const grouped = useMemo(() => {
    const byCircuit = new Map<string, Event[]>();
    for (const e of visibleEventList) {
      const bucket = byCircuit.get(e.circuitId);
      if (bucket) bucket.push(e);
      else byCircuit.set(e.circuitId, [e]);
    }
    return [...byCircuit.entries()].sort(([a], [b]) => {
      if (a === circuitId) return -1;
      if (b === circuitId) return 1;
      return labelFor(a as CircuitId).localeCompare(labelFor(b as CircuitId));
    });
  }, [visibleEventList, circuitId, labelFor]);

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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
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

      {finishedEvents.length > 0 && (
        <Pressable
          onPress={() => setShowFinished((v) => !v)}
          style={({ pressed }) => [styles.finishedToggle, pressed && styles.pressed]}
        >
          <Text style={styles.finishedToggleLabel}>
            {showFinished
              ? 'Hide finished'
              : `Show finished (${finishedEvents.length})`}
          </Text>
        </Pressable>
      )}

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

      {onChooseImportFile && (
        <Collapsible
          title="Import an event"
          hint={
            pendingImport
              ? `${pendingImport.eventName} — waiting`
              : storedBundles.length > 0
                ? `${storedBundles.length} saved file${storedBundles.length === 1 ? '' : 's'}`
                : 'From a file'
          }
        >
          {pendingImport === null ? (
            <>
              {storedBundles.map((b) => (
                <Pressable
                  key={b.uri}
                  onPress={() => onOpenStoredBundle?.(b.uri)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{b.title}</Text>
                    <Text style={styles.rowSub}>{b.subtitle}</Text>
                  </View>
                </Pressable>
              ))}

              <Pressable
                onPress={onChooseImportFile}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryLabel}>Choose a file…</Text>
              </Pressable>

              {importError !== null && (
                <Text style={styles.importError}>{importError}</Text>
              )}

              <Text style={styles.help}>
                {storedBundles.length > 0
                  ? 'Files above are the backups this app wrote. Choosing a file also reads one from anywhere else on the device.'
                  : 'An event file holds the event, its spots, its timetable and its plan.'}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.importName}>{pendingImport.eventName}</Text>
              <Text style={styles.rowSub}>
                {pendingImport.circuitLabel} · {pendingImport.fileName}
              </Text>

              {/*
                What is already here under this event's id, said plainly.

                A restore is destructive when something live is in the way, and
                it is a resurrection when a tombstone is. Neither should be
                discovered afterwards.
              */}
              <Text
                style={[
                  styles.importConflict,
                  pendingImport.conflict.kind === 'live' && styles.importDanger,
                ]}
              >
                {pendingImport.conflict.kind === 'live'
                  ? `“${pendingImport.conflict.localName}” is already in the app under this file’s id. Restoring replaces it.`
                  : pendingImport.conflict.kind === 'deleted'
                    ? `You deleted “${pendingImport.conflict.localName}”. Restoring brings it back.`
                    : 'This event is not in the app. Restoring brings it back as it was.'}
              </Text>

              <View style={styles.choices}>
                <Pressable
                  onPress={() => onConfirmImport?.('restore')}
                  style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
                >
                  <Text style={styles.choiceLabel}>
                    {pendingImport.conflict.kind === 'live' ? 'Replace' : 'Restore'}
                  </Text>
                  <Text style={styles.choiceHint}>
                    {pendingImport.restore.summary}
                  </Text>
                  {pendingImport.restore.warnings.map((w) => (
                    <Text key={w} style={styles.importWarning}>
                      {w}
                    </Text>
                  ))}
                </Pressable>

                <Pressable
                  onPress={() => onConfirmImport?.('copy')}
                  style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
                >
                  <Text style={styles.choiceLabel}>Import a copy</Text>
                  <Text style={styles.choiceHint}>{pendingImport.copy.summary}</Text>
                  {pendingImport.copy.warnings.map((w) => (
                    <Text key={w} style={styles.importWarning}>
                      {w}
                    </Text>
                  ))}
                </Pressable>
              </View>

              <Pressable onPress={onCancelImport}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </Collapsible>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingBottom: space.xxl },
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
  finishedToggle: {
    alignSelf: 'flex-start',
    height: 36,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    marginBottom: space.sm,
  },
  finishedToggleLabel: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
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

  importName: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    marginTop: space.sm,
  },
  importConflict: {
    color: color.textMuted,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.sm,
  },
  /** Reserved for the case where a restore would overwrite something live. */
  importDanger: { color: color.danger },
  importWarning: {
    color: color.danger,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  importError: {
    color: color.danger,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.sm,
  },
});
