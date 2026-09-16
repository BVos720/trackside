import { Text } from '../Typography';
/**
 * Circuit picker — a full list, not a dropdown.
 *
 * A dropdown hides the options behind a tap and shows one line of the answer.
 * Choosing a venue is a deliberate act that changes every other screen, so it
 * gets the whole page: all five visible at once, with enough on each row to
 * tell them apart before committing.
 */
import { useMemo } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VENUE_VIEW, circuitMetricsFor, type VenueKey } from '../map/style';
import PageHeader from '../PageHeader';
import Collapsible from '../Collapsible';
import {
  downloadTerrain,
  terrainStatus,
  type TerrainStatus,
} from '../../storage-local/terrainCache';
import {
  MENU_CLEARANCE,
  radius,
  space,
  type,
  useTheme,
  weight,
  type Theme,
} from '../theme';

const VENUES = Object.keys(VENUE_VIEW) as VenueKey[];

const COUNTRY_NAME: Record<string, string> = {
  DE: 'Germany',
  BE: 'Belgium',
  NL: 'Netherlands',
  FR: 'France',
  JP: 'Japan',
};

export default function CircuitScreen({
  venue,
  onChange,
}: {
  venue: VenueKey;
  onChange: (v: VenueKey) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <PageHeader eyebrow="Find your next perspective" title="See you at the circuit." description="From familiar corners to a new favourite. Choose a venue to explore your spots and plan your day." />

      {VENUES.map((key, index) => {
        const v = VENUE_VIEW[key];
        const m = circuitMetricsFor(key);
        const active = key === venue;

        return (
          <View key={key} style={styles.venueCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.row,
              active && styles.rowActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.venueNumber}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.rowText}>
              <Text style={styles.country}>{COUNTRY_NAME[v.country] ?? v.country}</Text>
              <Text style={styles.rowTitle}>{v.label}</Text>
              <Text style={styles.rowSub}>
                {m
                  ? `${(m.surfaceMetres / 1000).toFixed(1)} km mapped surface · ${(
                      m.widthMetres / 1000
                    ).toFixed(1)} × ${(m.heightMetres / 1000).toFixed(1)} km site`
                  : ''}
              </Text>
            </View>
            <Text style={styles.tick}>{active ? '✓' : '↗'}</Text>
          </Pressable>
          </View>
        );
      })}

      <Collapsible title="Offline relief maps" hint="Download terrain shading for your next visit">
        {VENUES.map(key => <View key={key} style={{ marginBottom: 16 }}><Text style={styles.country}>{VENUE_VIEW[key].label}</Text><TerrainRow venue={key} bounds={VENUE_VIEW[key].bounds} styles={styles} /></View>)}
      </Collapsible>
      <Text style={styles.help}>
        Le Mans currently has partial circuit coverage. Distances show mapped surfaces, including pit lanes and layout variants.
      </Text>
    </ScrollView>
  );
}

/**
 * Download state for one venue's elevation tiles.
 *
 * ── What this actually buys you ───────────────────────────────────────────
 * Relief *shading*, offline. Not a 3D landscape: maplibre-react-native has no
 * terrain-mesh support at all — no handling of a 'terrain' style key in either
 * native bridge, and the only mention of the word in its style types is a
 * hillshade paint property. The tilted view on the phone is camera pitch,
 * extruded buildings and this shading, and it is worth being plain about that
 * rather than letting a button labelled '3D terrain' imply hills that a
 * phone cannot draw today.
 *
 * Not forever, though: a terrain mesh is in active development for MapLibre
 * Native upstream. When it ships, and once the React Native binding exposes
 * it, these same tiles are what it will read — which is the reason to keep
 * downloading them under a name that is true now rather than one that is only
 * true later.
 *
 * ── Why this is on the circuit list ───────────────────────────────────────
 * This is the screen where you decide which circuit you are going to, which is
 * the moment you still have a connection and the last one where downloading is
 * free of consequence. Burying it in settings would mean finding out in the
 * Eifel that the hills are flat.
 *
 * ── Why it says how many tiles ────────────────────────────────────────────
 * A spinner with no end is indistinguishable from a hang, and this is a few
 * dozen small requests — genuinely finite, so it is shown as finite. A run that
 * stops halfway leaves what it got and says so; pressing again resumes rather
 * than restarting, because every tile already on disk is skipped.
 */
function TerrainRow({
  venue,
  bounds,
  styles,
}: {
  venue: VenueKey;
  bounds: (typeof VENUE_VIEW)[VenueKey]['bounds'];
  styles: ReturnType<typeof makeStyles>;
}) {
  const [status, setStatus] = useState<TerrainStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => setStatus(await terrainStatus(venue, bounds)))();
  }, [venue, bounds]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await downloadTerrain(venue, bounds, (have, need) =>
        setStatus({ have, need, complete: have === need }),
      );
      setStatus(result);
    } finally {
      setBusy(false);
    }
  };

  // Nothing to offer until the count is known, and nothing to offer on web —
  // terrainStatus reports need: 0 there. See terrainCache.web.ts.
  if (status === null || status.need === 0) return null;

  if (status.complete && !busy) {
    return (
      <Text style={styles.terrainDone}>
        Relief data saved · shading works with no signal
      </Text>
    );
  }

  return (
    <Pressable
      onPress={() => void run()}
      style={({ pressed }) => [styles.terrainBtn, pressed && styles.pressed]}
    >
      <Text style={styles.terrainLabel}>
        {busy
          ? `Downloading relief data… ${status.have}/${status.need}`
          : status.have > 0
            ? `Resume relief data (${status.have}/${status.need})`
            : `Download relief data (${status.need} tiles)`}
      </Text>
    </Pressable>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    content: { padding: space.lg, paddingBottom: 64, width: '100%', maxWidth: 760, alignSelf: 'center' },
    venueCard: { marginBottom: 12 },
    venueNumber: { fontSize: 13, color: color.textFaint, marginRight: 18, fontVariant: ['tabular-nums'] },
    country: { color: color.textMuted, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
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
      marginBottom: space.md,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // Gloves are the normal operating condition (§5.14).
      minHeight: 112,
      paddingVertical: 20,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      marginBottom: space.sm,
      borderWidth: 1,
      borderColor: color.border,
    },
    rowActive: { borderColor: color.accent },
    rowText: { flex: 1 },
    terrainBtn: {
      marginTop: -space.xs,
      marginBottom: space.sm,
      marginHorizontal: space.sm,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      backgroundColor: color.surface,
      alignItems: 'center',
    },
    terrainLabel: { color: color.accent, fontSize: type.label, fontWeight: weight.bold },
    terrainDone: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: -space.xs,
      marginBottom: space.sm,
      marginHorizontal: space.md,
    },
    rowTitle: { color: color.text, fontSize: 27, fontWeight: weight.bold },
    rowSub: { color: color.textMuted, fontSize: 11, lineHeight: 17, marginTop: 6 },
    tick: { color: color.accent, fontSize: 18, fontWeight: weight.bold },

    help: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.md,
      lineHeight: 17,
    },
  });
}
