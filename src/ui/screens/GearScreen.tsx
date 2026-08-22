/**
 * The gear dropdown, embedded in the event screen — `TASKS-profile.md` D4/D5.
 *
 * Mirrors EquipmentScreen.tsx's shape (a list plus a control underneath), but
 * this is a *selection* over a standing inventory, not an add-item form: the
 * locker itself is built once in the profile screen (D2), and this widget
 * only says which of those items are carried for the active event. Search
 * matters once the list is long, so this is a text-filtered multi-select
 * rather than a plain checklist.
 *
 * ── D5: one-handed, in gloves ────────────────────────────────────────────
 * The task calls this "the fiddliest control in the app so far" and asks for
 * `HIT_SIZE` throughout — not the 44/48px used elsewhere in this file's
 * siblings. The search input and every row below are sized to `HIT_SIZE`
 * (56) rather than the smaller heights `EquipmentScreen.tsx` gets away with,
 * because a search-and-tap flow under a moving map is exactly the "driveable
 * with a thumb" case §5.14 is about.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GearKind, bodies, lenses, type GearItem } from '../../core/domain/gear';
import { searchGear } from '../../core/logic/gearSearch';
import type { UserGearItemId } from '../../core/domain/ids';
import { HIT_SIZE, color, radius, space, type, weight } from '../theme';

/** One row's label — "Canon EOS R7", with the crop factor for a body. */
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
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => searchGear(items, query), [items, query]);
  const groups = useMemo(
    () => [
      { key: 'body', label: 'BODIES', rows: bodies(filtered) },
      { key: 'lens', label: 'LENSES', rows: lenses(filtered) },
    ],
    [filtered],
  );

  if (items.length === 0) {
    return (
      <Text style={styles.help}>
        No gear yet — add bodies and lenses from the profile screen's Gear
        section, then attach them to this event here.
      </Text>
    );
  }

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your gear — e.g. &quot;r6&quot; or &quot;canon&quot;"
        placeholderTextColor={color.textFaint}
        style={styles.search}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {selectedIds.size > 0 && (
        <Text style={styles.selectedCount}>
          {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} for this
          event
        </Text>
      )}

      {filtered.length === 0 ? (
        <Text style={styles.help}>No gear matches "{query.trim()}".</Text>
      ) : (
        groups.map((group) =>
          group.rows.length === 0 ? null : (
            <View key={group.key}>
              <Text style={styles.groupHeading}>{group.label}</Text>
              {group.rows.map((item) => {
                const included = selectedIds.has(item.id);
                const subtitle = gearSubtitle(item);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onToggle(item.id, !included)}
                    style={({ pressed }) => [
                      styles.row,
                      included && styles.rowOn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.tick, included && styles.tickOn]}>
                      {included ? '✓' : '○'}
                    </Text>
                    <View style={styles.rowText}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {gearLabel(item)}
                      </Text>
                      {subtitle && (
                        <Text style={styles.itemSubtitle} numberOfLines={1}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  help: { color: color.textMuted, fontSize: type.label, lineHeight: 17 },

  search: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.text,
    fontSize: type.body,
    height: HIT_SIZE,
  },
  selectedCount: {
    color: color.textMuted,
    fontSize: type.label,
    marginTop: space.sm,
  },

  groupHeading: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
    marginTop: space.md,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: HIT_SIZE,
    paddingHorizontal: space.sm,
    marginTop: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: color.accent },
  rowText: { flex: 1 },
  itemName: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
  itemSubtitle: { color: color.textFaint, fontSize: 11, marginTop: 1 },

  tick: { color: color.textFaint, fontSize: 18, width: 22, textAlign: 'center' },
  tickOn: { color: color.accent, fontWeight: weight.bold },
});
