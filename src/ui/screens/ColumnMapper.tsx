/**
 * Say what each column is, and watch the entries appear.
 *
 * The human half of TASKS-pdf-mapping.md. `pdfColumns.ts` proposes the grid;
 * this is where a person assigns meaning to it, which is the part that differs
 * between every series and the part they answer at a glance.
 *
 * ── The grid, not the page ────────────────────────────────────────────────
 * The plan's ideal is a rendered page with bands drawn over it. That needs
 * pdfjs, which runs on web and not on the phone (`PDF_SUPPORTED === false`),
 * so a page-render mapper would be a feature Branco could not use where he
 * uses the app. Showing the sliced grid instead works on both, and the grid
 * *is* the structure — the columns it shows are the columns the document has.
 * The page render stays worth doing on web (M1), as a nicer skin over this.
 *
 * ── It also works with no columns at all ──────────────────────────────────
 * Pasted text has no positions, and two of the five sample documents have no
 * consistent bands even as PDFs. Both arrive here as a single column of whole
 * lines, where the useful control is "how many rows make one car" — which is
 * exactly what reads the Spa Six Hours list that the parser loses seven cars
 * from.
 *
 * Nothing here writes anything. It hands a list of entries back, and the
 * editable review (EntryListScreen) is still the last word.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { TextEntry } from '../../core/logic/entryList';
import {
  EntryField,
  applyMapping,
  assign,
  describeMapping,
  emptyMapping,
  fieldAt,
  isExcluded,
  isUsable,
  toggleExcluded,
  type ColumnMapping,
} from '../../core/logic/columnMapping';
import type { MappingTemplate } from '../../core/domain/mappingTemplate';
import type { MappingTemplateId } from '../../core/domain/ids';
import {
  decodeMapping,
  describeMatch,
  matchTemplates,
} from '../../core/logic/templateMatch';
import {
  HIT_SIZE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

/** How many rows to show as a sample. Enough to see the pattern, few enough to fit. */
const SAMPLE = 6;

const FIELDS: { field: EntryField; label: string }[] = [
  { field: EntryField.Number, label: 'Number' },
  { field: EntryField.ClassName, label: 'Class' },
  { field: EntryField.Team, label: 'Team' },
  { field: EntryField.Drivers, label: 'Drivers' },
  { field: EntryField.Ignore, label: 'Ignore' },
];

const SHORT: Record<EntryField, string> = {
  [EntryField.Number]: 'No.',
  [EntryField.ClassName]: 'Class',
  [EntryField.Team]: 'Team',
  [EntryField.Drivers]: 'Drivers',
  [EntryField.Ignore]: '',
};

