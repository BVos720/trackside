/**
 * Date range picker — a calendar, built from React Native primitives.
 *
 * Race weekends span days ("10–11 October"), so the unit here is a range, not a
 * date. Tap a day to set the start, tap another to close the range; tapping
 * before the start begins a new one.
 *
 * ── Why not a picker library ───────────────────────────────────────────────
 * `@react-native-community/datetimepicker` is a native module. Adding one means
 * every existing development build stops working until it is rebuilt, and its
 * web support is a separate implementation that behaves differently from the
 * native one. A calendar is a grid of buttons; it is not worth a native
 * dependency, a rebuild, and two divergent behaviours to avoid writing it.
 *
 * ── Dates are local, and stay strings ──────────────────────────────────────
 * Values are `YYYY-MM-DD` in the user's own calendar, built from local Y/M/D
 * rather than from `toISOString()`. `toISOString()` converts to UTC first, so
 * for anyone east of Greenwich a date picked near midnight comes back as the
 * previous day. A circuit weekend is a local-calendar fact — 11 October at Spa
 * is 11 October regardless of what the phone thinks the offset is.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, type, useTheme, weight, type Theme } from './theme';

/** Monday-first: the European week, and race weekends read Fri–Sun. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Local `YYYY-MM-DD`. Never `toISOString()` — see the note above. */
export function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` as local midnight, not UTC midnight. */
export function fromIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Human range: "11 October 2026", "10–11 October 2026", "30 Oct – 2 Nov 2026".
 *
 * Repeated parts are dropped, so the common case reads the way someone would
 * say it out loud rather than printing the month and year twice.
 */
export function formatDateRange(
  startIso: string | null,
  endIso: string | null,
): string | null {
  const start = startIso ? fromIsoDate(startIso) : null;
  if (!start) return null;
  const end = endIso ? fromIsoDate(endIso) : null;

  const month = (d: Date) => MONTHS[d.getMonth()]!;
  const short = (d: Date) => month(d).slice(0, 3);

  if (!end || toIsoDate(end) === toIsoDate(start)) {
    return `${start.getDate()} ${month(start)} ${start.getFullYear()}`;
  }
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()} ${short(start)} ${start.getFullYear()} – ${end.getDate()} ${short(end)} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()} ${short(start)} – ${end.getDate()} ${short(end)} ${end.getFullYear()}`;
  }
  return `${start.getDate()}–${end.getDate()} ${month(start)} ${start.getFullYear()}`;
}

/** Days in the grid for a month, padded to whole Monday-first weeks. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is index 0.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string | null;
  endDate: string | null;
  onChange: (start: string | null, end: string | null) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  // Open on the month already chosen, so editing a range does not drop the user
  // back at today and make them navigate to where they already were.
  const initial = useMemo(() => {
    const d = startDate ? fromIsoDate(startDate) : null;
    return d ?? new Date();
  }, [startDate]);

  const [cursor, setCursor] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );

  const cells = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const todayIso = toIsoDate(new Date());

  const tap = (d: Date) => {
    const iso = toIsoDate(d);
    // Nothing set, or a range already closed → begin a new one.
    if (!startDate || (startDate && endDate)) {
      onChange(iso, null);
      return;
    }
    // A start with no end: a day before the start restarts, rather than
    // producing a backwards range.
    if (iso < startDate) onChange(iso, null);
    else onChange(startDate, iso);
  };

  const shift = (months: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, 1));

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => shift(-1)}
          hitSlop={10}
          style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
        >
          <Text style={styles.navLabel}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </Text>
        <Pressable
          onPress={() => shift(1)}
          hitSlop={10}
          style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
        >
          <Text style={styles.navLabel}>›</Text>
        </Pressable>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={styles.cell} />;

          const iso = toIsoDate(d);
          const isStart = iso === startDate;
          const isEnd = iso === endDate;
          const between =
            startDate !== null &&
            endDate !== null &&
            iso > startDate &&
            iso < endDate;

          return (
            <Pressable
              key={i}
              onPress={() => tap(d)}
              style={({ pressed }) => [
                styles.cell,
                between && styles.cellBetween,
                (isStart || isEnd) && styles.cellEnd,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.day,
                  (isStart || isEnd) && styles.dayEnd,
                  iso === todayIso && !isStart && !isEnd && styles.dayToday,
                ]}
              >
                {d.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.summary}>
          {formatDateRange(startDate, endDate) ??
            'Tap a day. Tap a second one for a range.'}
        </Text>
        {startDate && (
          <Pressable
            onPress={() => onChange(null, null)}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    pressed: { opacity: 0.6 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.xs,
    },
    nav: {
      width: 40,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: color.surface,
    },
    navLabel: { color: color.text, fontSize: 20, fontWeight: weight.bold },
    monthLabel: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },

    week: { flexDirection: 'row' },
    weekday: {
      flex: 1,
      textAlign: 'center',
      color: color.textFaint,
      fontSize: 10,
      fontWeight: weight.bold,
      marginBottom: 2,
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: {
      // Seven to a row, sized by fraction so the grid fits any width.
      width: `${100 / 7}%`,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellBetween: { backgroundColor: 'rgba(45,124,255,0.18)' },
    cellEnd: { backgroundColor: color.accent, borderRadius: radius.sm },

    day: { color: color.text, fontSize: type.label },
    dayEnd: { color: color.onAccent, fontWeight: weight.bold },
    dayToday: { color: color.accent, fontWeight: weight.bold },

    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.sm,
    },
    summary: { color: color.textMuted, fontSize: type.label, flexShrink: 1 },
    clear: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      paddingLeft: space.sm,
    },
  });
}
