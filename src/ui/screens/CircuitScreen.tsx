/**
 * Circuit picker — a full list, not a dropdown.
 *
 * A dropdown hides the options behind a tap and shows one line of the answer.
 * Choosing a venue is a deliberate act that changes every other screen, so it
 * gets the whole page: all five visible at once, with enough on each row to
 * tell them apart before committing.
 */
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VENUE_VIEW, circuitMetricsFor, type VenueKey } from '../map/style';
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
      <Text style={styles.kicker}>CIRCUIT</Text>
      <Text style={styles.title}>Where are you shooting?</Text>

      {VENUES.map((key) => {
        const v = VENUE_VIEW[key];
        const m = circuitMetricsFor(key);
        const active = key === venue;

        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.row,
              active && styles.rowActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{v.label}</Text>
              <Text style={styles.rowSub}>
                {COUNTRY_NAME[v.country] ?? v.country}
                {m
                  ? ` · ${(m.surfaceMetres / 1000).toFixed(1)} km surface · ${(
                      m.widthMetres / 1000
                    ).toFixed(1)} × ${(m.heightMetres / 1000).toFixed(1)} km site`
                  : ''}
              </Text>
            </View>
            {active && <Text style={styles.tick}>✓</Text>}
          </Pressable>
        );
      })}

      {/* Honest about the one that is not finished — see the WIP label. */}
      <Text style={styles.help}>
        Le Mans is partial: the Mulsanne runs on public road, and which ways
        make up the lap is a call for you, not the extractor.
      </Text>
    </ScrollView>
  );
}

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
      marginBottom: space.md,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // Gloves are the normal operating condition (§5.14).
      minHeight: 64,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      marginBottom: space.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    rowActive: { borderColor: color.accent },
    rowText: { flex: 1 },
    rowTitle: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
    rowSub: { color: color.textMuted, fontSize: type.label, marginTop: 2 },
    tick: { color: color.accent, fontSize: 18, fontWeight: weight.bold },

    help: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.md,
      lineHeight: 17,
    },
  });
}
