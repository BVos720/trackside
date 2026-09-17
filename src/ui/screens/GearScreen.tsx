import { Text, TextInput } from '../Typography';
/**
 * What you are carrying this weekend — `TASKS-profile.md` D4/D5.
 *
 * A *selection* over a standing inventory, not an add-item form: the locker
 * itself is built once in the profile screen (D2), and this widget only says
 * which of those items are carried for the active event.
 *
 * ── The list is the event's, not the locker's ─────────────────────────────
 * This used to show the whole locker with ticks beside it, which made the
 * event screen a second copy of the profile screen: on a weekend where you
 * carry two bodies out of six, four of the rows were things you deliberately
 * left at home. Now the section shows what you are taking, and "Add gear"
 * opens the locker to pick from. Same arrangement the entry list uses — the
 * field on top, the way it got there folded away underneath.
 *
 * ── D5: one-handed, in gloves ────────────────────────────────────────────
 * The task calls this "the fiddliest control in the app so far" and asks for
 * `HIT_SIZE` throughout — not the 44/48px used elsewhere in this file's
 * siblings. The search input and every row are sized to `HIT_SIZE` (56),
 * because a search-and-tap flow under a moving map is exactly the "driveable
 * with a thumb" case §5.14 is about.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GearKind, bodies, lenses, type GearItem } from '../../core/domain/gear';
import { searchGear } from '../../core/logic/gearSearch';
import PanelEmptyState from '../PanelEmptyState';
import type { UserGearItemId } from '../../core/domain/ids';
import {
  HIT_SIZE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

/** One row's label — "Canon EOS R7". */
function gearLabel(item: GearItem): string {
  return `${item.manufacturer} ${item.model}`.trim();
}

function gearSubtitle(item: GearItem): string | null {
  if (item.kind !== GearKind.Body) return null;
  return item.cropFactor === null
    ? 'Crop factor not recorded'
    : item.cropFactor === 1
      ? 'Full frame'
      : `${item.cropFactor}× crop`;
}

