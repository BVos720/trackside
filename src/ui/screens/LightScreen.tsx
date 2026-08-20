/**
 * Light at a spot — the §5.2 differentiator, made visible.
 *
 * Generic sun tools draw a compass overlay and leave the photographer to work
 * out what it means. This screen answers the question directly, because the
 * data model knows which way the camera points: at this time, from this
 * position, on this bearing — is the sun in my frame?
 *
 * Everything here is computed offline. No API, no key, no network.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HIT_SIZE,
  MENU_CLEARANCE,
  color,
  lightQualityColor,
  radius,
  space,
  type,
  weight,
} from '../theme';
import { compassPoint } from '../../core/logic/geo';
import {
  HORIZON_CAVEAT,
  LightDirection,
  type SpotLight,
  sampleLight,
  solarDay,
  spotLight,
} from '../../core/logic/sun';

/**
 * Test position, not seed data.
 *
 * A rough Nürburgring centroid, used so the screen has something to compute
 * against before any spot exists. Spec §0.2 reserves real circuit and marshal-
 * post coordinates for human sourcing from official documents, so this is
 * labelled in the UI as approximate and is never written to the database.
 */
const TEST_POSITION = { latitude: 50.3356, longitude: 6.9475 };

const SAMPLE_STEP_MINUTES = 15;
const MINUTES_PER_DAY = 24 * 60;

/** Local wall-clock midnight for the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Clamp to a valid minute of the day, treating non-finite input as midnight.
 *
 * `minuteOfDay` drives every computed value on this screen, so a single NaN
 * reaching it renders the entire view as "NaN". Clamping here means no caller
 * can poison that state regardless of what an event handler hands over.
 */
function clampMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(value)));
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const DIRECTION_LABEL: Record<LightDirection, string> = {
  [LightDirection.Backlit]: 'BACKLIT',
  [LightDirection.FrontLit]: 'FRONT-LIT',
  [LightDirection.SideLit]: 'SIDE-LIT',
};

const DIRECTION_BLURB: Record<LightDirection, string> = {
  [LightDirection.Backlit]: 'Sun in frame. Flare, rim light, silhouettes.',
  [LightDirection.FrontLit]: 'Sun behind you. Subject evenly lit, flat.',
  [LightDirection.SideLit]: 'Raking light across the subject.',
};

