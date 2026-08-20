/**
 * Weather — the hourly forecast for the days you'll be at the circuit.
 *
 * Renders `ForecastDisplay`'s five states distinctly (see
 * `core/logic/forecast.ts`), because a stale forecast shown as current is
 * worse than showing nothing: the age is part of the read, not a caption
 * under it, so it sits right at the top of the stale/fresh states and is
 * never the same colour for both.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ForecastDisplay, HourlyForecastPoint } from '../../core/logic/forecast';
import { color, radius, space, type, weight } from '../theme';

/** `'2026-08-21T14:00'` → `'14:00'`. */
function formatClock(time: string): string {
  const m = /T(\d{2}:\d{2})/.exec(time);
  return m ? m[1]! : time;
}

function formatAge(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function HourlyList({ hourly }: { hourly: readonly HourlyForecastPoint[] }) {
  return (
    <View style={styles.hourlyList}>
      {hourly.map((point) => (
        <View key={point.time} style={styles.hourRow}>
          <Text style={styles.hourTime}>{formatClock(point.time)}</Text>
          <Text style={styles.hourValue}>
            {point.cloudCoverPercent === null
              ? '—'
              : `${Math.round(point.cloudCoverPercent)}% cloud`}
          </Text>
          <Text style={styles.hourValue}>
            {point.precipitationMm === null
              ? '—'
              : `${point.precipitationMm.toFixed(1)}mm rain`}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RefreshButton({
  onRefresh,
  refreshing,
  label = 'Fetch forecast',
}: {
  onRefresh: () => void;
  refreshing: boolean;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onRefresh}
      disabled={refreshing}
      style={({ pressed }) => [
        styles.btn,
        refreshing && styles.btnDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.btnLabel}>{refreshing ? 'Fetching…' : label}</Text>
    </Pressable>
  );
}

export default function WeatherScreen({
  display,
  onRefresh,
  refreshing = false,
  error = null,
}: {
  display: ForecastDisplay;
  onRefresh: () => void;
  refreshing?: boolean;
  error?: string | null;
}) {
  if (display.state === 'no-dates') {
    return (
      <Text style={styles.help}>
        Set the event's dates to get a forecast for it.
      </Text>
    );
  }

  if (display.state === 'too-far-out') {
    return (
      <Text style={styles.help}>
        Too far out to forecast yet — check back in{' '}
        {display.daysUntilForecastable} day
        {display.daysUntilForecastable === 1 ? '' : 's'}.
      </Text>
    );
  }

  if (display.state === 'no-data-yet') {
    return (
      <View>
        <Text style={styles.help}>No forecast fetched yet for this event.</Text>
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </View>
    );
  }

  // 'stale' or 'fresh' — usable either way, but never shown the same.
  const stale = display.state === 'stale';
  return (
    <View>
      <View style={styles.ageRow}>
        <Text style={[styles.age, stale && styles.ageStale]}>
          {stale ? 'Stale — ' : 'Fresh — '}
          {formatAge(display.ageMinutes)}
        </Text>
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} label="Refresh" />
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <HourlyList hourly={display.hourly} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  help: { color: color.textMuted, fontSize: type.label, lineHeight: 17 },
  error: {
    color: color.danger,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.sm,
  },

  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /**
   * "Fresh" and "Stale" are never the same colour — accent for one, danger
   * for the other — so the two states cannot be told apart only by reading
   * the word carefully. See the file header.
   */
  age: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  ageStale: { color: color.danger },

  btn: {
    height: 40,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  btnDisabled: { opacity: 0.6 },
  btnLabel: { color: color.text, fontSize: type.label, fontWeight: weight.bold },

  hourlyList: { marginTop: space.sm },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingVertical: space.xs,
  },
  hourTime: {
    color: color.text,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    width: 48,
  },
  hourValue: { color: color.textMuted, fontSize: type.label, flex: 1 },
});
