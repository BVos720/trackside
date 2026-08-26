/**
 * The entry list — which cars are running, and which you have already shot.
 *
 * Two halves, like the timetable: the field itself, ticked off as you go
 * round the paddock; and underneath it, how the field got there. Pasted text
 * only for now — PDF extraction is not wired up on device yet (see
 * TASKS-pdf-mapping.md).
 *
 * ── The review is editable, and that is the point ─────────────────────────
 * Same rule as TimetableScreen, spec §5.3: nothing is written until Add is
 * pressed. But a checkbox is only half a confirmation step — it lets you
 * reject a wrong row, not correct one, so a car with the right number and a
 * mangled team is a choice between keeping something wrong and losing it
 * entirely.
 *
 * Every field here is editable, and rows can be added and deleted. That
 * changes what the parser is for: it no longer has to be *right*, only close,
 * because the last word belongs to the person holding the phone. The two
 * documents it still reads wrong — HTC2's row index, and the Spa Six Hours
 * cars whose number sits alone on a line — become a few seconds of typing
 * instead of a defect (see TASKS-pdf-mapping.md, section R).
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseEntryList, describeEntryParse, type TextEntry } from '../../core/logic/entryList';
import {
  blankRow,
  readyRows,
  rowFromEntry,
  rowsFromParse,
  toEntry,
  type ReviewRow,
} from '../../core/logic/entryReview';
import { gridOf } from '../../core/logic/columnMapping';
import { findColumns } from '../../core/logic/pdfColumns';
import { pickPdf } from '../../storage-local/pickPdf';
import { PdfBridge, PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import Collapsible from '../Collapsible';
import ColumnMapper from './ColumnMapper';
import { useMappingTemplates } from '../state/useMappingTemplates';
import {
  HIT_SIZE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

export interface SavedEntryRow {
  readonly id: string;
  readonly number: string;
  readonly className: string | null;
  readonly team: string | null;
  readonly drivers: readonly string[];
  readonly photographed: boolean;
}

/**
 * Keys for the review rows.
 *
 * Minted here rather than in `core/`: a key is a rendering concern — React
 * needs one stable per row across edits and deletions — and `entryReview`
 * stays pure by taking them rather than generating them.
 */
let keySeed = 0;
const nextKey = () => `r${keySeed++}`;