export default function LightScreen() {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [minuteOfDay, setMinuteOfDay] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [bearing, setBearing] = useState(90);

  /**
   * The strip's position in window coordinates.
   *
   * `onLayout` alone is not enough: it reports position relative to the parent,
   * while a touch reports `pageX` relative to the window. Measuring in window
   * coordinates puts both in the same frame of reference.
   *
   * The earlier implementation used `nativeEvent.locationX`, which is typed as
   * a number but is not reliably delivered by react-native-web — the handler
   * silently never fired, so the control did nothing at all on web.
   */
  const stripRef = useRef<View | null>(null);
  const [stripRect, setStripRect] = useState({ x: 0, width: 0 });

  const measureStrip = useCallback(() => {
    stripRef.current?.measureInWindow((x, _y, width) => {
      if (Number.isFinite(x) && Number.isFinite(width) && width > 0) {
        setStripRect({ x, width });
      }
    });
  }, []);

  const at = useMemo(() => {
    const d = new Date(date);
    d.setMinutes(minuteOfDay);
    return d;
  }, [date, minuteOfDay]);

  const light = useMemo(
    () => spotLight(at, TEST_POSITION, bearing),
    [at, bearing],
  );

  const day = useMemo(() => solarDay(date, TEST_POSITION), [date]);

  const samples = useMemo(
    () =>
      sampleLight(
        TEST_POSITION,
        bearing,
        startOfDay(date),
        new Date(startOfDay(date).getTime() + (MINUTES_PER_DAY - 1) * 60_000),
        SAMPLE_STEP_MINUTES,
      ),
    [date, bearing],
  );

  const shiftDate = (days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    setDate(startOfDay(next));
  };

  const shiftMinutes = (delta: number) => {
    setMinuteOfDay((m) => clampMinute(m + delta));
  };

  const shiftBearing = (delta: number) => {
    setBearing((b) => (((b + delta) % 360) + 360) % 360);
  };

  /**
   * Tapping the strip scrubs to that time — a large, glove-friendly target.
   *
   * Uses `pageX` against the measured rect rather than `locationX`. Both the
   * finite check and the clamp stay: `Math.max(0, NaN)` is `NaN`, not `0`, so
   * an absent coordinate would otherwise poison `minuteOfDay` and render the
   * entire screen as "NaN".
   */
  const onStripPress = (e: { nativeEvent: { pageX?: number } }) => {
    const pageX = e.nativeEvent.pageX;
    if (stripRect.width <= 0 || !Number.isFinite(pageX)) return;
    const fraction = (pageX! - stripRect.x) / stripRect.width;
    if (!Number.isFinite(fraction)) return;
    const bounded = Math.min(1, Math.max(0, fraction));
    setMinuteOfDay(clampMinute(Math.round(bounded * (MINUTES_PER_DAY - 1))));
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.kicker}>LIGHT</Text>
      <Text style={styles.position}>
        {TEST_POSITION.latitude.toFixed(4)}, {TEST_POSITION.longitude.toFixed(4)}
      </Text>
      <Text style={styles.positionNote}>
        Approximate test position — not documented circuit data
      </Text>

      <DirectionCard light={light} />

      <Readouts light={light} bearing={bearing} />

      <Stepper
        label="Bearing"
        value={`${Math.round(bearing)}°  ${compassPoint(bearing)}`}
        onDown={() => shiftBearing(-15)}
        onUp={() => shiftBearing(15)}
      />

      <Stepper
        label="Time"
        value={formatClock(at)}
        onDown={() => shiftMinutes(-15)}
        onUp={() => shiftMinutes(15)}
      />

      <Stepper
        label="Date"
        value={formatDate(date)}
        onDown={() => shiftDate(-1)}
        onUp={() => shiftDate(1)}
      />

      <Text style={styles.sectionLabel}>DAY</Text>
      <Pressable
        ref={stripRef}
        onPressIn={onStripPress}
        onLayout={measureStrip}
        style={styles.strip}
      >
        {samples.map((s, i) => (
          <View
            key={i}
            style={[
              styles.stripCell,
              { backgroundColor: lightQualityColor[s.light.quality] },
            ]}
          />
        ))}
        {stripRect.width > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.stripMarker,
              {
                left:
                  (minuteOfDay / (MINUTES_PER_DAY - 1)) * stripRect.width - 1,
              },
            ]}
          />
        )}
      </Pressable>
      <View style={styles.stripAxis}>
        <Text style={styles.axisLabel}>00:00</Text>
        <Text style={styles.axisLabel}>12:00</Text>
        <Text style={styles.axisLabel}>24:00</Text>
      </View>

      <Text style={styles.sectionLabel}>KEY TIMES</Text>
      <KeyTime label="Sunrise" value={day.sunrise} />
      <KeyTime label="Golden hour ends" value={day.goldenHourMorningEnd} />
      <KeyTime label="Golden hour starts" value={day.goldenHourEveningStart} />
      <KeyTime label="Sunset" value={day.sunset} />
      <KeyTime label="Civil dusk" value={day.civilDusk} />
      <KeyTime label="Astronomical dusk" value={day.astronomicalDusk} />

      <Text style={styles.caveat}>{HORIZON_CAVEAT}</Text>
    </ScrollView>
  );
}