export default function ColumnMapper({
  grid,
  onUse,
  onCancel,
  templates = [],
  onSaveTemplate,
  onTemplateUsed,
}: {
  /** Rows sliced into cells — `gridOf(rows, findColumns(rows))`. */
  grid: readonly string[][];
  /** Hand the mapped entries to the editable review. */
  onUse: (entries: TextEntry[]) => void;
  onCancel: () => void;
  /** Layouts saved from previous imports, most recently used first. */
  templates?: readonly MappingTemplate[];
  onSaveTemplate?: (name: string, mapping: ColumnMapping) => void;
  onTemplateUsed?: (id: MappingTemplateId) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  /** Which cell's field picker is open, as `row:column`. */
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  /** Set once a suggestion has been taken or dismissed, so it stops nagging. */
  const [suggestionHandled, setSuggestionHandled] = useState(false);

  /**
   * Layouts that might fit this document, best first.
   *
   * A suggestion and never an action. A template that has gone stale because
   * the publisher moved a column produces plausible cars assembled from the
   * wrong cells — so it fills the mapper in, the preview below shows what it
   * reads, and the person still presses the button.
   */
  const suggestion = useMemo(
    () => (suggestionHandled ? null : (matchTemplates(grid, templates)[0] ?? null)),
    [grid, templates, suggestionHandled],
  );

  const columns = useMemo(
    () => Math.max(...grid.map((r) => r.length), 0),
    [grid],
  );

  /**
   * The sample, skipping rows the user has already excluded.
   *
   * Recomputed as exclusions change, so the sample fills up with rows that
   * still need a decision rather than showing the same header six times.
   */
  const sample = useMemo(
    () => grid.filter((cells) => !isExcluded(cells, mapping)).slice(0, SAMPLE),
    [grid, mapping],
  );

  const entries = useMemo(
    () => (isUsable(mapping) ? applyMapping(grid, mapping) : []),
    [grid, mapping],
  );

  const stride = mapping.rowsPerEntry;

  const setStride = (n: number) =>
    setMapping((m) => ({
      ...m,
      rowsPerEntry: Math.max(1, Math.min(6, n)),
      // Assignments below the new height would be unreachable and invisible,
      // which is worse than losing them: the preview would not match what the
      // screen shows and there would be no way to see why.
      assignments: m.assignments.filter((a) => a.row < Math.max(1, Math.min(6, n))),
    }));

  return (
    <View>
      {suggestion && (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>{describeMatch(suggestion)}</Text>
          <View style={styles.suggestionActions}>
            <Pressable
              onPress={() => setSuggestionHandled(true)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryLabel}>Map by hand</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const decoded = decodeMapping(suggestion.template.mapping);
                // A layout written by an older build, or corrupted, must not
                // take the screen down — mapping by hand is always there.
                if (decoded) setMapping(decoded);
                onTemplateUsed?.(suggestion.template.id);
                setSuggestionHandled(true);
              }}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>Use this layout</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={styles.label}>CHOOSE COLUMNS</Text>
      <Text style={styles.help}>
        Tap a cell and say what it is. Nothing is saved here — the entries go to
        the review, where you can still correct them.
      </Text>

      {/* ── how tall a record is ── */}
      <View style={styles.strideRow}>
        <Text style={styles.strideLabel}>Rows per car</Text>
        <Pressable
          onPress={() => setStride(stride - 1)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <Text style={styles.strideValue}>{stride}</Text>
        <Pressable
          onPress={() => setStride(stride + 1)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
      {stride > 1 && (
        <Text style={styles.help}>
          Each car spans {stride} rows. Assign a field on whichever row carries
          it.
        </Text>
      )}

      {/* ── the grid ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.gridScroll}>
        <View>
          {sample.map((cells, i) => {
            const offset = i % stride;
            const startsRecord = offset === 0;
            return (
              <View
                key={i}
                style={[styles.gridRow, startsRecord && stride > 1 && styles.recordStart]}
              >
                {stride > 1 && <Text style={styles.offset}>{offset + 1}</Text>}

                {Array.from({ length: columns }, (_, c) => {
                  const key = `${offset}:${c}`;
                  const field = fieldAt(mapping, offset, c);
                  const open = picking === key;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setPicking(open ? null : key)}
                      style={({ pressed }) => [
                        styles.cell,
                        field !== EntryField.Ignore && styles.cellAssigned,
                        open && styles.cellPicking,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.cellText} numberOfLines={1}>
                        {cells[c] ?? ''}
                      </Text>
                      {field !== EntryField.Ignore && (
                        <Text style={styles.cellField}>{SHORT[field]}</Text>
                      )}
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => setMapping((m) => toggleExcluded(m, cells))}
                  style={({ pressed }) => [styles.notEntry, pressed && styles.pressed]}
                >
                  <Text style={styles.notEntryLabel}>Not a car</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* ── the field picker for the tapped cell ── */}
      {picking !== null && (
        <View style={styles.picker}>
          <Text style={styles.pickerTitle}>
            This column is…
            {stride > 1 ? ` (row ${Number(picking.split(':')[0]) + 1})` : ''}
          </Text>
          <View style={styles.pickerRow}>
            {FIELDS.map(({ field, label }) => {
              const [r, c] = picking.split(':').map(Number) as [number, number];
              const on = fieldAt(mapping, r, c) === field;
              return (
                <Pressable
                  key={field}
                  onPress={() => {
                    setMapping((m) => assign(m, r, c, field));
                    setPicking(null);
                  }}
                  style={({ pressed }) => [
                    styles.pick,
                    on && styles.pickOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.pickLabel, on && styles.pickLabelOn]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {mapping.excluded.length > 0 && (
        <Text style={styles.help}>
          {mapping.excluded.length} row shape
          {mapping.excluded.length === 1 ? '' : 's'} marked as not cars — every
          row that looks the same is skipped, on every page.
        </Text>
      )}

      {/* ── what it reads, live ── */}
      <Text style={styles.label}>READS</Text>
      <Text style={styles.status}>{describeMapping(grid, mapping)}</Text>

      {entries.slice(0, 3).map((e, i) => (
        <View key={i} style={styles.preview}>
          <Text style={styles.previewNumber}>{e.number}</Text>
          <View style={styles.previewBody}>
            <Text style={styles.previewTitle} numberOfLines={1}>
              {e.team ?? '—'}
            </Text>
            <Text style={styles.previewMeta} numberOfLines={1}>
              {[e.className, e.drivers.join(' / ')].filter(Boolean).join(' · ') || ' '}
            </Text>
          </View>
        </View>
      ))}

      {onSaveTemplate && isUsable(mapping) && (
        <View style={styles.saveBox}>
          {saving ? (
            <>
              <Text style={styles.help}>
                Name it after the series, not the round — the layout is the same
                next time.
              </Text>
              <TextInput
                value={saveName}
                onChangeText={setSaveName}
                placeholder="WEC entry list"
                placeholderTextColor={color.textFaint}
                style={styles.saveInput}
                autoCapitalize="words"
                autoCorrect={false}
              />
              <View style={styles.suggestionActions}>
                <Pressable
                  onPress={() => setSaving(false)}
                  style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                >
                  <Text style={styles.secondaryLabel}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    onSaveTemplate(saveName, mapping);
                    setSaving(false);
                    setSaveName('');
                  }}
                  style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                >
                  <Text style={styles.primaryLabel}>Save layout</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              onPress={() => setSaving(true)}
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            >
              <Text style={styles.btnLabel}>Save this layout for next time</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => entries.length > 0 && onUse(entries)}
          disabled={entries.length === 0}
          style={({ pressed }) => [
            styles.primary,
            entries.length === 0 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryLabel}>
            Use {entries.length} car{entries.length === 1 ? '' : 's'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },

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

    strideRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.sm,
    },
    strideLabel: { color: color.text, fontSize: type.label, flex: 1 },
    strideValue: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      width: 24,
      textAlign: 'center',
    },
    step: {
      width: HIT_SIZE - 12,
      height: HIT_SIZE - 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    stepLabel: { color: color.text, fontSize: 20, fontWeight: weight.bold },

    gridScroll: { marginTop: space.sm },
    gridRow: { flexDirection: 'row', alignItems: 'stretch', gap: space.xs, marginBottom: space.xs },
    // The first row of a multi-row record, so the rhythm is visible.
    recordStart: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.xs },
    offset: {
      color: color.textFaint,
      fontSize: 11,
      width: 14,
      alignSelf: 'center',
      textAlign: 'center',
    },

    cell: {
      width: 118,
      minHeight: HIT_SIZE - 12,
      justifyContent: 'center',
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    cellAssigned: { borderColor: color.accent },
    cellPicking: { backgroundColor: color.surfaceRaised, borderColor: color.text },
    cellText: { color: color.text, fontSize: 11 },
    cellField: {
      color: color.accent,
      fontSize: 10,
      fontWeight: weight.bold,
      marginTop: 2,
    },

    notEntry: {
      minHeight: HIT_SIZE - 12,
      paddingHorizontal: space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: color.surfaceRaised,
    },
    notEntryLabel: { color: color.textMuted, fontSize: 10, fontWeight: weight.bold },

    picker: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    pickerTitle: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
    pick: {
      minHeight: 44,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    pickOn: { backgroundColor: color.accent },
    pickLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    pickLabelOn: { color: color.onAccent },

    status: {
      color: color.text,
      fontSize: type.label,
      marginTop: space.xs,
      backgroundColor: color.surface,
      borderRadius: radius.sm,
      padding: space.sm,
    },

    preview: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.xs,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    previewNumber: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      width: 36,
    },
    previewBody: { flex: 1 },
    previewTitle: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    previewMeta: { color: color.textMuted, fontSize: 11, marginTop: 2 },

    suggestion: {
      marginTop: space.md,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.accent,
    },
    suggestionText: { color: color.text, fontSize: type.label, lineHeight: 18 },
    suggestionActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },

    saveBox: { marginTop: space.md },
    saveInput: {
      marginTop: space.xs,
      minHeight: 44,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      color: color.text,
      fontSize: type.label,
    },
    btn: {
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    btnLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },

    actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    secondary: {
      flex: 1,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    secondaryLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    primary: {
      flex: 2,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    primaryLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },
  });
}
