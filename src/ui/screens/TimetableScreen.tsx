/**
 * Timetable import and manual entry — spec §5.3.
 *
 * Two ways in: import a document, or type a session yourself. Both land in the
 * same confirmation list, and nothing is written until you press Add.
 *
 * ── The confirmation step is the point ─────────────────────────────────────
 * §5.3: "Always present parsed output for user confirmation before committing.
 * Never trust the extraction silently." That applies to the deterministic
 * parser just as much as to a model — it is more predictable, not more correct.
 *
 * ── Machine first, person last ────────────────────────────────────────────
 * Reading a timetable is a hybrid, the same one the entry list uses
 * (TASKS-pdf-mapping.md):
 *
 *   1. The parser tries first. It reads all three real Spa documents, so for
 *      most weekends this is the whole job.
 *   2. When it recognises nothing, the column mapper opens on the same
 *      document, already filled in by `mappingGuess.ts` — start, end and name
 *      columns proposed, one tap to correct any of them. It can also be
 *      opened by hand when the parser read something but read it wrong.
 *   3. Whichever read it, the result is an editable review: every field
 *      correctable, rows deletable, a session the document missed addable,
 *      and the lines nobody could read shown as rows to fill in.
 *
 * The algorithm does the part that is the same everywhere; the person does
 * the part only they can see, and has the last word on all of it.
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

import { gridOf } from '../../core/logic/columnMapping';
import { findColumns } from '../../core/logic/pdfColumns';
import { parseTimetableLines } from '../../core/logic/timetableText';
import {
  blankSessionRow,
  describeSessionReview,
  readySessionRows,
  sessionProblem,
  sessionRowsFrom,
  toReadySession,
  type SessionRow,
} from '../../core/logic/timetableReview';
import { rowText } from '../../storage-local/pdfText';
import { PdfBridge, PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import { pickPdf } from '../../storage-local/pickPdf';
import Collapsible from '../Collapsible';
import ColumnMapper from './ColumnMapper';
import { TIMETABLE_SPEC } from './mapperSpecs';
import {
  HIT_SIZE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

export interface PendingSession {
  readonly key: string;
  readonly day: string | null;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly kind: string;
  readonly onTrack: boolean;
}

/**
 * Keys for review rows — a rendering concern, so minted here and handed to
 * `timetableReview`, which stays pure by taking them.
 */
