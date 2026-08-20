/**
 * The entry list — which cars are running, and which you have already shot.
 *
 * Two halves, like the timetable: the field itself, ticked off as you go
 * round the paddock; and underneath it, how the field got there. Pasted text
 * only for now — PDF extraction is not wired up on device yet (see job #6 in
 * HANDOFF-entry-lists.md).
 *
 * ── The confirmation step is the point ─────────────────────────────────────
 * Same rule as TimetableScreen, spec §5.3: nothing is written until Add is
 * pressed. It matters more here — the parser fabricates the odd entry out of
 * document furniture (HANDOFF-entry-lists.md job #2), so every row starts
 * ticked *in the review* but is still a claim to check, not a fact to accept.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseEntryList, describeEntryParse, type TextEntry } from '../../core/logic/entryList';
import Collapsible from '../Collapsible';
import { color, radius, space, type, weight } from '../theme';

export interface SavedEntryRow {
  readonly id: string;
  readonly number: string;
  readonly className: string | null;
  readonly team: string | null;
  readonly drivers: readonly string[];
  readonly photographed: boolean;
}

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
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<TextEntry[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  const progress = useMemo(
    () => ({
      photographed: entries.filter((e) => e.photographed).length,
      total: entries.length,
    }),
    [entries],
  );

  const onRead = () => {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      setStatus('Nothing to read — paste an entry list first.');
      return;
    }
    const r = parseEntryList(raw);
    setParsed([...r.entries]);
    setSkipped([...r.skipped]);
    // Every row starts checked — the parser does not guess, but it does
    // occasionally read document furniture as a car (see the header note), so
    // this is still a review, not a fait accompli.
    setChosen(new Set(r.entries.map((_, i) => i)));
    setStatus(describeEntryParse(r));
  };

  const toggle = (i: number) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const commit = () => {
    const rows = parsed.filter((_, i) => chosen.has(i));
    if (rows.length === 0) {
      setStatus('Nothing selected.');
      return;
    }
    onCommit(rows);
    setParsed([]);
    setSkipped([]);
    setChosen(new Set());
    setRaw('');
    setStatus(`Added ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}.`);
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

        {status && <Text style={styles.status}>{status}</Text>}

        {parsed.length > 0 && (
          <>
            <Text style={styles.label}>REVIEW</Text>
            <Text style={styles.help}>
              Nothing is saved until you press Add. Uncheck anything that is not
              a car — a title, a date, a page footer.
            </Text>

            {parsed.map((p, i) => {
              const on = chosen.has(i);
              return (
                <Pressable
                  key={i}
                  onPress={() => toggle(i)}
                  style={({ pressed }) => [
                    styles.reviewRow,
                    on && styles.reviewRowOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.tick, on && styles.tickOn]}>
                    {on ? '✓' : '○'}
                  </Text>
                  <Text style={styles.number}>{p.number || '—'}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {p.team ?? (p.drivers.length > 0 ? p.drivers.join(' / ') : p.source)}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {[p.className, p.team && p.drivers.length > 0 ? p.drivers.join(' / ') : null]
                        .filter(Boolean)
                        .join(' · ') || p.source}
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
              <Text style={styles.primaryLabel}>Add {chosen.size} entr{chosen.size === 1 ? 'y' : 'ies'}</Text>
            </Pressable>
          </>
        )}
      </Collapsible>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

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
  reviewRowOn: { borderColor: color.accent },

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
  primaryLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },
});
