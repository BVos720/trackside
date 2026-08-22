/**
 * Profile — "kind of like an account, but you don't have to make an account."
 *
 * No sign-in, no email, no password. This screen is a face on the identity
 * that already exists: `LOCAL_USER_ID` (`ui/state/useSpots.ts`) is already
 * attached to every spot, note and media row this app has ever written, so
 * the profile is that same id, not a second one — see
 * `storage-local/preferences.ts`'s `getProfileName`/`setProfileName`.
 *
 * Three sections, in the order they get used: Appearance, Performance, Gear.
 * Gear is the one with real content, and deliberately does not sit third on a
 * screen that scrolls out of view — it is last only because it is being built
 * concurrently elsewhere (see below), not because it matters least.
 *
 * Follows `CircuitScreen.tsx`'s shape for a top-level, non-event-scoped
 * screen (`useSafeAreaInsets` + `MENU_CLEARANCE`) and `EventScreen.tsx`'s use
 * of `Collapsible` for named sections.
 *
 * Appearance (TASKS-profile.md B3) is real: three options — System, Light,
 * Dark — read and write `useTheme()`'s `preference`/`setPreference`, which
 * round-trip through `storage-local/preferences.ts`'s
 * `getThemePreference`/`setThemePreference`. This screen (and `Collapsible`,
 * which it uses throughout) is migrated to `useTheme()` so the switch has a
 * real, visible effect end to end — see `MainMenu.tsx` for the migration
 * pattern this follows.
 *
 * ── Performance (D1) ─────────────────────────────────────────────────────
 * A single toggle over `getMapSceneryEnabled`/`setMapSceneryEnabled`
 * (`storage-local/preferences.ts`) — loaded fresh on mount (survives a cold
 * restart) rather than assumed from any in-memory default, and written
 * straight through on every flip. `MapScreen.tsx` only reads the stored value
 * on its own mount, and it is conditionally rendered rather than kept mounted
 * behind a navigator, so no live-update subscription is needed here — the
 * next visit to the map already picks up the change.
 *
 * ── Gear (D2) ────────────────────────────────────────────────────────────
 * Add/remove UI for `core/domain/gear.ts`'s `GearItem`. State (`gearItems`)
 * and the mutating calls (`onAddGearItem`/`onRemoveGearItem`) are owned by
 * `App.tsx` via `useGear()`, not by this screen — the same hook instance
 * feeds the event screen's gear dropdown (D4), so adding a body here updates
 * that dropdown immediately rather than only after a remount.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bodies, lenses, GearKind, type GearItem } from '../../core/domain/gear';
import type { UserGearItemId } from '../../core/domain/ids';
import { getMapSceneryEnabled, setMapSceneryEnabled } from '../../storage-local/preferences';
import Collapsible from '../Collapsible';
import {
  HIT_SIZE,
  MENU_CLEARANCE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
  type ThemePreference,
} from '../theme';

/**
 * Labelled by the choice, not the mechanism — "System" rather than "Follow
 * device" — short enough that three fit in one row at `HIT_SIZE` each on a
 * phone-width screen, per `EventScreen.tsx`/`SpotSheet.tsx`'s existing
 * option-row convention (`SpotSheet.tsx`'s `ACCESS_OPTIONS`,
 * `MainMenu.tsx`'s `USE_OPTIONS`).
 */
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ProfileScreen({
  displayName,
  onChangeDisplayName,
  gearItems,
  onAddGearItem,
  onRemoveGearItem,
}: {
  /** Null means unnamed — see `setProfileName`. */
  displayName: string | null;
  onChangeDisplayName: (name: string | null) => void;
  /** The user's whole gear locker, live ones only — owned by `App.tsx`'s `useGear()`. */
  gearItems: readonly GearItem[];
  onAddGearItem: (input: {
    kind: GearKind;
    manufacturer: string;
    model: string;
    cropFactor?: number | null;
  }) => void;
  onRemoveGearItem: (id: UserGearItemId) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(displayName ?? '');
  const { color, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed !== (displayName ?? '')) onChangeDisplayName(trimmed);
  };

  // `null` while the stored value is still loading — read fresh on every
  // mount rather than assumed, so a cold restart shows the real persisted
  // state from the first render, not a default that then flips.
  const [sceneryEnabled, setSceneryEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const enabled = await getMapSceneryEnabled();
      if (!cancelled) setSceneryEnabled(enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleScenery = () => {
    setSceneryEnabled((current) => {
      const next = !(current ?? true);
      void setMapSceneryEnabled(next);
      return next;
    });
  };

  const [gearKind, setGearKind] = useState<GearKind>(GearKind.Body);
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [cropFactorText, setCropFactorText] = useState('');

  const gearBodies = useMemo(() => bodies(gearItems), [gearItems]);
  const gearLenses = useMemo(() => lenses(gearItems), [gearItems]);

  const addGear = () => {
    if (manufacturer.trim() === '' || model.trim() === '') return;
    const trimmedCropFactor = cropFactorText.trim();
    const parsedCropFactor =
      gearKind === GearKind.Body && trimmedCropFactor !== ''
        ? Number(trimmedCropFactor)
        : null;
    onAddGearItem({
      kind: gearKind,
      manufacturer,
      model,
      cropFactor:
        parsedCropFactor !== null && Number.isFinite(parsedCropFactor) && parsedCropFactor > 0
          ? parsedCropFactor
          : null,
    });
    setManufacturer('');
    setModel('');
    setCropFactorText('');
    setGearKind(GearKind.Body);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <Text style={styles.kicker}>PROFILE</Text>
      <Text style={styles.title}>Local, not an account</Text>
      <Text style={styles.subtitle}>
        Nothing here leaves this device. There is no sign-in — just settings
        for how the app looks and behaves, and the gear you shoot with.
      </Text>

      <Text style={styles.label}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="Optional — shown nowhere but here"
        placeholderTextColor={color.textFaint}
        style={styles.input}
        returnKeyType="done"
      />

      <Collapsible
        title="Appearance"
        hint="Light, dark, and an accent colour"
        initiallyOpen
      >
        <Text style={styles.help}>
          System follows the phone's own setting, and updates immediately if
          that changes — a sunset switching your phone to dark will not fight
          a Light choice made this morning.
        </Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((option) => {
            const on = option.value === preference;
            return (
              <Pressable
                key={option.value}
                onPress={() => setPreference(option.value)}
                style={({ pressed }) => [
                  styles.themeOption,
                  on && styles.themeOptionOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.themeOptionLabel, on && styles.themeOptionLabelOn]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.placeholder}>
          An accent colour you pick is coming here next.
        </Text>
      </Collapsible>

      <Collapsible
        title="Performance"
        hint={sceneryEnabled === false ? 'Map scenery off' : 'Map detail, for slower devices'}
      >
        <Text style={styles.help}>
          Trees and field detail cost the most to draw. Turn them off if the
          map feels slow on this device — the circuit and its buildings stay
          on either way.
        </Text>
        <Pressable
          onPress={toggleScenery}
          disabled={sceneryEnabled === null}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Map scenery</Text>
            <Text style={styles.toggleSubtitle}>
              Trees and field detail on the map
            </Text>
          </View>
          <Switch
            value={sceneryEnabled ?? true}
            onValueChange={toggleScenery}
            trackColor={{ false: color.surfaceRaised, true: color.accent }}
            thumbColor={color.text}
            pointerEvents="none"
          />
        </Pressable>
      </Collapsible>

      <Collapsible
        title="Gear"
        hint="Bodies and lenses, for the event dropdown"
      >
        <Text style={styles.help}>
          Added here, this gear shows up in the event screen's Gear dropdown.
        </Text>

        {gearBodies.length === 0 && gearLenses.length === 0 ? (
          <Text style={styles.placeholder}>Nothing added yet.</Text>
        ) : (
          <>
            {gearBodies.length > 0 && (
              <GearGroup
                label="BODIES"
                items={gearBodies}
                styles={styles}
                onRemove={onRemoveGearItem}
              />
            )}
            {gearLenses.length > 0 && (
              <GearGroup
                label="LENSES"
                items={gearLenses}
                styles={styles}
                onRemove={onRemoveGearItem}
              />
            )}
          </>
        )}

        <Text style={styles.label}>ADD GEAR</Text>
        <View style={styles.kindRow}>
          {GEAR_KIND_OPTIONS.map((option) => {
            const on = option.value === gearKind;
            return (
              <Pressable
                key={option.value}
                onPress={() => setGearKind(option.value)}
                style={({ pressed }) => [
                  styles.kindOption,
                  on && styles.kindOptionOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.kindOptionLabel, on && styles.kindOptionLabelOn]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={manufacturer}
          onChangeText={setManufacturer}
          placeholder="Manufacturer — e.g. Canon"
          placeholderTextColor={color.textFaint}
          style={styles.gearInput}
          returnKeyType="next"
        />
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="Model — e.g. EOS R7"
          placeholderTextColor={color.textFaint}
          style={styles.gearInput}
          returnKeyType={gearKind === GearKind.Body ? 'next' : 'done'}
          onSubmitEditing={gearKind === GearKind.Body ? undefined : addGear}
        />
        {gearKind === GearKind.Body && (
          <TextInput
            value={cropFactorText}
            onChangeText={setCropFactorText}
            placeholder="Crop factor — optional, e.g. 1.6"
            placeholderTextColor={color.textFaint}
            style={styles.gearInput}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={addGear}
          />
        )}

        <Pressable
          onPress={addGear}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>
            Add {gearKind === GearKind.Body ? 'body' : 'lens'}
          </Text>
        </Pressable>
      </Collapsible>
    </ScrollView>
  );
}

const GEAR_KIND_OPTIONS: { value: GearKind; label: string }[] = [
  { value: GearKind.Body, label: 'Body' },
  { value: GearKind.Lens, label: 'Lens' },
];

/** One row's label — "Canon EOS R7", with the crop factor for a body. */
function gearItemLabel(item: GearItem): string {
  return `${item.manufacturer} ${item.model}`.trim();
}

function gearItemSubtitle(item: GearItem): string | null {
  if (item.kind !== GearKind.Body) return null;
  return item.cropFactor === null
    ? 'Crop factor not recorded'
    : item.cropFactor === 1
      ? 'Full frame'
      : `${item.cropFactor}× crop`;
}

function GearGroup({
  label,
  items,
  styles,
  onRemove,
}: {
  label: string;
  items: readonly GearItem[];
  styles: ReturnType<typeof makeStyles>;
  onRemove: (id: UserGearItemId) => void;
}) {
  return (
    <View>
      <Text style={styles.groupHeading}>{label}</Text>
      {items.map((item) => {
        const subtitle = gearItemSubtitle(item);
        return (
          <View key={item.id} style={styles.gearRow}>
            <View style={styles.gearRowText}>
              <Text style={styles.itemName} numberOfLines={1}>
                {gearItemLabel(item)}
              </Text>
              {subtitle && (
                <Text style={styles.itemSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => onRemove(item.id)}
              hitSlop={8}
              style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
            >
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Built per-render from the current theme rather than once at import — see
 * `MainMenu.tsx`'s `makeStyles` and theme.ts's `ThemeProvider` doc comment.
 */
function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.md, paddingBottom: space.xxl },
    pressed: { opacity: 0.7 },

    kicker: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 2,
    },
    title: {
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
      marginTop: space.xs,
    },
    subtitle: {
      color: color.textMuted,
      fontSize: type.label,
      lineHeight: 17,
      marginTop: space.xs,
      marginBottom: space.md,
    },

    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },
    input: {
      marginTop: space.sm,
      marginBottom: space.md,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      color: color.text,
      fontSize: type.body,
      minHeight: 44,
    },

    help: {
      color: color.textMuted,
      fontSize: type.label,
      lineHeight: 17,
      marginBottom: space.sm,
    },
    /**
     * Three options in a row, each `HIT_SIZE` tall — §5.14, and this
     * screen's own instruction that the switch needs "a large enough touch
     * target for HIT_SIZE/gloves". Same shape as `MainMenu.tsx`'s
     * `modeRow`/`mode` (two options) and `SpotSheet.tsx`'s `ACCESS_OPTIONS`
     * rows (a taller single column) — this is the row variant of the same
     * option-picker convention.
     */
    themeRow: { flexDirection: 'row', gap: space.sm },
    themeOption: {
      flex: 1,
      minHeight: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    themeOptionOn: { borderColor: color.accent, backgroundColor: color.surface },
    themeOptionLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    themeOptionLabelOn: { color: color.text },

    placeholder: {
      color: color.textFaint,
      fontSize: type.label,
      lineHeight: 17,
      marginTop: space.sm,
    },

    /**
     * The whole row is the tap target, `HIT_SIZE` tall (§5.14) — the `Switch`
     * itself is a fixed platform size well under that, so it renders
     * `pointerEvents="none"` and is purely the visual state; the row's own
     * `onPress` is what actually flips the preference.
     */
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      minHeight: HIT_SIZE,
      paddingHorizontal: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    toggleText: { flex: 1 },
    toggleLabel: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
    toggleSubtitle: { color: color.textFaint, fontSize: 11, marginTop: 1 },

    /** Two options in a row, same shape as `themeRow`/`themeOption` above. */
    kindRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    kindOption: {
      flex: 1,
      minHeight: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    kindOptionOn: { borderColor: color.accent, backgroundColor: color.surface },
    kindOptionLabel: { color: color.textMuted, fontSize: type.body, fontWeight: weight.bold },
    kindOptionLabelOn: { color: color.text },

    gearInput: {
      marginTop: space.sm,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      color: color.text,
      fontSize: type.body,
      minHeight: HIT_SIZE,
    },

    groupHeading: {
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.md,
    },
    gearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: HIT_SIZE,
      paddingHorizontal: space.sm,
      marginTop: space.xs,
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    gearRowText: { flex: 1 },
    itemName: { color: color.text, fontSize: type.label, fontWeight: weight.bold },
    itemSubtitle: { color: color.textFaint, fontSize: 11, marginTop: 1 },
    removeBtn: {
      minHeight: HIT_SIZE,
      minWidth: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    remove: { color: color.textMuted, fontSize: 11, fontWeight: weight.bold },

    primary: {
      marginTop: space.md,
      minHeight: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    primaryLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },
  });
}
