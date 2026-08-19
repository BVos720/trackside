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
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type, weight } from '../theme';
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
  const m = circuitMetricsFor(venue);
  if (!m) return null;

  // Longest side drives the bar, so the two bars are readable relative to each
  // other rather than each filling the width.
  const longest = Math.max(m.widthMetres, m.heightMetres, 1);

  return (
    <View
      style={[styles.root, top === undefined ? null : { top }]}
      pointerEvents="none"
    >
      <Text style={styles.title}>SITE</Text>

      <Bar label="W" metres={m.widthMetres} fraction={m.widthMetres / longest} />
      <Bar label="H" metres={m.heightMetres} fraction={m.heightMetres / longest} />

      <View style={styles.divider} />
      <Text style={styles.surfaceLabel}>SURFACE</Text>
      <Text style={styles.surfaceValue}>{distance(m.surfaceMetres)}</Text>
      {/* Not lap distance — see the note at the top of this file. */}
      <Text style={styles.surfaceHint}>incl. pit lane &amp; variants</Text>
    </View>
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

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: space.md,
    // Web default; native passes a safe-area offset. The 2D/3D toggle moved
    // to the left edge, so nothing competes for this corner any more.
    top: space.md,
    width: 148,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,13,16,0.86)',
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