export default function GearScreen({
  items,
  selectedIds,
  onToggle,
}: {
  /** The user's whole locker — bodies and lenses, live ones only. */
  items: readonly GearItem[];
  /** Gear ids already attached to the active event. */
  selectedIds: ReadonlySet<UserGearItemId>;
  onToggle: (id: UserGearItemId, included: boolean) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  /** What is going to this event, in locker order. */
  const carried = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );

  /**
   * What is left to pick from.
   *
   * Already-carried items are excluded rather than shown ticked: this list
   * exists to answer "what else am I taking", and an item that is already on
   * the list above is not an answer to that.
   */
  const available = useMemo(
    () => searchGear(items.filter((i) => !selectedIds.has(i.id)), query),
    [items, selectedIds, query],
  );

  const groups = useMemo(
    () => [
      { key: 'body', label: 'BODIES', rows: bodies(available) },
      { key: 'lens', label: 'LENSES', rows: lenses(available) },
    ],
    [available],
  );

  if (items.length === 0) {
    return (
      <PanelEmptyState eyebrow="Your kit" title="Build your trackside kit" description="Add bodies and lenses in Profile → Gear. Then choose what to bring to this event here." />
    );
  }

  return (
    <View>
      {/* ── what you are taking ── */}
      {carried.length === 0 ? (
        <PanelEmptyState eyebrow="Your kit" title="Pack for the weekend" description="Choose bodies and lenses from your locker. Only the gear you’re bringing will appear here." />
      ) : (
        <>
          <View style={styles.kitHeading}>
            <Text accessibilityRole="header" style={styles.kitTitle}>Packed for the circuit</Text>
            <Text style={styles.kitCount}>{carried.length} {carried.length === 1 ? 'item' : 'items'}</Text>
          </View>
          {carried.map((item) => {
            const subtitle = gearSubtitle(item);
            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.itemHeader}>
                  <Text style={styles.kind}>{item.kind === GearKind.Body ? 'CAMERA BODY' : 'LENS'}</Text>
                  <Text style={styles.packed}>✓ Packed</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.carriedName}>
                    {gearLabel(item)}
                  </Text>
                  {subtitle && (
                    <Text style={styles.itemSubtitle}>
                      {subtitle}
                    </Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${gearLabel(item)} from this event`}
                  onPress={() => onToggle(item.id, false)}
                  style={({ pressed }) => [styles.removeTap, pressed && styles.pressed]}
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      )}

      {/* ── the locker, folded away until asked for ── */}
      {!adding ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAdding(true)}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
        >
          <Text style={styles.addLabel}>+ Add gear for this event</Text>
        </Pressable>
      ) : (
        <View style={styles.picker}>
          <TextInput
            accessibilityLabel="Search your gear"
            value={query}
            onChangeText={setQuery}
            placeholder="Search your gear — e.g. &quot;r6&quot; or &quot;canon&quot;"
            placeholderTextColor={color.textFaint}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            autoFocus
          />

          {items.length === carried.length ? (
            <Text style={styles.help}>
              Everything in your locker is already on this event.
            </Text>
          ) : available.length === 0 ? (
            <Text style={styles.help}>No gear matches "{query.trim()}".</Text>
          ) : (
            groups.map((group) =>
              group.rows.length === 0 ? null : (
                <View key={group.key}>
                  <Text style={styles.groupHeading}>{group.label}</Text>
                  {group.rows.map((item) => {
                    const subtitle = gearSubtitle(item);
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Pack ${gearLabel(item)}`}
                        key={item.id}
                        onPress={() => {
                          onToggle(item.id, true);
                          // The query stays: packing two lenses from the same
                          // family means the same search twice otherwise.
                        }}
                        style={({ pressed }) => [
                          styles.pickRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.tick}>+</Text>
                        <View style={styles.rowText}>
                          <Text style={styles.itemName}>
                            {gearLabel(item)}
                          </Text>
                          {subtitle && (
                            <Text style={styles.itemSubtitle}>
                              {subtitle}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ),
            )
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAdding(false);
              setQuery('');
            }}
            style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
          >
            <Text style={styles.addLabel}>Done</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    pressed: { opacity: 0.7 },

    help: { color: color.textMuted, fontSize: 14, lineHeight: 22, marginVertical: space.sm },
    kitHeading: { gap: space.xs, marginTop: space.sm, marginBottom: space.sm },
    kitTitle: { color: color.text, fontSize: 28, fontWeight: weight.bold },
    kitCount: { color: color.textMuted, fontSize: type.label },
    itemHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
    kind: { color: color.textMuted, fontSize: 10, letterSpacing: 1.2, fontWeight: weight.bold },
    packed: { color: color.accent, fontSize: 11, fontWeight: weight.bold },
    carriedName: { color: color.text, fontSize: type.body, fontWeight: weight.bold, marginTop: space.sm },

    search: {
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      color: color.text,
      fontSize: type.body,
      minHeight: HIT_SIZE,
      paddingVertical: space.sm,
      borderWidth: 1,
      borderColor: color.border,
    },

    groupHeading: {
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.md,
    },

    row: {
      padding: space.md,
      marginBottom: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: HIT_SIZE,
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
      marginTop: space.xs,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    rowText: { flexShrink: 1, minWidth: 0 },
    itemName: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    itemSubtitle: { color: color.textMuted, fontSize: 11, marginTop: 2 },

    tick: { color: color.textFaint, fontSize: 18, width: 18, textAlign: 'center' },
    removeTap: {
      minHeight: HIT_SIZE,
      paddingHorizontal: space.sm,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.sm,
      marginTop: space.sm,
    },
    remove: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },

    addBtn: {
      marginTop: space.sm,
      minHeight: HIT_SIZE,
      padding: space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    addLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },

    picker: {
      marginTop: space.sm,
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: color.border,
    },
    doneBtn: {
      marginTop: space.md,
      minHeight: HIT_SIZE,
      padding: space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
  });
}
