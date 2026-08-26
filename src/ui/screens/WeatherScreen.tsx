/**
 * Weather — the hourly forecast for the days you'll be at the circuit.
 *
 * Renders `ForecastDisplay`'s five states distinctly (see
 * `core/logic/forecast.ts`), because a stale forecast shown as current is
 * worse than showing nothing: the age is part of the read, not a caption
 * under it, so it sits right at the top of the stale/fresh states and is
 * never the same colour for both.
 *
 * ── Why a chart and not a list of hours ────────────────────────────────────
 * The list this replaced printed "68% cloud / 0.0mm rain" once per hour, and
 * reading a day off it meant reading twenty-four rows and holding them in
 * your head. What a photographer actually asks a forecast is shaped like a
 * picture — *when does it clear up*, *does the rain land on the afternoon
 * session* — so the hours are drawn as one column each and the answer is the
 * shape of the run. The numbers are still there, in the day's summary line
 * and the clearest-window line, which is where a number is worth reading.
 *
 * Everything decided rather than drawn — which day, what the sky is doing,
 * where the clearest stretch is — lives in `core/logic/forecast.ts` and is
 * tested there. This file only lays it out.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  groupForecastByDay,
  summariseDay,
  type DaySummary,
  type ForecastDisplay,
  type HourlyForecastPoint,
} from '../../core/logic/forecast';
import WeatherGlyph, { cloudColor, conditionLabel } from '../WeatherGlyph';
import { radius, space, type, useTheme, weight, type Theme } from '../theme';

/** How tall the cloud-cover columns are drawn. */
const CHART_HEIGHT = 92;
/** The rain strip under it, which only appears on a day with rain in it. */
const RAIN_HEIGHT = 22;

/** `'2026-08-21T14:00'` to `14`. */
function hourOf(time: string): number | null {
  const m = /T(\d{2}):/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  return Number.isInteger(hour) ? hour : null;
}

/** `'2026-08-21'` to `'Fri 21'`. */
function formatDayTab(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = parsed.toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${parsed.getDate()}`;
}

function formatAge(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function pad(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * The current hour, but only when `date` is actually today — the marker is
 * there to say "you are here", and drawing it on tomorrow's column would say
 * something false.
 */
function nowHourFor(date: string): number | null {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getDate()).padStart(2, '0')}`;
  return date === today ? now.getHours() : null;
}

/**
 * One day's summary in a sentence: what the sky is doing, and the two numbers
 * behind it. Rain is only mentioned on a day that has any — a permanent
 * "0.0mm rain" is noise rather than honesty, the same call `describeBundle`
 * makes about empty collections.
 */
function summaryLine(summary: DaySummary): string {
  const cloud =
    summary.meanCloudPercent === null
      ? 'cloud not reported'
      : `avg ${Math.round(summary.meanCloudPercent)}% cloud`;
  const rain =
    summary.rainHours > 0
      ? `${summary.totalRainMm.toFixed(1)}mm over ${summary.rainHours}h`
      : 'dry';
  return `${cloud} · ${rain}`;
}

/**
 * The cloud-cover columns.
 *
 * An hour the forecast did not report is drawn as a stub in the "undocumented"
 * grey rather than as a zero — a gap in the data is not a clear sky (§0.2),
 * and a full-height bar would be a worse lie in the other direction.
 */
function CloudChart({
  points,
  nowHour,
}: {
  points: readonly HourlyForecastPoint[];
  nowHour: number | null;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.chart}>
      {points.map((point) => {
        const cloud = point.cloudCoverPercent;
        const hour = hourOf(point.time);
        const isNow = hour !== null && hour === nowHour;
        return (
          <View key={point.time} style={styles.column}>
            <View style={styles.columnTrack}>
              <View
                style={[
                  styles.columnFill,
                  cloud === null
                    ? styles.columnMissing
                    : {
                        height: `${Math.max(3, cloud)}%`,
                        backgroundColor: cloudColor(cloud, color),
                      },
                ]}
              />
            </View>
            {isNow && <View style={styles.nowMark} />}
          </View>
        );
      })}
    </View>
  );
}