let keySeed = 0;
const nextKey = () => `s${keySeed++}`;

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "Saturday 22 August 2026" — parsed as local midnight, never via UTC. */
function writtenDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function TimetableScreen({
  circuitLabel,
  eventName,
  eventDates,
  eventDayOptions = [],
  savedCount,
  onCommit,
  onBack,
  embedded = false,
  sessions = [],
  onRemoveSession,
  onUpdateSession,
}: {
  circuitLabel: string;
  /**
   * The event this timetable belongs to.
   *
   * A timetable is *this weekend's* running order, not a property of the
   * circuit, so the screen names the event it is filling in. Null means no
   * event is active, in which case there is nothing for these sessions to be
   * scheduled against.
   */
  eventName: string | null;
  eventDates: string | null;
  /**
   * The event's own days, ISO `YYYY-MM-DD`.
   *
   * A session belongs to *this* weekend, so the day is chosen from the event's
   * dates rather than typed or picked from an open calendar — which is how you
   * end up with a session on a day the event does not run.
   */
  eventDayOptions?: readonly string[];
  savedCount: number;
  onCommit: (rows: PendingSession[]) => void;
  onBack: () => void;
  /**
   * Rendered inside the event page rather than as its own screen.
   *
   * Drops the header and the outer scroll view: nesting one vertical
   * ScrollView inside another breaks scrolling on both.
   */
  embedded?: boolean;
  /** Saved sessions, newest import last, for the list. */
  sessions?: readonly {
    id: string;
    title: string;
    day: string;
    start: string;
    end: string;
  }[];
  onRemoveSession?: (id: string) => void;
  /**
   * Correct a saved session in place.
   *
   * A parsed timetable is a reading of somebody's PDF, and both can be wrong.
   * Without this the only repair is Remove and retype, which for one wrong
   * character means losing the row.
   */
  onUpdateSession?: (
    id: string,
    patch: { title?: string; start?: string; end?: string },
  ) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [raw, setRaw] = useState('');
  /** The review: what was read, as editable rows. */
  const [rows, setRows] = useState<SessionRow[]>([]);
  /** The review row open for editing, as its key. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Bytes waiting on the bridge, and the filename to report them under. */
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  /**
   * The last document read, as a grid with its columns intact.
   *
   * Kept after the parser has had its turn, so "say what each column is"
   * can reopen the same document without reading the PDF a second time.
   */
  const [lastGrid, setLastGrid] = useState<string[][] | null>(null);
  /** The grid open in the column mapper, or null while the review shows. */
  const [mapping, setMapping] = useState<string[][] | null>(null);
  /** The saved session open for editing, as its id. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', start: '', end: '' });
  const [showAll, setShowAll] = useState(false);
  /**
   * Which day sections are open.
   *
   * A weekend is forty-odd sessions and you only ever care about one day at a
   * time — the flat list meant scrolling past Friday to find Sunday's race. The
   * first day opens by default so the screen is never a wall of closed rows.
   */
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  // Manual entry
  const [mTitle, setMTitle] = useState('');
  const [mDay, setMDay] = useState('');
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd] = useState('');

  const visible = useMemo(
    () => (showAll ? rows : rows.filter((r) => r.onTrack)),
    [rows, showAll],
  );
  const paperwork = rows.length - rows.filter((r) => r.onTrack).length;
  const ready = useMemo(() => readySessionRows(rows), [rows]);
  const blocked = rows.filter((r) => r.include && sessionProblem(r) !== null).length;

  /**
   * One document, read the hybrid way.
   *
   * The parser first, on lines. If it recognises nothing, the mapper opens on
   * the grid instead — pre-filled, so "nothing recognised" is a screen with a
   * proposed reading on it rather than a shrug and an empty list.
   */
  const read = (lines: string[], grid: string[][], label: string) => {
    const r = parseTimetableLines(lines);
    setLastGrid(grid);
    setOpenKey(null);

    if (r.sessions.length === 0) {
      setRows([]);
      setMapping(grid);
      setStatus(
        `${label}: the automatic reader does not know this layout. ` +
          'Say what each column is below — it has filled in what it could tell.',
      );
      return;
    }

    setRows(sessionRowsFrom(r.sessions, r.skipped, nextKey));
    setMapping(null);
    const onTrack = r.sessions.filter((s) => s.onTrack).length;
    setStatus(
      `${label}: ${r.sessions.length} session${r.sessions.length === 1 ? '' : 's'} read, ` +
        `${onTrack} on track` +
        (r.skipped.length > 0
          ? `, ${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} to check`
          : '') +
        '.',
    );
  };

  const onPaste = () => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (lines.length === 0) {
      setStatus('Nothing to read — paste a timetable first.');
      return;
    }
    // Pasted text has no positions, so each line is one cell.
    read(lines, lines.map((l) => [l]), 'Pasted text');
  };

  /**
   * Open the system file picker.
   *
   * Both platforms go through `pickPdf`, which returns bytes — the screen used
   * to build an `<input type="file">` directly, which meant the button did
   * nothing at all on a phone because there is no DOM to build it in.
   */
  const onPickPdf = () => {
    void (async () => {
      const picked = await pickPdf();
      // Null is a cancelled dialog, which is not worth a status message.
      if (!picked) return;
      setStatus(`Reading ${picked.name}…`);
      setPdfName(picked.name);
      setPdfBytes(picked.bytes);
    })();
  };

  const patch = (key: string, change: Partial<SessionRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const toggle = (key: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, include: !r.include } : r)));

  const remove = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setOpenKey((k) => (k === key ? null : k));
  };

  const addBlank = () => {
    // Under the day of the last row: a missed session is usually missed
    // from the day you were just looking at.
    const row = blankSessionRow(nextKey(), rows[rows.length - 1]?.day ?? '');
    setRows((rs) => [...rs, row]);
    // Straight into the editor — an empty row you then have to find and tap
    // is two steps for something that only exists to be typed into.
    setOpenKey(row.key);
  };

  const commit = () => {
    if (ready.length === 0) {
      setStatus('Nothing to add — tick at least one session with a start time and a name.');
      return;
    }
    onCommit(ready.map((r) => ({ key: r.key, ...toReadySession(r) })));
    const n = ready.length;
    setRows([]);
    setOpenKey(null);
    setLastGrid(null);
    setRaw('');
    setStatus(`Added ${n} session${n === 1 ? '' : 's'}.`);
  };

  const addManual = () => {
    const t = /^(\d{1,2}):(\d{2})$/;
    if (!t.test(mStart.trim()) || !t.test(mEnd.trim())) {
      setStatus('Start and end must be HH:MM.');
      return;
    }
    if (mTitle.trim() === '') {
      setStatus('Give the session a name.');
      return;
    }
    onCommit([
      {
        key: `manual-${Date.now()}`,
        day: mDay.trim() === '' ? null : mDay.trim(),
        title: mTitle.trim(),
        start: mStart.trim().padStart(5, '0'),
        end: mEnd.trim().padStart(5, '0'),
        kind: 'other',
        onTrack: true,
      },
    ]);
    setMTitle('');
    setMStart('');
    setMEnd('');
    setStatus('Session added.');
  };

  // A plain View when embedded: nesting one vertical ScrollView inside
  // another breaks scrolling on both.
  const Body = (embedded ? View : ScrollView) as typeof ScrollView;

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
      contentContainerStyle={embedded ? undefined : styles.content}
    >
      {!embedded && (
        <>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.back}>‹ Events</Text>
          </Pressable>

          <Text style={styles.kicker}>TIMETABLE</Text>
          <Text style={styles.venue}>{eventName ?? circuitLabel}</Text>
        </>
      )}
      {!embedded && (
        <Text style={styles.help}>
          {eventName ? `${circuitLabel}` : 'No event active'}
          {eventDates ? ` · ${eventDates}` : ''}
          {savedCount > 0 ? ` · ${savedCount} saved` : ''}
        </Text>
      )}

      {/*
        The timetable itself, above the import controls. This is what you came
        to look at; the importer is how you filled it in.
      */}
      {sessions.length > 0 && (
        <>
          <Text style={styles.label}>RUNNING ORDER</Text>
          {(() => {
            /*
             * Grouped in the order the sessions arrived, not sorted.
             *
             * A published timetable's own order is information: it runs Friday
             * to Sunday because that is the weekend. Re-sorting by a parsed
             * date would reorder days whose headings never resolved to one.
             */
            type Row = (typeof sessions)[number];
            const byDay = new Map<string, Row[]>();
            for (const row of sessions) {
              const key = row.day === '' ? 'Unscheduled' : row.day;
              const list = byDay.get(key);
              if (list) list.push(row);
              else byDay.set(key, [row]);
            }

            return [...byDay.entries()].map(([day, dayRows], index) => {
              // Nothing collapsed yet means the first day is the open one.
              const open =
                collapsedDays.size === 0
                  ? index === 0
                  : !collapsedDays.has(day);

              return (
                <View key={day}>
                  <Pressable
                    onPress={() =>
                      setCollapsedDays((prev) => {
                        const next = new Set(prev);
                        // First touch: everything except the first day was
                        // already closed, so seed that before toggling.
                        if (next.size === 0) {
                          [...byDay.keys()].forEach((k, i) => {
                            if (i !== 0) next.add(k);
                          });
                        }
                        if (next.has(day)) next.delete(day);
                        else next.add(day);
                        return next;
                      })
                    }
                    style={({ pressed }) => [
                      styles.dayHeader,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.dayChevron}>{open ? '▾' : '▸'}</Text>
                    <Text style={styles.dayTitle} numberOfLines={1}>
                      {day}
                    </Text>
                    <Text style={styles.dayCount}>{dayRows.length}</Text>
                  </Pressable>

                  {open &&
                    dayRows.map((row) => {
                      const editing = editingId === row.id;
                      return (
                        <View key={row.id}>
                          <View style={styles.savedRow}>
                            <Pressable
                              onPress={() => {
                                if (!onUpdateSession) return;
                                if (editing) {
                                  setEditingId(null);
                                  return;
                                }
                                // Seeded from what is on screen, so opening the
                                // editor never looks like it cleared the row.
                                setDraft({
                                  title: row.title,
                                  start: row.start,
                                  end: row.end,
                                });
                                setEditingId(row.id);
                              }}
                              style={({ pressed }) => [
                                styles.savedTap,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.savedTime}>
                                {row.start}–{row.end}
                              </Text>
                              <View style={styles.savedBody}>
                                <Text style={styles.savedTitle} numberOfLines={1}>
                                  {row.title}
                                </Text>
                              </View>
                            </Pressable>
                            {onRemoveSession && (
                              <Pressable
                                onPress={() => onRemoveSession(row.id)}
                                hitSlop={8}
                                style={({ pressed }) => pressed && styles.pressed}
                              >
                                <Text style={styles.savedRemove}>Remove</Text>
                              </Pressable>
                            )}
                          </View>

                          {editing && onUpdateSession && (
                            <View style={styles.editor}>
                              <View style={styles.editorTimes}>
                                <TextInput
                                  value={draft.start}
                                  onChangeText={(v) =>
                                    setDraft((d) => ({ ...d, start: v }))
                                  }
                                  placeholder="09:00"
                                  placeholderTextColor={color.textFaint}
                                  style={styles.timeInput}
                                  keyboardType="numbers-and-punctuation"
                                />
                                <Text style={styles.editorDash}>–</Text>
                                <TextInput
                                  value={draft.end}
                                  onChangeText={(v) =>
                                    setDraft((d) => ({ ...d, end: v }))
                                  }
                                  placeholder="09:30"
                                  placeholderTextColor={color.textFaint}
                                  style={styles.timeInput}
                                  keyboardType="numbers-and-punctuation"
                                />
                              </View>
                              <TextInput
                                value={draft.title}
                                onChangeText={(v) =>
                                  setDraft((d) => ({ ...d, title: v }))
                                }
                                placeholder="Session name"
                                placeholderTextColor={color.textFaint}
                                style={styles.titleInput}
                              />
                              <Pressable
                                onPress={() => {
                                  onUpdateSession(row.id, draft);
                                  setEditingId(null);
                                }}
                                style={({ pressed }) => [
                                  styles.saveBtn,
                                  pressed && styles.pressed,
                                ]}
                              >
                                <Text style={styles.btnLabel}>Save</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      );
                    })}
                </View>
              );
            });
          })()}
        </>
      )}
      {sessions.length === 0 && (
        <Text style={styles.help}>
          No sessions yet. Upload the programme, paste it, or add them by hand.
        </Text>
      )}

      <Collapsible title="Import" hint="From a PDF, or pasted text">
      {pdfBytes && (
        <PdfBridge
          bytes={pdfBytes}
          onRows={(pdfRows) => {
            setPdfBytes(null);
            // Lines for the parser, which stays the first thing tried; the
            // grid, columns intact, for the mapper if the parser cannot cope.
            read(
              pdfRows.map(rowText).filter((l) => l !== ''),
              gridOf(pdfRows, findColumns(pdfRows)),
              pdfName ?? 'the PDF',
            );
          }}
          onError={(message) => {
            setPdfBytes(null);
            setStatus(message);
          }}
        />
      )}
      {mapping === null && (
        <View style={styles.row}>
          <Pressable
            onPress={PDF_BRIDGE_SUPPORTED ? onPickPdf : undefined}
            disabled={!PDF_BRIDGE_SUPPORTED}
            style={({ pressed }) => [
              styles.btn,
              !PDF_BRIDGE_SUPPORTED && styles.btnDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnLabel}>Upload PDF</Text>
          </Pressable>
          <Pressable
            onPress={onPaste}
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          >
            <Text style={styles.btnLabel}>Read pasted text</Text>
          </Pressable>
        </View>
      )}
      {!PDF_BRIDGE_SUPPORTED && (
        <Text style={styles.help}>
          Reading PDFs needs a newer build of the app. Paste the text for now —
          it goes through the same parser.
        </Text>
      )}

      {mapping === null && (
        <TextInput
          value={raw}
          onChangeText={setRaw}
          placeholder={'Or paste the timetable here…\n11:00 12:30 FIA WEC FREE PRACTICE 1 Track'}
          placeholderTextColor={color.textFaint}
          multiline
          style={[styles.input, styles.paste]}
        />
      )}

      {status && <Text style={styles.status}>{status}</Text>}

      {/*
        The way into the mapper once the parser has had its turn.

        Offered whenever there is a document to map, not only when the parser
        failed: "read 40 sessions" and "read them right" are different claims,
        and a timetable whose names came out in the wrong order is the case
        the parser cannot know it has.
      */}
      {lastGrid !== null && mapping === null && (
        <Pressable
          onPress={() => setMapping(lastGrid)}
          style={({ pressed }) => [styles.wideBtn, pressed && styles.pressed]}
        >
          <Text style={styles.btnLabel}>
            {rows.length > 0 ? 'Not right? Say what each column is' : 'Say what each column is'}
          </Text>
        </Pressable>
      )}

      {mapping !== null && (
        <ColumnMapper
          grid={mapping}
          spec={TIMETABLE_SPEC}
          onCancel={() => setMapping(null)}
          onUse={(mapped) => {
            // Into the same editable review the parser feeds, so there is one
            // place where sessions are checked and corrected.
            setRows(sessionRowsFrom(mapped, [], nextKey));
            setMapping(null);
            setOpenKey(null);
            setStatus(
              `Read ${mapped.length} session${mapped.length === 1 ? '' : 's'} from the columns you chose. Check them below.`,
            );
          }}
        />
      )}

      {rows.length > 0 && mapping === null && (
        <>
          <View style={styles.reviewHead}>
            <Text style={styles.label}>REVIEW</Text>
            {paperwork > 0 && (
              <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={8}>
                <Text style={styles.link}>
                  {showAll ? 'Track only' : `Show all ${rows.length}`}
                </Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.help}>
            Nothing is saved until you press Add. Tap a session to correct it;
            paperwork is left unticked
            {paperwork > 0 && !showAll ? ` and ${paperwork} of it is hidden` : ''}.
          </Text>

          {visible.map((r) => {
            const open = openKey === r.key;
            const problem = sessionProblem(r);
            const times =
              (r.start.trim() || '--:--') + (r.end.trim() !== '' ? `–${r.end.trim()}` : '');
            return (
              <View
                key={r.key}
                style={[
                  styles.session,
                  r.include && problem === null && styles.sessionOn,
                  r.include && problem !== null && styles.sessionBlocked,
                ]}
              >
                <View style={styles.sessionHead}>
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
                    onPress={() => setOpenKey(open ? null : r.key)}
                    style={({ pressed }) => [styles.sessionBody, pressed && styles.pressed]}
                  >
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {r.title.trim() === '' ? 'No name yet' : r.title}
                    </Text>
                    <Text style={styles.sessionMeta} numberOfLines={1}>
                      {times}
                      {r.day !== '' ? ` · ${r.day}` : ''}
                    </Text>
                  </Pressable>
                  <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
                </View>

                {/*
                  The line it came from, always. When a field looks wrong it
                  is the only way to tell a misreading from a typo in the
                  document itself.
                */}
                {r.source !== '' && (
                  <Text style={styles.source} numberOfLines={open ? 3 : 1}>
                    {r.source}
                  </Text>
                )}

                {open && (
                  <View style={styles.rowEditor}>
                    <View style={styles.editorTimes}>
                      <TextInput
                        value={r.start}
                        onChangeText={(v) => patch(r.key, { start: v })}
                        placeholder="Start 09:00"
                        placeholderTextColor={color.textFaint}
                        style={styles.timeInput}
                        keyboardType="numbers-and-punctuation"
                        autoCorrect={false}
                      />
                      <Text style={styles.editorDash}>–</Text>
                      <TextInput
                        value={r.end}
                        onChangeText={(v) => patch(r.key, { end: v })}
                        placeholder="End (optional)"
                        placeholderTextColor={color.textFaint}
                        style={styles.timeInput}
                        keyboardType="numbers-and-punctuation"
                        autoCorrect={false}
                      />
                    </View>
                    <TextInput
                      value={r.title}
                      onChangeText={(v) => patch(r.key, { title: v })}
                      placeholder="Session name"
                      placeholderTextColor={color.textFaint}
                      style={styles.titleInput}
                      autoCorrect={false}
                    />

                    {/*
                      The day, from the event's own dates when it has them.
                      A heading read from the document ("WEDNESDAY, MAY 6")
                      stays shown as chosen until another day is picked —
                      it is what the document said, and it resolves to a date
                      the same way a picked day does.
                    */}
                    {eventDayOptions.length > 0 ? (
                      <View style={styles.dayChoices}>
                        {r.day !== '' &&
                          !eventDayOptions.some((iso) => writtenDay(iso) === r.day) && (
                            <View style={[styles.dayChoice, styles.dayChoiceActive]}>
                              <Text
                                style={[styles.dayChoiceLabel, styles.dayChoiceLabelActive]}
                                numberOfLines={1}
                              >
                                {r.day}
                              </Text>
                            </View>
                          )}
                        {eventDayOptions.map((iso) => {
                          const label = writtenDay(iso);
                          const on = r.day === label;
                          return (
                            <Pressable
                              key={iso}
                              onPress={() => patch(r.key, { day: on ? '' : label })}
                              style={({ pressed }) => [
                                styles.dayChoice,
                                on && styles.dayChoiceActive,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.dayChoiceLabel,
                                  on && styles.dayChoiceLabelActive,
                                ]}
                              >
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <TextInput
                        value={r.day}
                        onChangeText={(v) => patch(r.key, { day: v })}
                        placeholder="Day — e.g. Saturday 23 May"
                        placeholderTextColor={color.textFaint}
                        style={styles.titleInput}
                      />
                    )}

                    {problem !== null && <Text style={styles.problem}>{problem}</Text>}

                    <View style={styles.editorActions}>
                      <Pressable
                        onPress={() => remove(r.key)}
                        style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
                      >
                        <Text style={styles.dangerLabel}>Delete row</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setOpenKey(null)}
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
            style={({ pressed }) => [styles.wideBtn, pressed && styles.pressed]}
          >
            <Text style={styles.btnLabel}>+ Add a session the list missed</Text>
          </Pressable>

          {blocked > 0 && <Text style={styles.help}>{describeSessionReview(rows)}</Text>}

          <Pressable
            onPress={commit}
            disabled={ready.length === 0}
            style={({ pressed }) => [
              styles.primary,
              ready.length === 0 && styles.btnDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryLabel}>
              Add {ready.length} session{ready.length === 1 ? '' : 's'}
            </Text>
          </Pressable>
        </>
      )}

      </Collapsible>

      <Collapsible title="Add one by hand" hint="One session at a time">
      <TextInput
        value={mTitle}
        onChangeText={setMTitle}
        placeholder="Session — e.g. NLS Race, SP9"
        placeholderTextColor={color.textFaint}
        style={styles.input}
      />
      {/*
        Pick the day, or type it when the event has no dates yet.

        The written form carries the weekday *and* the date, which is what
        core/logic/eventDate.ts matches on — so a session added by hand resolves
        to a real day exactly like an imported one.
      */}
      {eventDayOptions.length > 0 ? (
        <View style={styles.dayChoices}>
          {eventDayOptions.map((iso) => {
            const label = writtenDay(iso);
            const on = mDay === label;
            return (
              <Pressable
                key={iso}
                onPress={() => setMDay(on ? '' : label)}
                style={({ pressed }) => [
                  styles.dayChoice,
                  on && styles.dayChoiceActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.dayChoiceLabel,
                    on && styles.dayChoiceLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={mDay}
          onChangeText={setMDay}
          placeholder="Day — set dates on the event to pick one"
          placeholderTextColor={color.textFaint}
          style={styles.input}
        />
      )}
      <View style={styles.row}>
        <TextInput
          value={mStart}
          onChangeText={setMStart}
          placeholder="12:00"
          placeholderTextColor={color.textFaint}
          style={[styles.input, styles.cell]}
        />
        <TextInput
          value={mEnd}
          onChangeText={setMEnd}
          placeholder="16:00"
          placeholderTextColor={color.textFaint}
          style={[styles.input, styles.cell]}
        />
      </View>
      <Pressable
        onPress={addManual}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>Add session</Text>
      </Pressable>
      </Collapsible>
    </Body>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.md, paddingBottom: space.xxl },
    pressed: { opacity: 0.7 },
    btnDisabled: { opacity: 0.4 },

    kicker: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 2,
    },
    embedded: { paddingTop: space.sm },
    dayChoices: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.sm,
    },
    dayChoice: {
      paddingHorizontal: space.md,
      minHeight: 44,
      maxWidth: '100%',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    dayChoiceActive: { backgroundColor: color.accent },
    dayChoiceLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    dayChoiceLabelActive: { color: color.onAccent },

    dayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: 48,
      paddingHorizontal: space.sm,
      marginTop: space.sm,
      marginBottom: space.xs,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    dayChevron: { color: color.textMuted, fontSize: 12, width: 14 },
    dayTitle: {
      flex: 1,
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    dayCount: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },

    savedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: 48,
      paddingHorizontal: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      marginBottom: space.xs,
    },
    savedTime: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      width: 88,
    },
    savedBody: { flex: 1 },
    savedTitle: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    savedRemove: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },
    // The tappable part of a saved row: times and title, but not Remove.
    savedTap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },

    editor: {
      marginTop: space.xs,
      marginBottom: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      gap: space.xs,
    },
    editorTimes: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    editorDash: { color: color.textMuted, fontSize: type.label },
    timeInput: {
      flex: 1,
      minHeight: 44,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      color: color.text,
      fontSize: type.label,
      fontVariant: ['tabular-nums'],
    },
    titleInput: {
      minHeight: 44,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      color: color.text,
      fontSize: type.label,
    },
    saveBtn: {
      marginTop: space.xs,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },

    back: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
      marginBottom: space.sm,
    },
    venue: {
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
      marginTop: space.xs,
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
    link: { color: color.accent, fontSize: type.label, fontWeight: weight.bold },
    status: {
      color: color.text,
      fontSize: type.label,
      marginTop: space.sm,
      backgroundColor: color.surface,
      borderRadius: radius.sm,
      padding: space.sm,
    },

    row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    cell: { flex: 1 },
    btn: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    wideBtn: {
      marginTop: space.sm,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    btnLabel: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },

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
    paste: { minHeight: 96, textAlignVertical: 'top' },

    reviewHead: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    session: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    sessionOn: { borderColor: color.accent },
    // Ticked but not writable yet — says so without shouting.
    sessionBlocked: { borderColor: color.undocumented, borderStyle: 'dashed' },
    sessionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    tick: { color: color.textFaint, fontSize: 16, width: 18 },
    tickOn: { color: color.accent, fontWeight: weight.bold },
    // Gloves (§5.14): the glyph is small, the target it sits in is not.
    tickTap: {
      minWidth: 32,
      minHeight: HIT_SIZE - 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sessionBody: { flex: 1, minHeight: HIT_SIZE - 20, justifyContent: 'center' },
    sessionTitle: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    sessionMeta: {
      color: color.textMuted,
      fontSize: 11,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    chevron: { color: color.textFaint, fontSize: 14, width: 14, textAlign: 'center' },
    source: {
      color: color.textFaint,
      fontSize: 11,
      marginTop: space.xs,
      fontStyle: 'italic',
    },
    rowEditor: {
      marginTop: space.sm,
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: color.border,
      gap: space.xs,
    },
    problem: { color: color.undocumented, fontSize: 11, marginTop: space.xs },
    editorActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
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
    primaryLabel: {
      color: color.onAccent,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
  });
}
