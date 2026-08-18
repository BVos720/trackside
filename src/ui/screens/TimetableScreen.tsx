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
import { extractPdfLines, PDF_SUPPORTED } from '../../storage-local/pdfText';
import { color, radius, space, type, weight } from '../theme';

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

export default function TimetableScreen({
  circuitLabel,
  eventName,
  eventDates,
  savedCount,
  onCommit,
  onBack,
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
  savedCount: number;
  onCommit: (rows: PendingSession[]) => void;
  onBack: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<PendingSession[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const onPickPdf = () => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || !PDF_SUPPORTED) {
      setStatus('PDF import is not available here — paste the text instead.');
      return;
    }
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setStatus('Reading PDF…');
      try {
        const lines = await extractPdfLines(file);
        applyParse(lines, file.name);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    };
    input.click();
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.back}>‹ Events</Text>
      </Pressable>

      <Text style={styles.kicker}>TIMETABLE</Text>
      <Text style={styles.venue}>{eventName ?? circuitLabel}</Text>
      <Text style={styles.help}>
        {eventName ? `${circuitLabel}` : 'No event active'}
        {eventDates ? ` · ${eventDates}` : ''}
      </Text>
      <Text style={styles.help}>
        {savedCount === 0
          ? 'No sessions saved yet.'
          : `${savedCount} session${savedCount === 1 ? '' : 's'} saved.`}
      </Text>

      <Text style={styles.label}>IMPORT</Text>
      <View style={styles.row}>
        <Pressable
          onPress={onPickPdf}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
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
      {!PDF_SUPPORTED && (
        <Text style={styles.help}>
          PDF reading is desktop-only for now. On a phone, paste the text.
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

      <Text style={styles.label}>ADD ONE MANUALLY</Text>
      <TextInput
        value={mTitle}
        onChangeText={setMTitle}
        placeholder="Session — e.g. NLS Race, SP9"
        placeholderTextColor={color.textFaint}
        style={styles.input}
      />
      <TextInput
        value={mDay}
        onChangeText={setMDay}
        placeholder="Day — e.g. Saturday 10 October"
        placeholderTextColor={color.textFaint}
        style={styles.input}
      />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingBottom: space.xxl },
  pressed: { opacity: 0.7 },

  kicker: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
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
