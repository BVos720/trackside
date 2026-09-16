import { Text, TextInput } from '../Typography';
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
 * ── The accent hue slider (TASKS-profile.md C1/C2) ──────────────────────────
 * A continuous drag strip, not a swatch grid — the ask was "a slider of
 * color". No gesture library and no `Animated` are installed in this project
 * (`SkyControl.tsx`'s header note explains why neither should be added), so
 * this follows that file's own `PanResponder` + `onLayout`-measured-width +
 * `latestRef` pattern exactly, down to the `pointerEvents="none"` on the
 * visual hue cells so Android hit-tests the strip itself rather than
 * whichever narrow cell sits under the finger (the bug `SkyControl`'s strip
 * hit and fixed). The strip is painted from `deriveAccent` at the *current*
 * `scheme`, not a fixed rainbow — what you see while dragging is exactly
 * what you get, in both palettes. `useTheme()`'s `accentHue`/`setAccentHue`
 * round-trip through `storage-local/preferences.ts`'s
 * `getThemeAccentHue`/`setThemeAccentHue`; the derivation itself (fixed
 * saturation, luminance-solved lightness per scheme) lives in
 * `core/logic/accentColor.ts`, not here — see that file for why the result
 * stays legible for every hue the strip can produce (C2).
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Switch, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveAccent } from '../../core/logic/accentColor';
import { bodies, lenses, GearKind, type GearItem } from '../../core/domain/gear';
import type { UserGearItemId } from '../../core/domain/ids';
import {
  getMapHillshadeEnabled,
  getMapRainEnabled,
  getMapSceneryDistance,
  getMapSceneryEnabled,
  getMapStarsEnabled,
  setMapHillshadeEnabled,
  setMapRainEnabled,
  setMapSceneryDistance,
  setMapSceneryEnabled,
  setMapStarsEnabled,
} from '../../storage-local/preferences';
import {
  presetOf,
  settingsForPreset,
  type GraphicsPreset,
  type GraphicsSettings,
  type SceneryDistance,
} from '../../core/logic/graphicsPreset';
import { BUILD_LABEL } from '../../buildInfo';
import {
  clearLogs,
  readCurrentLog,
  readPreviousLog,
} from '../../storage-local/appLog';
import { resetApp } from '../../storage-local/resetApp';
import Collapsible from '../Collapsible';
import PageHeader from '../PageHeader';
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
  onOpenTerrainSpike,
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
  /** Opens the throwaway WebView terrain test. See TerrainSpike.tsx. */
  onOpenTerrainSpike: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(displayName ?? '');
  const { color, scheme, preference, setPreference, accentHue, setAccentHue } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  /**
   * Two-tap confirmation for the developer wipe.
   *
   * Not an Alert: this is reached only in a debug build, and a confirmation
   * dialog is one more thing to dismiss on every iteration of exactly the loop
   * this button exists to shorten. One deliberate second tap is enough friction
   * for something no shipped build ever shows.
   */
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearApp = async () => {
    if (clearing) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    try {
      await resetApp();
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed !== (displayName ?? '')) onChangeDisplayName(trimmed);
  };

  // `null` while the stored value is still loading — read fresh on every
  // mount rather than assumed, so a cold restart shows the real persisted
  // state from the first render, not a default that then flips.
  const [sceneryEnabled, setSceneryEnabled] = useState<boolean | null>(null);
  const [rainEnabled, setRainEnabled] = useState<boolean | null>(null);
  const [starsEnabled, setStarsEnabled] = useState<boolean | null>(null);
  const [hillshadeEnabled, setHillshadeEnabled] = useState<boolean | null>(null);
  const [sceneryDistance, setSceneryDistanceState] =
    useState<SceneryDistance | null>(null);

  /*
    The switches as one value, for the preset row.

    Null until everything has loaded, so the row cannot briefly highlight a
    preset that only matches because half the settings are still at their
    defaults.
  */
  const graphics: GraphicsSettings | null =
    sceneryEnabled === null ||
    rainEnabled === null ||
    starsEnabled === null ||
    hillshadeEnabled === null ||
    sceneryDistance === null
      ? null
      : {
          scenery: sceneryEnabled,
          sceneryDistance,
          rain: rainEnabled,
          stars: starsEnabled,
          hillshade: hillshadeEnabled,
        };

  const activePreset = graphics === null ? null : presetOf(graphics);

  /*
    A preset writes the switches rather than shadowing them.

    One source of truth for what is drawn: "Low" is a shortcut to a set of
    values, not a mode that overrides them. So after tapping it every switch
    below shows what it actually is, and changing one simply stops any preset
    being highlighted.
  */
  const applyPreset = (preset: GraphicsPreset) => {
    const next = settingsForPreset(preset);
    setSceneryEnabled(next.scenery);
    setRainEnabled(next.rain);
    setStarsEnabled(next.stars);
    setHillshadeEnabled(next.hillshade);
    setSceneryDistanceState(next.sceneryDistance);
    void setMapSceneryEnabled(next.scenery);
    void setMapRainEnabled(next.rain);
    void setMapStarsEnabled(next.stars);
    void setMapHillshadeEnabled(next.hillshade);
    void setMapSceneryDistance(next.sceneryDistance);
  };

  const toggleStars = () => {
    setStarsEnabled((current) => {
      const next = !(current ?? true);
      void setMapStarsEnabled(next);
      return next;
    });
  };

  const toggleHillshade = () => {
    setHillshadeEnabled((current) => {
      const next = !(current ?? true);
      void setMapHillshadeEnabled(next);
      return next;
    });
  };

  /*
   * The log from the run before this one.
   *
   * The point of the whole feature: when the app dies there is no stack and
   * no error screen, and this is the only surviving account of what it was
   * doing. Loaded on demand rather than at mount, because it is a file read
   * for a panel most sessions never open.
   */
  const [previousLog, setPreviousLog] = useState<string | null>(null);
  const [currentLog, setCurrentLog] = useState<string | null>(null);

  const loadLogs = () => {
    setCurrentLog(readCurrentLog());
    void readPreviousLog().then(setPreviousLog);
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const enabled = await getMapSceneryEnabled();
      const rain = await getMapRainEnabled();
      const stars = await getMapStarsEnabled();
      const hillshade = await getMapHillshadeEnabled();
      const distance = await getMapSceneryDistance();
      if (!cancelled) {
        setSceneryEnabled(enabled);
        setRainEnabled(rain);
        setStarsEnabled(stars);
        setHillshadeEnabled(hillshade);
        setSceneryDistanceState(distance);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRain = () => {
    setRainEnabled((current) => {
      const next = !(current ?? true);
      void setMapRainEnabled(next);
      return next;
    });
  };

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
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <PageHeader eyebrow="Your paddock" title={displayName ? `Make it yours, ${displayName}.` : 'A setup of your own.'} description="Your equipment, your preferences, your way of seeing the circuit. Saved on this device, with no account needed." />

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
        <Text style={[styles.label, styles.accentLabel]}>ACCENT COLOUR</Text>
        <AccentHueSlider
          scheme={scheme}
          hue={accentHue}
          onChange={setAccentHue}
          color={color}
        />
      </Collapsible>

      <Collapsible
        title="Performance"
        hint={sceneryEnabled === false ? 'Map scenery off' : 'Map detail, for slower devices'}
      >
        <Text style={styles.help}>
          A preset sets everything below at once. Change any switch afterwards
          and it simply stops matching a preset — nothing is locked.
        </Text>

        <View style={styles.presetRow}>
          {(['low', 'medium', 'high'] as const).map((p) => (
            <Pressable
              key={p}
              onPress={() => applyPreset(p)}
              disabled={graphics === null}
              style={({ pressed }) => [
                styles.preset,
                activePreset === p && styles.presetOn,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.presetLabel,
                  activePreset === p && styles.presetLabelOn,
                ]}
              >
                {p === 'low' ? 'Low' : p === 'medium' ? 'Medium' : 'High'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.help}>
          Trees and field detail cost the most to draw. Turn them off if the
          map feels slow on this device — the circuit, the spots and the light
          stay on at every setting.
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

        <Text style={styles.help}>
          Rain falls on the 3D map when the forecast has it raining at the
          circuit. It animates the whole time it runs, so turn it off if the
          map feels slow or the movement gets in the way — the forecast itself
          is unaffected.
        </Text>
        <Pressable
          onPress={toggleRain}
          disabled={rainEnabled === null}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Rain on the 3D map</Text>
            <Text style={styles.toggleSubtitle}>
              Falling rain when the forecast has it
            </Text>
          </View>
          <Switch
            value={rainEnabled ?? true}
            onValueChange={toggleRain}
            trackColor={{ false: color.surfaceRaised, true: color.accent }}
            thumbColor={color.text}
            pointerEvents="none"
          />
        </Pressable>

        <Pressable
          onPress={toggleStars}
          disabled={starsEnabled === null}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Stars at night</Text>
            <Text style={styles.toggleSubtitle}>
              The night sky's star field. The moon stays either way.
            </Text>
          </View>
          <Switch
            value={starsEnabled ?? true}
            onValueChange={toggleStars}
            trackColor={{ false: color.surfaceRaised, true: color.accent }}
            thumbColor={color.text}
            pointerEvents="none"
          />
        </Pressable>

        <Pressable
          onPress={toggleHillshade}
          disabled={hillshadeEnabled === null}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Relief shading</Text>
            <Text style={styles.toggleSubtitle}>
              Depth on the hills. The terrain keeps its shape without it.
            </Text>
          </View>
          <Switch
            value={hillshadeEnabled ?? true}
            onValueChange={toggleHillshade}
            trackColor={{ false: color.surfaceRaised, true: color.accent }}
            thumbColor={color.text}
            pointerEvents="none"
          />
        </Pressable>

        {/*
          Distance, not a count.

          What costs frames is how much is on screen at once, and that is a
          function of how far you can see rather than how many trees exist.
        */}
        <Text style={styles.help}>How far scenery is drawn.</Text>
        <View style={styles.presetRow}>
          {(['near', 'mid', 'far'] as const).map((d) => (
            <Pressable
              key={d}
              onPress={() => {
                setSceneryDistanceState(d);
                void setMapSceneryDistance(d);
              }}
              disabled={sceneryDistance === null || sceneryEnabled === false}
              style={({ pressed }) => [
                styles.preset,
                sceneryDistance === d && styles.presetOn,
                sceneryEnabled === false && styles.presetMuted,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.presetLabel,
                  sceneryDistance === d && styles.presetLabelOn,
                ]}
              >
                {d === 'near' ? 'Near' : d === 'mid' ? 'Medium' : 'Far'}
              </Text>
            </Pressable>
          ))}
        </View>
      </Collapsible>

      <Collapsible title="Diagnostics" hint="What the app logged, including the run that crashed">
        <Text style={styles.help}>
          The last few hundred lines this app logged. “Previous run” is what
          survived the last time it closed — if it crashed, that is the only
          record of what it was doing.
        </Text>

        <Pressable
          onPress={loadLogs}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Load logs</Text>
            <Text style={styles.toggleSubtitle}>
              {currentLog === null ? 'Not loaded' : 'Tap to refresh'}
            </Text>
          </View>
        </Pressable>

        {previousLog !== null && (
          <>
            <Text style={styles.logHeading}>Previous run</Text>
            <ScrollView style={styles.logBox} horizontal>
              <Text style={styles.logText} selectable>
                {previousLog}
              </Text>
            </ScrollView>
          </>
        )}

        {currentLog !== null && (
          <>
            <Text style={styles.logHeading}>This run</Text>
            <ScrollView style={styles.logBox} horizontal>
              <Text style={styles.logText} selectable>
                {currentLog.length > 0 ? currentLog : '(nothing logged yet)'}
              </Text>
            </ScrollView>
          </>
        )}

        {(currentLog !== null || previousLog !== null) && (
          <Pressable
            onPress={() => {
              clearLogs();
              setCurrentLog(null);
              setPreviousLog(null);
            }}
            style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
          >
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Clear logs</Text>
            </View>
          </Pressable>
        )}
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

      <Collapsible title="Credits" hint="Where the map and weather come from">
        <Text style={styles.help}>
          Trackside is built on open data. These credits are a condition of the
          licences that data is published under, not a courtesy.
        </Text>

        <Credit
          styles={styles}
          source="Map data"
          body={
            '© OpenStreetMap contributors, under the Open Database Licence. ' +
            'The offline map bundled with this app is built from that data ' +
            'using Protomaps.'
          }
        />
        <Credit
          styles={styles}
          source="Weather"
          body={
            'Forecasts from the Norwegian Meteorological Institute (MET ' +
            'Norway), under the Norwegian Licence for Open Government Data.'
          }
        />
        <Credit
          styles={styles}
          source="Elevation"
          body={
            'Terrain and hillshading from the Terrain Tiles open dataset on ' +
            'AWS, derived from public national elevation surveys.'
          }
        />

        <Text style={styles.help}>
          None of them endorse Trackside, and none of them are responsible for
          what it shows you.
        </Text>
      </Collapsible>

      {/*
        Which build this is, and why it is not hidden in an "About" section.

        A sideloaded build carries no version anyone can see, and that has cost
        real time: bugs reported against a build that already had the fix, with
        "still broken" and "not built yet" indistinguishable from a screenshot.
        The commit is the only thing that settles it, so it sits in plain sight
        at the bottom of the first settings screen rather than two taps down.

        `+local` means the tree had uncommitted changes when it was built — so
        the commit alone does not describe it.
      */}
      <Text style={styles.buildLine} selectable>
        {BUILD_LABEL}
      </Text>

      {/*
        Not gated on `__DEV__`.

        The builds this is actually tested on are Release — the GitHub Actions
        workflow builds `-configuration Release` and the result is sideloaded,
        so `__DEV__` is false and a debug-only section would never once appear
        on the device it exists to serve.

        MUST BE GATED BEFORE ANY PUBLIC RELEASE. It wipes everything with two
        taps and no undo. A build going to TestFlight or the App Store needs
        this behind a real gate — a hidden gesture, or a flag set at build
        time. It is listed in TASKS-launch.md for that reason.
      */}
      {(
        <Collapsible title="Developer" hint="Wipes everything — no undo">
          <Text style={styles.help}>
            Testing a bug usually means getting the app back to a known empty
            state. On a sideloaded build that otherwise means deleting and
            reinstalling it, which is minutes between every attempt.
          </Text>

          {/*
            The terrain spike, reachable but not advertised.

            It answers one question — can a WebView render a terrain map
            on this phone — and needs a connection to do it. See the
            header of TerrainSpike.tsx. Deleted either way once the
            question is settled.
          */}
          <Pressable
            onPress={onOpenTerrainSpike}
            style={({ pressed }) => [styles.secondaryDev, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryDevLabel}>Terrain spike (needs signal)</Text>
          </Pressable>

          <Pressable
            onPress={clearApp}
            style={({ pressed }) => [styles.destructive, pressed && styles.pressed]}
          >
            <Text style={styles.destructiveLabel}>
              {clearing ? 'Clearing…' : confirmClear ? 'Tap again to confirm' : 'Clear app'}
            </Text>
          </Pressable>

          <Text style={styles.help}>
            Deletes every spot, event, plan and photo outright — not as
            tombstones, so nothing is recoverable and nothing would ever sync.
            Settings on this screen go too. Close and reopen the app afterwards.
          </Text>
        </Collapsible>
      )}
    </ScrollView>
  );
}

/**
 * One attribution line.
 *
 * ── Why this is on a settings page and not only in PRIVACY.md ─────────────
 * ODbL requires the credit to be reasonably visible to someone *using* the
 * map, and MET Norway's terms ask for the same. A licence file in a repository
 * nobody opens does not satisfy either. This is the app's attribution notice —
 * the equivalent of the small print in the corner of a web map, which there is
 * no room for on a phone screen that is mostly map.
 */
function Credit({
  styles,
  source,
  body,
}: {
  styles: ReturnType<typeof makeStyles>;
  source: string;
  body: string;
}) {
  return (
    <View style={styles.credit}>
      <Text style={styles.creditSource}>{source}</Text>
      <Text style={styles.creditBody}>{body}</Text>
    </View>
  );
}

/** Cells across the hue circle (6° each) — see `AccentHueSlider` below. */
const HUE_TRACK_SEGMENTS = 60;
const KNOB_SIZE = 28;

/**
 * The continuous hue drag strip itself — TASKS-profile.md C1. See this
 * file's header comment for why it follows `SkyControl.tsx`'s `PanResponder`
 * pattern exactly.
 *
 * `touchArea` (not the narrower visual `track`) carries both `onLayout` and
 * `panResponder.panHandlers`, so the width used to convert a touch's
 * `locationX` into a hue is the same element the touch coordinates are
 * reported relative to, and is `HIT_SIZE` tall regardless of how slim the
 * painted strip looks — §5.14's glove-sized touch target without visually
 * ballooning the track.
 */
function AccentHueSlider({
  scheme,
  hue,
  onChange,
  color,
}: {
  scheme: 'light' | 'dark';
  hue: number;
  onChange: (hue: number) => void;
  color: Theme['color'];
}) {
  const [trackWidth, setTrackWidth] = useState(0);

  // Written every render, read only from inside the PanResponder callbacks
  // below — see `SkyControl.tsx`'s file header for why a plain closure over
  // `hue`/`trackWidth` would go stale (PanResponder.create only runs once).
  const latestRef = useRef({ trackWidth });
  latestRef.current.trackWidth = trackWidth;

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const scrubToLocationX = useCallback(
    (evt: GestureResponderEvent) => {
      const { trackWidth: width } = latestRef.current;
      if (width <= 0) return;
      const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width));
      // 360 wraps back to 0 at the strip's own far edge — normalizeHue
      // (`core/logic/accentColor.ts`) would do the same, but the slider
      // itself never produces a value outside [0, 360) to begin with.
      onChange(Math.min(359, Math.round(fraction * 360)));
    },
    [onChange],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: scrubToLocationX,
      onPanResponderMove: scrubToLocationX,
    }),
  ).current;

  // Recomputed only when `scheme` changes, not on every drag frame — the
  // strip shows every hue's colour in the *current* palette, independent of
  // which one is currently selected.
  const cells = useMemo(
    () =>
      Array.from({ length: HUE_TRACK_SEGMENTS }, (_, i) =>
        deriveAccent((i / HUE_TRACK_SEGMENTS) * 360, scheme).accent,
      ),
    [scheme],
  );

  const knobLeft = trackWidth > 0 ? (hue / 360) * trackWidth - KNOB_SIZE / 2 : 0;
  const knobColor = useMemo(() => deriveAccent(hue, scheme).accent, [hue, scheme]);

  return (
    <View
      style={sliderStyles.touchArea}
      onLayout={onTrackLayout}
      {...panResponder.panHandlers}
    >
      <View style={[sliderStyles.track, { borderColor: color.border }]}>
        {cells.map((cellColor, i) => (
          // Purely visual, like SkyControl's hourCell — pointerEvents="none"
          // keeps `touchArea` (not one narrow cell) as the sole hit-test
          // target, which is the Android bug that file's own fix note
          // describes.
          <View key={i} pointerEvents="none" style={[sliderStyles.cell, { backgroundColor: cellColor }]} />
        ))}
      </View>
      {trackWidth > 0 && (
        <View
          pointerEvents="none"
          style={[
            sliderStyles.knob,
            { left: knobLeft, borderColor: color.text, backgroundColor: knobColor },
          ]}
        />
      )}
    </View>
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
 * Structural only (size, radius, border width) — every colour applied to
 * these is theme-derived and passed inline where the element is used, so
 * nothing here goes stale the way a colour baked into a module-level
 * `StyleSheet.create` would (see `theme.ts`'s `ThemeProvider` doc comment).
 */
const sliderStyles = StyleSheet.create({
  touchArea: {
    height: HIT_SIZE,
    justifyContent: 'center',
  },
  track: {
    flexDirection: 'row',
    height: 16,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cell: { flex: 1, height: '100%' },
  knob: {
    position: 'absolute',
    top: (HIT_SIZE - (KNOB_SIZE + 6)) / 2,
    width: KNOB_SIZE,
    height: KNOB_SIZE + 6,
    borderRadius: KNOB_SIZE / 2,
    borderWidth: 3,
  },
});

/**
 * Built per-render from the current theme rather than once at import — see
 * `MainMenu.tsx`'s `makeStyles` and theme.ts's `ThemeProvider` doc comment.
 */
function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.lg, paddingBottom: 64, width: '100%', maxWidth: 760, alignSelf: 'center' },
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

    credit: { marginTop: space.sm },
    buildLine: {
      color: color.textFaint,
      fontSize: type.label,
      textAlign: 'center',
      marginTop: space.lg,
      fontVariant: ['tabular-nums'],
    },

    secondaryDev: {
      marginTop: space.sm,
      height: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border,
    },
    secondaryDevLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    destructive: {
      marginTop: space.sm,
      height: HIT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.danger,
    },
    destructiveLabel: {
      color: color.danger,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    creditSource: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    creditBody: {
      color: color.textMuted,
      fontSize: type.label,
      lineHeight: 18,
      marginTop: 2,
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

    accentLabel: { marginTop: space.md, marginBottom: space.xs },

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
    presetRow: {
    flexDirection: 'row',
    gap: space.xs,
    marginBottom: space.sm,
  },
  preset: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceRaised,
    alignItems: 'center',
  },
  presetOn: { backgroundColor: color.accent, borderColor: color.accent },
  /** Distance is meaningless with the scatter off, and says so by fading. */
  presetMuted: { opacity: 0.4 },
  presetLabel: { color: color.textMuted, fontSize: type.label },
  presetLabelOn: { color: color.onAccent, fontWeight: weight.bold },

  logHeading: {
    color: color.textMuted,
    fontSize: type.label,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: space.md,
    marginBottom: space.xs,
  },
  /*
   * Horizontally scrollable and never wrapped.
   *
   * Log lines are long and wrapping them turns a readable sequence into a
   * wall. Selectable so a line can be copied out and pasted somewhere useful,
   * which is the only way anything here leaves the phone.
   */
  logBox: {
    maxHeight: 260,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.sm,
  },
  logText: { color: color.text, fontSize: 11, fontFamily: 'Menlo' },

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
