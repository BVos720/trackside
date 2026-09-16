import { Text, TextInput } from '../Typography';
/**
 * Say what each column is, and watch the records appear.
 *
 * The human half of TASKS-pdf-mapping.md. `pdfColumns.ts` proposes the grid,
 * `mappingGuess.ts` proposes what each column means, and this is where a
 * person looks at both and corrects what is wrong — the part that differs
 * between every series and the part they answer at a glance.
 *
 * ── It starts filled in ───────────────────────────────────────────────────
 * It used to start empty on principle, which cost ten taps before the first
 * car appeared on documents where the answer was plain from the cells. Now
 * the machine's reading is already on the grid, labelled like any other
 * choice, with the live preview underneath showing what it reads. Agreeing is
 * one tap on Use; disagreeing is one tap on the cell that is wrong.
 *
 * ── One screen, two documents ─────────────────────────────────────────────
 * Entry lists and timetables differ in their fields and in nothing else the
 * screen cares about, so the difference is a `MapperSpec` (mapperSpecs.ts)
 * rather than a second copy of this file.
 *
 * ── The grid, not the page ────────────────────────────────────────────────
 * The plan's ideal is a rendered page with bands drawn over it. Showing the
 * sliced grid works on every platform, and the grid *is* the structure — the
 * columns it shows are the columns the document has.
 *
 * Nothing here writes anything. It hands records back, and the editable
 * review in the calling screen is still the last word.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  assign,
  fieldAt,
  isExcluded,
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
import type { MapperSpec } from './mapperSpecs';
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

function emptyMapping<F extends string>(): ColumnMapping<F> {
  return { rowsPerEntry: 1, assignments: [], excluded: [] };
}

export default function ColumnMapper<F extends string, R>({
  grid,
  spec,
  onUse,
  onCancel,
  templates = [],
  onSaveTemplate,
  onTemplateUsed,
}: {
  /** Rows sliced into cells — `gridOf(rows, findColumns(rows))`. */
  grid: readonly string[][];
  spec: MapperSpec<F, R>;
  /** Hand the mapped records to the editable review. */
  onUse: (records: R[]) => void;
  onCancel: () => void;
  /** Layouts saved from previous imports, most recently used first. */
  templates?: readonly MappingTemplate[];
  onSaveTemplate?: (name: string, mapping: ColumnMapping<F>) => void;
  onTemplateUsed?: (id: MappingTemplateId) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  /** The machine's reading, taken once when the grid arrives. */
  const [initial] = useState(() => spec.guess(grid));
  const guessed = initial.assignments.length > 0;
  const [mapping, setMapping] = useState<ColumnMapping<F>>(initial);
  /** Which cell's field picker is open, as `row:column`. */
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  /** Set once a suggestion has been taken or dismissed, so it stops nagging. */
  const [suggestionHandled, setSuggestionHandled] = useState(false);

  const [one, many] = spec.noun;

  /**
   * Layouts that might fit this document, best first.
   *
   * A suggestion and never an action. A template that has gone stale because
   * the publisher moved a column produces plausible records assembled from
   * the wrong cells — so it fills the mapper in, the preview below shows what
   * it reads, and the person still presses the button.
   */
  const suggestion = useMemo(
    () =>
      suggestionHandled || !spec.templates
        ? null
        : (matchTemplates(grid, templates)[0] ?? null),
    [grid, templates, suggestionHandled, spec.templates],
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

  const records = useMemo(
    () => (spec.usable(mapping) ? spec.apply(grid, mapping) : []),
    [grid, mapping, spec],
  );

  const shortFor = (field: F | 'ignore') =>
    spec.fields.find((f) => f.field === field)?.short ?? '';

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
              <Text style={styles.secondaryLabel}>Not this one</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const decoded = decodeMapping(suggestion.template.mapping);
                // A layout written by an older build, or corrupted, must not
                // take the screen down — mapping by hand is always there.
                if (decoded) setMapping(decoded as unknown as ColumnMapping<F>);
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

      <View style={styles.labelRow}>
        <Text style={styles.label}>CHOOSE COLUMNS</Text>
        {mapping.assignments.length > 0 && (
          <Pressable
            onPress={() => {
              setMapping(emptyMapping<F>());
              setPicking(null);
            }}
            hitSlop={8}
          >
            <Text style={styles.link}>Start from empty</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.help}>
        {guessed
          ? `Filled in from what the columns look like. Tap any cell to change what it is — the ${many} underneath update as you go.`
          : 'Tap a cell and say what it is.'}{' '}
        Nothing is saved here: the {many} go to the review, where you can still
        correct them.
      </Text>

      {/* ── how tall a record is ── */}
      <View style={styles.strideRow}>
        <Text style={styles.strideLabel}>Rows per {one}</Text>
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
          Each {one} spans {stride} rows. Assign a field on whichever row
          carries it.
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
                        field !== 'ignore' && styles.cellAssigned,
                        open && styles.cellPicking,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.cellText} numberOfLines={1}>
                        {cells[c] ?? ''}
                      </Text>
                      {field !== 'ignore' && (
                        <Text style={styles.cellField}>{shortFor(field)}</Text>
                      )}
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => setMapping((m) => toggleExcluded(m, cells))}
                  style={({ pressed }) => [styles.notEntry, pressed && styles.pressed]}
                >
                  <Text style={styles.notEntryLabel}>Not a {one}</Text>
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
            {spec.fields.map(({ field, label }) => {
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
          {mapping.excluded.length === 1 ? '' : 's'} marked as not {many} — every
          row that looks the same is skipped, on every page.
        </Text>
      )}

      {/* ── what it reads, live ── */}
      <Text style={styles.label}>READS</Text>
      <Text style={styles.status}>{spec.describe(grid, mapping)}</Text>

      {records.slice(0, 3).map((record, i) => {
        const p = spec.preview(record);
        return (
          <View key={i} style={styles.preview}>
            <Text style={styles.previewLead}>{p.lead}</Text>
            <View style={styles.previewBody}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {p.title}
              </Text>
              <Text style={styles.previewMeta} numberOfLines={1}>
                {p.meta || ' '}
              </Text>
            </View>
          </View>
        );
      })}

      {onSaveTemplate && spec.templates && spec.usable(mapping) && (
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
          onPress={() => records.length > 0 && onUse(records)}
          disabled={records.length === 0}
          style={({ pressed }) => [
            styles.primary,
            records.length === 0 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryLabel}>
            Use {records.length} {records.length === 1 ? one : many}
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

    labelRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.lg,
    },
    link: { color: color.accent, fontSize: type.label, fontWeight: weight.bold },
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
    previewLead: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      minWidth: 36,
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
