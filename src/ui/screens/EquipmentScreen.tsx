/**
 * The equipment checklist — this weekend's kit, ticked off as it goes in the
 * bag.
 *
 * Mirrors EntryListScreen.tsx's shape: a flat list grouped for reading, an
 * add-item control underneath. There is no parse-and-confirm step here —
 * unlike a pasted entry list, typing one item is already a deliberate act, so
 * it is saved straight away.
 *
 * ── The category picker ─────────────────────────────────────────────────────
 * `EquipmentCategory` is a closed six-value set (core/domain/equipment.ts), so
 * the add-item form needs a picker, not a text field. This reuses the
 * trigger-button-plus-modal-sheet pattern already in the codebase
 * (`ui/map/VenueSwitcher.tsx`, and the same shape inline in `MainMenu.tsx`)
 * rather than inventing a second picker primitive — React Native has no
 * native `<select>`, and that Modal-backed bottom sheet is this app's answer
 * to "pick one of a short closed list" everywhere else it comes up.
 */
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  type EquipmentCategory,
} from '../../core/logic/equipment';
import Collapsible from '../Collapsible';
import { color, radius, space, type, weight } from '../theme';

export interface SavedEquipmentRow {
  readonly id: string;
  readonly name: string;
  readonly category: EquipmentCategory | null;
  readonly packed: boolean;
}

/**
 * Packed / total over a slim view row.
 *
 * Not `packedCount` from `core/domain/equipment.ts` — that filters on
 * `deletedAt`, a field this view type deliberately does not carry (see
 * `SavedEntryRow` in `EntryListScreen.tsx` for the same trade). The rows
 * reaching this screen are already live; the hook's `listByEvent` filtered
 * tombstones out before they ever got here.
 */
function countPacked(rows: readonly SavedEquipmentRow[]): {
  packed: number;
  total: number;
} {
  return { packed: rows.filter((r) => r.packed).length, total: rows.length };
}

/** Groups items by category, closed-set order first, "Uncategorised" last. */
function groupByCategory(items: readonly SavedEquipmentRow[]) {
  const byCategory = new Map<EquipmentCategory | null, SavedEquipmentRow[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category);
    if (bucket) bucket.push(item);
    else byCategory.set(item.category, [item]);
  }

  const ordered: {
    key: string;
    label: string;
    rows: SavedEquipmentRow[];
  }[] = [];
  for (const c of EQUIPMENT_CATEGORIES) {
    const rows = byCategory.get(c);
    if (rows) ordered.push({ key: c, label: EQUIPMENT_CATEGORY_LABELS[c], rows });
  }
  const uncategorised = byCategory.get(null);
  if (uncategorised) {
    ordered.push({ key: 'uncategorised', label: 'Uncategorised', rows: uncategorised });
  }
  return ordered;
}

export default function EquipmentScreen({
  items,
  onTogglePacked,
  onAddItem,
  onRemoveItem,
}: {
  items: readonly SavedEquipmentRow[];
  onTogglePacked: (id: string, packed: boolean) => void;
  onAddItem: (name: string, category: EquipmentCategory | null) => void;
  onRemoveItem?: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<EquipmentCategory | null>(null);

  const groups = useMemo(() => groupByCategory(items), [items]);

  const add = () => {
    if (name.trim() === '') return;
    onAddItem(name, category);
    setName('');
    setCategory(null);
  };

  return (
    <View>
      {items.length === 0 ? (
        <Text style={styles.help}>
          Nothing on the list yet. Add what you are bringing below.
        </Text>
      ) : (
        groups.map((group) => {
          const count = countPacked(group.rows);
          return (
            <View key={group.key}>
              <View style={styles.groupHeadingRow}>
                <Text style={styles.groupHeading}>{group.label.toUpperCase()}</Text>
                <Text style={styles.groupCount}>
                  {count.packed}/{count.total}
                </Text>
              </View>
              {group.rows.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onTogglePacked(item.id, !item.packed)}
                  style={({ pressed }) => [
                    styles.row,
                    item.packed && styles.rowOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.tick, item.packed && styles.tickOn]}>
                    {item.packed ? '✓' : '○'}
                  </Text>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {onRemoveItem && (
                    <Pressable
                      onPress={() => onRemoveItem(item.id)}
                      hitSlop={8}
                      style={({ pressed }) => pressed && styles.pressed}
                    >
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          );
        })
      )}

      <Collapsible title="Add item" hint="Name and category">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. R5 body"
          placeholderTextColor={color.textFaint}
          style={styles.input}
          onSubmitEditing={add}
          returnKeyType="done"
        />

        <Text style={styles.label}>CATEGORY</Text>
        <CategoryPicker value={category} onChange={setCategory} />

        <Pressable
          onPress={add}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>Add item</Text>
        </Pressable>
      </Collapsible>
    </View>
  );
}

/**
 * The category picker itself — a trigger button that opens a bottom-sheet
 * Modal listing the six categories plus "Uncategorised", styled after
 * `VenueSwitcher.tsx`.
 */
function CategoryPicker({
  value,
  onChange,
}: {
  value: EquipmentCategory | null;
  onChange: (v: EquipmentCategory | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value ? EQUIPMENT_CATEGORY_LABELS[value] : 'Uncategorised';

  const choose = (v: EquipmentCategory | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pressed]}
      >
        <Text style={styles.pickerTriggerLabel}>{label}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={() => {}}>
            <Text style={styles.menuTitle}>CATEGORY</Text>
            <ScrollView>
              <Pressable
                onPress={() => choose(null)}
                style={({ pressed }) => [
                  styles.item,
                  value === null && styles.itemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.itemLabel, value === null && styles.itemLabelActive]}
                >
                  Uncategorised
                </Text>
                {value === null && <Text style={styles.itemTick}>✓</Text>}
              </Pressable>
              {EQUIPMENT_CATEGORIES.map((c) => {
                const active = c === value;
                return (
                  <Pressable
                    key={c}
                    onPress={() => choose(c)}
                    style={({ pressed }) => [
                      styles.item,
                      active && styles.itemActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[styles.itemLabel, active && styles.itemLabelActive]}
                    >
                      {EQUIPMENT_CATEGORY_LABELS[c]}
                    </Text>
                    {active && <Text style={styles.itemTick}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  help: { color: color.textMuted, fontSize: type.label, lineHeight: 17 },

  label: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
    marginTop: space.md,
  },

  groupHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  groupHeading: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },
  groupCount: {
    color: color.textFaint,
    fontSize: 11,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
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
  itemName: { flex: 1, color: color.text, fontSize: type.label, fontWeight: weight.bold },
  remove: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },

  tick: { color: color.textFaint, fontSize: 16, width: 18 },
  tickOn: { color: color.accent, fontWeight: weight.bold },

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

  pickerTrigger: {
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  pickerTriggerLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
  chevron: { color: color.textMuted, fontSize: 14 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  menu: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.md,
    maxHeight: '70%',
  },
  menuTitle: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
    marginBottom: space.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    marginBottom: space.sm,
  },
  itemActive: { backgroundColor: color.accent },
  itemLabel: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
  itemLabelActive: { color: color.onAccent },
  itemTick: { color: color.onAccent, fontSize: 16, fontWeight: weight.bold },

  primary: {
    marginTop: space.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent,
  },
  primaryLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },
});