/** Rain, scaled against the wettest hour of the day it belongs to. */
function RainStrip({ points }: { points: readonly HourlyForecastPoint[] }) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const peak = Math.max(
    ...points.map((p) => p.precipitationMm ?? 0),
    // Never divide by zero, and keep a drizzle from filling the strip: a
    // 0.1mm hour drawn full height would read as a downpour.
    1,
  );
  return (
    <View style={styles.rainStrip}>
      {points.map((point) => {
        const mm = point.precipitationMm ?? 0;
        return (
          <View key={point.time} style={styles.column}>
            <View style={styles.columnTrack}>
              {mm > 0 && (
                <View
                  style={[
                    styles.rainFill,
                    { height: `${Math.max(12, (mm / peak) * 100)}%` },
                  ]}
                />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Hour ticks under the chart — every third hour, so 24 of them still fit. */
function HourAxis({ points }: { points: readonly HourlyForecastPoint[] }) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.axis}>
      {points.map((point) => {
        const hour = hourOf(point.time);
        const show = hour !== null && hour % 3 === 0;
        return (
          <View key={point.time} style={styles.axisCell}>
            {show && (
              <Text style={styles.axisLabel}>
                {String(hour).padStart(2, '0')}
              </Text>
            )}
          </View>
        );
      })}
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
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

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
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const usable = display.state === 'fresh' || display.state === 'stale';
  // Tabs cover the whole forecast, not just the event — see `allHourly` in
  // `core/logic/forecast.ts` for why both series exist.
  const allHourly = usable ? display.allHourly : null;
  const eventDays = usable ? display.eventDays : [];
  const days = useMemo(
    () => (allHourly ? groupForecastByDay(allHourly) : []),
    [allHourly],
  );

  /**
   * `null` until the reader picks a day, so the default can follow the data.
   *
   * Opening on the event's first day rather than on today is the whole point
   * of the panel — you are here to look at the weekend. Storing the *date*
   * rather than an index means a refresh that shifts the window (the forecast
   * rolls forward a day) keeps you on the day you were reading.
   */
  const [picked, setPicked] = useState<string | null>(null);
  const defaultDate = eventDays[0] ?? days[0]?.date ?? null;
  const activeDate = picked ?? defaultDate;
  const dayIndex = Math.max(
    0,
    days.findIndex((d) => d.date === activeDate),
  );
  const day = days[dayIndex] ?? null;
  const summary = useMemo(() => (day ? summariseDay(day.points) : null), [day]);

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
        <Text style={styles.help}>
          {refreshing
            ? 'Fetching a forecast for this event…'
            : 'No forecast for this event yet.'}
        </Text>
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </View>
    );
  }

  // 'stale' or 'fresh' — usable either way, but never shown the same.
  const stale = display.state === 'stale';

  return (
    <View>
      <View style={styles.header}>
        <WeatherGlyph condition={summary?.condition ?? 'cloudy'} size={44} />
        <View style={styles.headerText}>
          <Text style={styles.condition}>
            {summary ? conditionLabel(summary.condition) : '—'}
          </Text>
          {summary !== null && (
            <Text style={styles.summary}>{summaryLine(summary)}</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <View
            style={[styles.pill, stale ? styles.pillStale : styles.pillFresh]}
          >
            <Text style={[styles.pillText, stale && styles.pillTextStale]}>
              {stale ? 'Stale' : 'Fresh'}
            </Text>
          </View>
          <Text style={styles.age}>{formatAge(display.ageMinutes)}</Text>
        </View>
      </View>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {days.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {days.map((d, i) => {
            const active = i === dayIndex;
            // The event's own days are marked, because the tab strip runs
            // sixteen days and "which of these is the race weekend" stops
            // being obvious somewhere around the fourth.
            const isEventDay = eventDays.includes(d.date);
            return (
              <Pressable
                key={d.date}
                onPress={() => setPicked(d.date)}
                style={({ pressed }) => [
                  styles.tab,
                  isEventDay && styles.tabEvent,
                  active && styles.tabActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    isEventDay && styles.tabLabelEvent,
                    active && styles.tabLabelActive,
                  ]}
                >
                  {formatDayTab(d.date)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {day !== null && summary !== null && (
        <View style={styles.chartBlock}>
          <View style={styles.scaleRow}>
            <Text style={styles.scaleLabel}>cloud cover</Text>
            <Text style={styles.scaleLabel}>100%</Text>
          </View>
          <CloudChart points={day.points} nowHour={nowHourFor(day.date)} />
          <HourAxis points={day.points} />
          {summary.rainHours > 0 && (
            <>
              <Text style={styles.scaleLabel}>rain</Text>
              <RainStrip points={day.points} />
            </>
          )}
          {summary.clearestWindow !== null && (
            <View style={styles.clearestRow}>
              <WeatherGlyph condition="clear" size={18} />
              <Text style={styles.clearest}>
                Clearest {pad(summary.clearestWindow.fromHour)}–
                {pad(summary.clearestWindow.toHour)} ·{' '}
                {Math.round(summary.clearestWindow.meanCloudPercent)}% cloud
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.footer}>
        <RefreshButton
          onRefresh={onRefresh}
          refreshing={refreshing}
          label="Refresh"
        />
      </View>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    pressed: { opacity: 0.7 },
    help: { color: color.textMuted, fontSize: type.label, lineHeight: 17 },
    error: {
      color: color.danger,
      fontSize: type.label,
      lineHeight: 17,
      marginTop: space.sm,
    },

    header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    headerText: { flex: 1 },
    condition: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
    summary: { color: color.textMuted, fontSize: type.label, marginTop: 2 },
    headerRight: { alignItems: 'flex-end', gap: 3 },

    /**
     * "Fresh" and "Stale" are never the same colour — accent for one, danger
     * for the other — so the two states cannot be told apart only by reading
     * the word carefully. See the file header.
     */
    pill: {
      paddingHorizontal: space.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    pillFresh: { backgroundColor: color.accent },
    pillStale: { backgroundColor: color.danger },
    pillText: { color: color.onAccent, fontSize: 11, fontWeight: weight.bold },
    pillTextStale: { color: color.text },
    age: { color: color.textFaint, fontSize: 11 },

    tabs: { gap: space.xs, paddingVertical: space.sm },
    tab: {
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    /** An event day that is not the selected one: outlined, not filled. */
    tabEvent: { borderWidth: 1, borderColor: color.accent },
    tabActive: { backgroundColor: color.accent, borderColor: color.accent },
    tabLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    tabLabelEvent: { color: color.text },
    tabLabelActive: { color: color.onAccent },

    chartBlock: { marginTop: space.sm },
    scaleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    scaleLabel: { color: color.textFaint, fontSize: 11, marginTop: space.xs },

    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: CHART_HEIGHT,
      gap: 1,
      marginTop: 4,
    },
    column: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    columnTrack: {
      height: '100%',
      justifyContent: 'flex-end',
      backgroundColor: color.surface,
      borderRadius: 2,
      overflow: 'hidden',
    },
    columnFill: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
    /** A gap in the data, drawn as a gap rather than as a zero. */
    columnMissing: { height: 3, backgroundColor: color.undocumented },
    /** Where "now" falls, on today's day only. */
    nowMark: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -3,
      height: 2,
      borderRadius: 2,
      backgroundColor: color.text,
    },

    rainStrip: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: RAIN_HEIGHT,
      gap: 1,
      marginTop: 4,
    },
    rainFill: { width: '100%', borderRadius: 2, backgroundColor: color.accent },

    axis: { flexDirection: 'row', gap: 1, marginTop: 2 },
    /**
     * The axis cannot reuse `column`.
     *
     * `column` is `height: '100%'`, which is meaningful inside the fixed-height
     * chart and meaningless here, where the row's own height comes from its
     * content. An unresolvable percentage left several hundred points of dead
     * space hanging under the panel.
     */
    axisCell: { flex: 1 },
    axisLabel: {
      color: color.textFaint,
      fontSize: 10,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },

    clearestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: space.sm,
    },
    clearest: { color: color.textMuted, fontSize: type.label, flex: 1 },

    footer: { marginTop: space.sm, alignItems: 'flex-start' },

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
  });
}