function DirectionCard({ light }: { light: SpotLight }) {
  // Null is a real answer, not a missing one: the sun is below the horizon, so
  // "backlit" would be confidently wrong rather than merely imprecise.
  if (light.direction === null) {
    return (
      <View style={[styles.card, styles.cardMuted]}>
        <Text style={styles.directionMuted}>SUN DOWN</Text>
        <Text style={styles.blurb}>
          No light direction while the sun is below the horizon.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { borderColor: lightQualityColor[light.quality] },
      ]}
    >
      <Text style={[styles.direction, { color: lightQualityColor[light.quality] }]}>
        {DIRECTION_LABEL[light.direction]}
      </Text>
      <Text style={styles.blurb}>{DIRECTION_BLURB[light.direction]}</Text>
    </View>
  );
}

function Readouts({ light, bearing }: { light: SpotLight; bearing: number }) {
  return (
    <View style={styles.readoutRow}>
      <Readout
        label="Sun alt"
        value={`${light.position.altitude.toFixed(1)}°`}
      />
      <Readout
        label="Sun az"
        value={`${Math.round(light.position.azimuth)}° ${compassPoint(light.position.azimuth)}`}
      />
      <Readout
        label="Off-axis"
        value={
          light.relativeAzimuth === null
            ? '—'
            : `${light.relativeAzimuth > 0 ? '+' : ''}${Math.round(light.relativeAzimuth)}°`
        }
      />
      <Readout label="Band" value={light.band} />
      <Readout label="Quality" value={light.quality} />
      <Readout label="Aim" value={`${Math.round(bearing)}°`} />
    </View>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.readoutValue}>{value}</Text>
    </View>
  );
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onDown}
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <View style={styles.stepCentre}>
        <Text style={styles.stepLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.stepValue}>{value}</Text>
      </View>
      <Pressable
        onPress={onUp}
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

function KeyTime({ label, value }: { label: string; value: Date | null }) {
  return (
    <View style={styles.keyTime}>
      <Text style={styles.keyTimeLabel}>{label}</Text>
      <Text style={[styles.keyTimeValue, value === null && styles.keyTimeAbsent]}>
        {value === null ? 'not today' : formatClock(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingBottom: space.xxl },

  kicker: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
  },
  position: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
    marginTop: space.xs,
    fontVariant: ['tabular-nums'],
  },
  positionNote: {
    color: color.textFaint,
    fontSize: type.label,
    marginTop: space.xs,
  },

  card: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 2,
  },
  cardMuted: { borderColor: color.border },
  direction: {
    fontSize: type.display,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  directionMuted: {
    fontSize: type.display,
    fontWeight: weight.bold,
    letterSpacing: 1,
    color: color.textFaint,
  },
  blurb: {
    color: color.textMuted,
    fontSize: type.body,
    marginTop: space.sm,
  },

  readoutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.md,
    gap: space.sm,
  },
  readout: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.sm,
  },
  readoutLabel: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  readoutValue: {
    color: color.text,
    fontSize: type.mono,
    fontWeight: weight.bold,
    marginTop: space.xs,
    fontVariant: ['tabular-nums'],
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  stepButton: {
    width: HIT_SIZE,
    height: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceRaised,
  },
  pressed: { backgroundColor: color.accent },
  stepGlyph: {
    color: color.text,
    fontSize: 28,
    fontWeight: weight.bold,
    lineHeight: 30,
  },
  stepCentre: { flex: 1, alignItems: 'center' },
  stepLabel: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  stepValue: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  sectionLabel: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
    marginTop: space.xl,
    marginBottom: space.sm,
  },

  strip: {
    flexDirection: 'row',
    height: 64,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  stripCell: { flex: 1, height: '100%' },
  stripMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: color.text,
  },
  stripAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  axisLabel: { color: color.textFaint, fontSize: type.label },

  keyTime: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  keyTimeLabel: { color: color.textMuted, fontSize: type.body },
  keyTimeValue: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  keyTimeAbsent: { color: color.undocumented, fontWeight: weight.regular },

  caveat: {
    color: color.textFaint,
    fontSize: type.label,
    marginTop: space.lg,
    lineHeight: 18,
  },
});
