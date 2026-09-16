import { Text } from '../Typography';
/**
 * Circuit measurements, shown beside the map.
 *
 * Answers the question that decides whether you walk or drive: how big is this
 * place. The site dimensions matter more day-to-day than lap distance — a 6km
 * wide venue means a 20-minute walk between two corners that look adjacent on
 * screen.
 *
 * ── On "surface" ───────────────────────────────────────────────────────────
 * This is every extracted way summed, so pit lanes, service loops and layout
 * variants each count once. It is deliberately not labelled "lap", because it
 * is not: the Nordschleife reads 29.19km against a 20.832km lap, since the
 * extract includes the GP-Strecke. Presenting it as lap distance would be a
 * confident wrong number, which is worse than an honest approximate one.
 *
 * It earns its place as a sanity check. Le Mans reading 2.60 x 3.89km is what
 * revealed the Mulsanne straight was missing from the geometry.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { radius, space, type, useTheme, weight, type Theme } from '../theme';
import { circuitMetricsFor, type VenueKey } from './style';

/** Metres to a short human string: 940 m, 4.26 km. */
function distance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(2)} km`;
}

export default function CircuitRuler({
  venue,
  /** Distance from the top of the screen, already clear of the status bar. */
  top,
}: {
  venue: VenueKey;
  top?: number;
}) {
  const [open, setOpen] = useState(false);
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const m = circuitMetricsFor(venue);
  if (!m) return null;

  // Longest side drives the bar, so the two bars are readable relative to each
  // other rather than each filling the width.
  const longest = Math.max(m.widthMetres, m.heightMetres, 1);

  return (
    <>
    <Pressable accessibilityRole="button" accessibilityLabel="Circuit measurements" onPress={() => setOpen(true)} style={[styles.infoButton, { top: top ?? 84 }]}><Text style={styles.infoLabel}>Circuit info ↗</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
    <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <View
      style={[styles.root, { position: 'relative', top: 0, right: 0, width: '100%', maxWidth: 360, padding: 24 }]}
    >
      <Text style={styles.title}>SITE</Text>

      <Bar label="W" metres={m.widthMetres} fraction={m.widthMetres / longest} />
      <Bar label="H" metres={m.heightMetres} fraction={m.heightMetres / longest} />

      <View style={styles.divider} />
      <Text style={styles.surfaceLabel}>SURFACE</Text>
      <Text style={styles.surfaceValue}>{distance(m.surfaceMetres)}</Text>
      {/* Not lap distance — see the note at the top of this file. */}
      <Text style={styles.surfaceHint}>incl. pit lane &amp; variants</Text>
      <Text style={[styles.infoLabel, { marginTop: 24, textAlign: 'center' }]}>Tap to close</Text>
    </View>
    </Pressable>
    </Modal>
    </>
  );
}

function Bar({
  label,
  metres,
  fraction,
}: {
  label: string;
  metres: number;
  fraction: number;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(6, Math.min(100, fraction * 100))}%` },
          ]}
        />
      </View>
      <Text style={styles.rowValue}>{distance(metres)}</Text>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    infoButton: { position: 'absolute', right: 16, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
    infoLabel: { color: color.text, fontSize: 12, fontWeight: '700' },
    root: {
      position: 'absolute',
      right: space.md,
      // Web default; native passes a safe-area offset. The 2D/3D toggle moved
      // to the left edge, so nothing competes for this corner any more.
      top: space.md,
      width: 148,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    title: {
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
    rowLabel: {
      color: color.textFaint,
      fontSize: 10,
      width: 12,
      fontWeight: weight.bold,
    },
    track: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.surfaceRaised,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: color.accent, borderRadius: 2 },
    rowValue: {
      color: color.text,
      fontSize: 10,
      fontWeight: weight.bold,
      marginLeft: space.xs,
      width: 46,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },

    divider: {
      height: 1,
      backgroundColor: color.border,
      marginTop: space.sm,
      marginBottom: space.xs,
    },
    surfaceLabel: {
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
    },
    surfaceValue: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },
    surfaceHint: { color: color.textFaint, fontSize: 9, marginTop: 1 },
  });
}