export default function EntryListScreen({
  entries,
  onTogglePhotographed,
  onRemoveEntry,
  onCommit,
}: {
  entries: readonly SavedEntryRow[];
  onTogglePhotographed: (id: string, photographed: boolean) => void;
  onRemoveEntry?: (id: string) => void;
  onCommit: (rows: TextEntry[]) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** The grid being mapped by hand, or null when the parser's reading is in use. */
  const [mapping, setMapping] = useState<string[][] | null>(null);
  /**
   * Saved layouts, loaded whether or not the mapper is open.
   *
   * Not scoped to the event: a layout is a fact about a series, which is the
   * whole reason saving one is worth anything.
   */
  const layouts = useMappingTemplates();
  /** Bytes waiting to be read by the bridge, or null when nothing is loading. */
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);

  const progress = useMemo(
    () => ({
      photographed: entries.filter((e) => e.photographed).length,
      total: entries.length,
    }),
    [entries],
  );

  /** Rows that would actually be written: included, and carrying a number. */
  const ready = useMemo(() => readyRows(rows), [rows]);

  const onRead = () => {
    if (raw.trim() === '') {
      setStatus('Nothing to read — paste an entry list first.');
      return;
    }
    const r = parseEntryList(raw);
    setRows(rowsFromParse(r, nextKey));
    setEditing(null);
    setStatus(describeEntryParse(r));
  };

  /**
   * Hand the pasted text to the mapper instead of the parser.
   *
   * Pasted text carries no positions, so every line becomes one cell and the
   * useful control is "how many rows make one car" — which is what reads the
   * documents the parser loses cars from. A PDF picked on web would come in
   * through `extractPdfRows` with real columns; the screen is the same either
   * way, which is why it takes a grid rather than a file.
   */
  const onMap = () => {
    if (raw.trim() === '') {
      setStatus('Nothing to map — paste an entry list first.');
      return;
    }
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
    setMapping(gridOf(lines.map((text) => ({ tokens: [{ x: 0, width: 0, text }] })), []));
    setStatus(null);
  };

  /**
   * Open a PDF and go straight to the mapper.
   *
   * Deliberately not through the parser first. A PDF still has its column
   * positions, and those are the thing the parser has to throw away — sending
   * it down the string path would discard the one advantage the file has over
   * a paste, and then ask the user to correct the result.
   */
  const onPickPdf = () => {
    void (async () => {
      const picked = await pickPdf();
      if (!picked) return; // Backed out of the picker.
      setStatus(`Reading ${picked.name}…`);
      setPdfBytes(picked.bytes);
    })();
  };

  const patch = (key: string, change: Partial<ReviewRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const toggle = (key: string) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, include: !r.include } : r)),
    );

  const remove = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setEditing((e) => (e === key ? null : e));
  };

  const addBlank = () => {
    const row = blankRow(nextKey());
    setRows((rs) => [...rs, row]);
    // Straight into the editor: an empty row you then have to find and tap is
    // two steps for something that only exists to be typed into.
    setEditing(row.key);
  };

  const commit = () => {
    if (ready.length === 0) {
      setStatus('Nothing to add — tick at least one row with a number.');
      return;
    }
    onCommit(ready.map(toEntry));
    const n = ready.length;
    setRows([]);
    setEditing(null);
    setRaw('');
    setStatus(`Added ${n} entr${n === 1 ? 'y' : 'ies'}.`);
  };

  return (
    <View>
      {entries.length > 0 && (
        <>
          <View style={styles.progressRow}>
            <Text style={styles.label}>FIELD</Text>
            <Text style={styles.progressCount}>
              {progress.photographed} / {progress.total} shot
            </Text>
          </View>
          {entries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => onTogglePhotographed(e.id, !e.photographed)}
              style={({ pressed }) => [
                styles.row,
                e.photographed && styles.rowOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.tick, e.photographed && styles.tickOn]}>
                {e.photographed ? '✓' : '○'}
              </Text>
              <Text style={styles.number}>{e.number}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {e.team ?? (e.drivers.length > 0 ? e.drivers.join(' / ') : '—')}
                </Text>
                {(e.className || (e.team && e.drivers.length > 0)) && (
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[e.className, e.team && e.drivers.length > 0 ? e.drivers.join(' / ') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
              </View>
              {onRemoveEntry && (
                <Pressable
                  onPress={() => onRemoveEntry(e.id)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              )}
            </Pressable>
          ))}
        </>
      )}
      {entries.length === 0 && (
        <Text style={styles.help}>
          No field yet. Paste the entry list below to get one.
        </Text>
      )}

      <Collapsible title="Import" hint="Paste the entry list">
        <TextInput
          value={raw}
          onChangeText={setRaw}
          placeholder={'Paste the entry list here…\n7 Toyota Gazoo Racing Hypercar Conway/Kobayashi/Lopez'}
          placeholderTextColor={color.textFaint}
          multiline
          style={styles.paste}
        />
        <Pressable
          onPress={onRead}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        >
          <Text style={styles.btnLabel}>Read pasted text</Text>
        </Pressable>

        {pdfBytes && (
          <PdfBridge
            bytes={pdfBytes}
            onRows={(rows) => {
              setPdfBytes(null);
              // Columns first: a PDF is the one input that still has them, and
              // gridOf falls back to whole lines when a document has none.
              setMapping(gridOf(rows, findColumns(rows)));
              setStatus(null);
            }}
            onError={(message) => {
              setPdfBytes(null);
              setStatus(message);
            }}
          />
        )}

        {mapping === null && (
          <>
            <Pressable
              onPress={PDF_BRIDGE_SUPPORTED ? onPickPdf : undefined}
              disabled={!PDF_BRIDGE_SUPPORTED}
              style={({ pressed }) => [
                styles.btn,
                !PDF_BRIDGE_SUPPORTED && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.btnLabel}>Open a PDF</Text>
            </Pressable>
            {/*
              Shown disabled rather than hidden. A button that vanishes leaves
              no way to tell "this app cannot do that" from "I cannot find it",
              and this one is only missing because the binary predates the
              WebView it needs.
            */}
            {!PDF_BRIDGE_SUPPORTED && (
              <Text style={styles.help}>
                Reading PDFs needs a newer build of the app. Paste the text
                below for now — it reaches the same place.
              </Text>
            )}
          </>
        )}

        {mapping === null && (
          <Pressable
            onPress={onMap}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <Text style={styles.btnLabel}>Say what each part is instead</Text>
          </Pressable>
        )}

        {status && <Text style={styles.status}>{status}</Text>}

        {mapping !== null && (
          <ColumnMapper
            grid={mapping}
            templates={layouts.templates}
            onSaveTemplate={(name, m) => void layouts.save(name, mapping, m)}
            onTemplateUsed={(id) => void layouts.touch(id)}
            onCancel={() => setMapping(null)}
            onUse={(mapped) => {
              // Straight into the same editable review the parser feeds, so
              // there is one place where entries are checked and corrected.
              setRows(mapped.map((e) => rowFromEntry(e, nextKey())));
              setMapping(null);
              setEditing(null);
              setStatus(
                `Mapped ${mapped.length} car${mapped.length === 1 ? '' : 's'}. Check them below.`,
              );
            }}
          />
        )}

        {/*
          Somewhere to start when there is no document at all.

          ── The gap this closes ────────────────────────────────────────────
          Everything on this screen assumed a list already existed: paste one,
          or import a PDF, then correct what came out. `addBlank` was wired,
          but only inside the review section below — which does not render
          until `rows.length > 0`. So building a list by hand required first
          obtaining a list, which is the one case where you have not got one.

          ── Why it deserves a first-class entry point ──────────────────────
          Plenty of what this app is for has no PDF behind it. A club meeting,
          a trackday, a test session, a support race whose organiser publishes
          nothing — and the twenty minutes before a session, when a list exists
          somewhere but not in a form worth fighting. In those cases typing six
          cars is not a fallback, it is the fastest route, and it should not be
          reached by pretending to paste something first.

          The rows it creates are the same `ReviewRow`s the parser and the
          column mapper produce, so everything downstream — editing, ticking,
          `toEntry`, the commit — is the code that already exists. This is an
          entry point, not a second implementation.
        */}
        {rows.length === 0 && mapping === null && (
          <>
            <Text style={styles.label}>OR BUILD ONE BY HAND</Text>
            <Text style={styles.help}>
              No entry list to paste? Add cars one at a time. A number is all a
              row needs — class, team and drivers can follow when you know them.
            </Text>
            <Pressable
              onPress={addBlank}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryLabel}>+ Add a car</Text>
            </Pressable>
          </>
        )}

        {rows.length > 0 && mapping === null && (
          <>
            <Text style={styles.label}>REVIEW</Text>
            <Text style={styles.help}>
              Nothing is saved until you press Add. Tap a row to correct it,
              untick anything that is not a car, and add one the list missed.
            </Text>

            {rows.map((r) => {
              const open = editing === r.key;
              const unread = r.number.trim() === '';
              return (
                <View
                  key={r.key}
                  style={[
                    styles.reviewRow,
                    r.include && !unread && styles.reviewRowOn,
                    unread && styles.reviewRowUnread,
                  ]}
                >
                  <View style={styles.reviewHead}>
                    <Pressable
                      onPress={() => toggle(r.key)}
                      hitSlop={10}
                      style={({ pressed }) => [styles.tickTap, pressed && styles.pressed]}
                    >
                      <Text style={[styles.tick, r.include && styles.tickOn]}>
                        {r.include ? '✓' : '○'}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setEditing(open ? null : r.key)}
                      style={({ pressed }) => [styles.reviewBody, pressed && styles.pressed]}
                    >
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {r.number.trim() === '' ? 'No number' : r.number}
                        {r.team.trim() !== '' ? `  ${r.team}` : ''}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[r.className, r.drivers].filter((s) => s.trim() !== '').join(' · ') ||
                          'Tap to fill in'}
                      </Text>
                    </Pressable>

                    <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
                  </View>

                  {/*
                    The source line, always shown rather than only as a
                    fallback. When a field looks wrong it is the only way to
                    tell a mis-parse from a typo in the document itself.
                  */}
                  {r.source !== '' && (
                    <Text style={styles.source} numberOfLines={open ? 3 : 1}>
                      {r.source}
                    </Text>
                  )}

                  {open && (
                    <View style={styles.editor}>
                      <Field
                        label="Number"
                        value={r.number}
                        onChange={(v) => patch(r.key, { number: v })}
                        placeholder="7"
                      />
                      <Field
                        label="Class"
                        value={r.className}
                        onChange={(v) => patch(r.key, { className: v })}
                        placeholder="Hypercar"
                      />
                      <Field
                        label="Team"
                        value={r.team}
                        onChange={(v) => patch(r.key, { team: v })}
                        placeholder="Toyota Gazoo Racing"
                      />
                      <Field
                        label="Drivers"
                        value={r.drivers}
                        onChange={(v) => patch(r.key, { drivers: v })}
                        placeholder="Conway / Kobayashi / Lopez"
                      />
                      <View style={styles.editorActions}>
                        <Pressable
                          onPress={() => remove(r.key)}
                          style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
                        >
                          <Text style={styles.dangerLabel}>Delete row</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setEditing(null)}
                          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
                        >
                          <Text style={styles.btnLabel}>Done</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            <Pressable
              onPress={addBlank}
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            >
              <Text style={styles.btnLabel}>+ Add a car the list missed</Text>
            </Pressable>

            <Pressable
              onPress={commit}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>
                Add {ready.length} entr{ready.length === 1 ? 'y' : 'ies'}
              </Text>
            </Pressable>
          </>
        )}
      </Collapsible>
    </View>
  );
}

/** One labelled text input in the row editor. */
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        style={styles.input}
        autoCapitalize="words"
        autoCorrect={false}
      />
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },

    progressRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    progressCount: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },

    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.lg,
    },
    help: {
      color: color.textMuted,
      fontSize: type.label,
      marginTop: space.xs,
      lineHeight: 17,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: 48,
      paddingHorizontal: space.sm,
      marginTop: space.xs,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    rowOn: { borderColor: color.accent },
    number: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      width: 36,
    },
    rowBody: { flex: 1 },
    rowTitle: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    rowMeta: { color: color.textMuted, fontSize: 11, marginTop: 2 },
    remove: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },

    tick: { color: color.textFaint, fontSize: 16, width: 18 },
    tickOn: { color: color.accent, fontWeight: weight.bold },
    // Gloves (§5.14): the glyph is small, the target it sits in is not.
    tickTap: {
      minWidth: 32,
      minHeight: HIT_SIZE - 16,
      alignItems: 'center',
      justifyContent: 'center',
    },

    paste: {
      marginTop: space.sm,
      minHeight: 96,
      textAlignVertical: 'top',
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      color: color.text,
      fontSize: type.body,
    },
    btn: {
      marginTop: space.sm,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    btnLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },

    status: {
      color: color.text,
      fontSize: type.label,
      marginTop: space.sm,
      backgroundColor: color.surface,
      borderRadius: radius.sm,
      padding: space.sm,
    },

    reviewRow: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    reviewRowOn: { borderColor: color.accent },
    // A row with no number cannot be added yet, and says so without shouting.
    reviewRowUnread: { borderColor: color.undocumented, borderStyle: 'dashed' },
    reviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    reviewBody: { flex: 1, minHeight: HIT_SIZE - 20, justifyContent: 'center' },
    chevron: { color: color.textFaint, fontSize: 14, width: 14, textAlign: 'center' },

    source: {
      color: color.textFaint,
      fontSize: 11,
      marginTop: space.xs,
      fontStyle: 'italic',
    },

    editor: {
      marginTop: space.sm,
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: color.border,
      gap: space.xs,
    },
    field: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    fieldLabel: {
      color: color.textFaint,
      fontSize: 11,
      fontWeight: weight.bold,
      width: 56,
    },
    input: {
      flex: 1,
      minHeight: 44,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      color: color.text,
      fontSize: type.label,
    },
    editorActions: {
      flexDirection: 'row',
      gap: space.sm,
      marginTop: space.xs,
    },
    danger: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    dangerLabel: { color: color.danger, fontSize: type.label, fontWeight: weight.bold },
    done: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },

    primary: {
      marginTop: space.md,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    primaryLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },

    /* Outlined, not filled: this is an alternative to importing, not the
       screen's main action. Add, at the bottom, is what commits. */
    secondary: {
      marginTop: space.sm,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.accent,
    },
    secondaryLabel: { color: color.accent, fontSize: type.body, fontWeight: weight.bold },
  });
}
