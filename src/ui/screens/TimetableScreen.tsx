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
 * So parsed rows arrive as unchecked candidates you review, with the lines it
 * could not read shown alongside rather than hidden.
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

import {
  parseTimetableLines,
  type TextSession,
} from '../../core/logic/timetableText';
import { rowText } from '../../storage-local/pdfText';
import { PdfBridge, PDF_BRIDGE_SUPPORTED } from '../../storage-local/pdfBridge';
import { pickPdf } from '../../storage-local/pickPdf';
import Collapsible from '../Collapsible';
import { radius, space, type, useTheme, weight, type Theme } from '../theme';

export interface PendingSession {
  readonly key: string;
  readonly day: string | null;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly kind: string;
  readonly onTrack: boolean;
}

const toPending = (s: TextSession, i: number): PendingSession => ({
  key: `${s.start}-${s.end}-${i}`,
  day: s.day,
  title: s.title,
  start: s.start,
  end: s.end,
  kind: s.kind,
  onTrack: s.onTrack,
});

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
  const [parsed, setParsed] = useState<PendingSession[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  /** Bytes waiting on the bridge, and the filename to report them under. */
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
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
    () => (showAll ? parsed : parsed.filter((p) => p.onTrack)),
    [parsed, showAll],
  );

  const applyParse = (lines: string[], label: string) => {
    const r = parseTimetableLines(lines);
    const rows = r.sessions.map(toPending);
    setParsed(rows);
    setSkipped([...r.skipped]);
    // Track sessions pre-selected; paperwork left unticked but visible. The
    // user decides, not the parser.
    setChosen(new Set(rows.filter((x) => x.onTrack).map((x) => x.key)));
    setStatus(
      `${label}: ${rows.length} session${rows.length === 1 ? '' : 's'} read, ` +
        `${rows.filter((x) => x.onTrack).length} on track` +
        (r.skipped.length > 0 ? `, ${r.skipped.length} line(s) unreadable` : ''),
    );
  };

  const onPaste = () => {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      setStatus('Nothing to read — paste a timetable first.');
      return;
    }
    applyParse(lines, 'Pasted text');
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

  const toggle = (key: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const commit = () => {
    const rows = parsed.filter((p) => chosen.has(p.key));
    if (rows.length === 0) {
      setStatus('Nothing selected.');
      return;
    }
    onCommit(rows);
    setParsed([]);
    setSkipped([]);
    setChosen(new Set());
    setRaw('');
    setStatus(`Added ${rows.length} session${rows.length === 1 ? '' : 's'}.`);
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
      style={embedded ? styles.embedded : styles.root}
      contentContainerStyle={embedded ? undefined : styles.content}
      keyboardShouldPersistTaps="handled"
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

            return [...byDay.entries()].map(([day, rows], index) => {
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
                    <Text style={styles.dayCount}>{rows.length}</Text>
                  </Pressable>

                  {open &&
                    rows.map((row) => {
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
          onRows={(rows) => {
            setPdfBytes(null);
            // Back to lines for `parseTimetableLines`, which reads all three
            // real Spa documents correctly and stays the first thing tried.
            applyParse(
              rows.map(rowText).filter((l) => l !== ''),
              pdfName ?? 'the PDF',
            );
          }}
          onError={(message) => {
            setPdfBytes(null);
            setStatus(message);
          }}
        />
      )}
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
      {!PDF_BRIDGE_SUPPORTED && (
        <Text style={styles.help}>
          Reading PDFs needs a newer build of the app. Paste the text for now —
          it goes through the same parser.
        </Text>
      )}

      <TextInput
        value={raw}
        onChangeText={setRaw}
        placeholder={'Or paste the timetable here…\n11:00 12:30 FIA WEC FREE PRACTICE 1 Track'}
        placeholderTextColor={color.textFaint}
        multiline
        style={[styles.input, styles.paste]}
      />

      {status && <Text style={styles.status}>{status}</Text>}

      {parsed.length > 0 && (
        <>
          <View style={styles.reviewHead}>
            <Text style={styles.label}>REVIEW</Text>
            <Pressable onPress={() => setShowAll((v) => !v)}>
              <Text style={styles.link}>
                {showAll ? 'Track only' : `Show all ${parsed.length}`}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.help}>
            Nothing is saved until you press Add. Paperwork is left unticked.
          </Text>

          {visible.map((p) => {
            const on = chosen.has(p.key);
            return (
              <Pressable
                key={p.key}
                onPress={() => toggle(p.key)}
                style={({ pressed }) => [
                  styles.session,
                  on && styles.sessionOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.tick, on && styles.tickOn]}>
                  {on ? '✓' : '○'}
                </Text>
                <View style={styles.sessionBody}>
                  <Text style={styles.sessionTitle} numberOfLines={1}>
                    {p.title}
                  </Text>
                  <Text style={styles.sessionMeta}>
                    {p.start}–{p.end} · {p.kind}
                    {p.day ? ` · ${p.day}` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {skipped.length > 0 && (
            <>
              <Text style={styles.label}>COULD NOT READ</Text>
              <Text style={styles.help}>
                Shown rather than dropped, so nothing goes missing quietly.
              </Text>
              {skipped.map((l, i) => (
                <Text key={i} style={styles.skipped} numberOfLines={1}>
                  {l}
                </Text>
              ))}
            </>
          )}

          <Pressable
            onPress={commit}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>Add {chosen.size} session(s)</Text>
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
    savedDay: { color: color.textFaint, fontSize: 10, marginTop: 1 },
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    sessionOn: { borderColor: color.accent },
    tick: { color: color.textFaint, fontSize: 16, width: 18 },
    tickOn: { color: color.accent, fontWeight: weight.bold },
    sessionBody: { flex: 1 },
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
    skipped: {
      color: color.undocumented,
      fontSize: 11,
      marginTop: space.xs,
      fontStyle: 'italic',
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
