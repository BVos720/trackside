/**
 * The navigator — where you are, where you are going, and whether you are late.
 *
 * Lives over the map rather than on its own screen: the whole point is to be
 * glanceable while walking, and a full-page view you have to navigate back out
 * of is not something anyone opens with a camera in one hand.
 *
 * ── It tells you when to leave, not just where to go ───────────────────────
 * Distance and direction are the easy half. The half that matters is "you have
 * six minutes before you need to move", because the failure this app exists to
 * prevent is arriving at a corner as the session ends. The countdown is to
 * *departure*, never to arrival — by the time an arrival countdown reads zero
 * the decision was already made for you.
 *
 * ── Never say "turn left" ──────────────────────────────────────────────────
 * The route comes from OSM ways with no knowledge of gates, marshals, fences or
 * mud. It is drawn and described as a suggestion — distance, bearing, and how
 * much of it has no path at all — and the off-path portion is called out
 * explicitly. Turn-by-turn phrasing would imply a confidence the data cannot
 * support, which is the same failure as inferring access (§0.2).
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PlanStop } from '../../core/domain/event';
import type { Spot } from '../../core/domain/spot';
import { bearingDegrees, compassPoint } from '../../core/logic/geo';
import type { Route, WalkNetwork } from '../../core/logic/route';
import { routeBetween } from '../../core/logic/route';
import {
  formatClock,
  minuteOfDay,
  parseClock,
  relativeMinutes,
  urgencyOf,
  walkEstimate,
} from '../../core/logic/walk';
import { color, radius, space, type, weight } from '../theme';
import type { Fix, PositionStatus } from '../state/usePosition';

const URGENCY_COLOR = {
  idle: color.textMuted,
  soon: color.accent,
  now: '#F2A03D',
  late: color.danger,
} as const;

export default function NavigatorPanel({
  stop,
  spot,
  network,
  barriers = [],
  fix,
  status,
  now,
  onClose,
}: {
  stop: PlanStop;
  spot: Spot | null;
  network: WalkNetwork;
  /** Lines a walk may not cross — the racing surface. */
  barriers?: readonly (readonly (readonly [number, number])[])[];
  fix: Fix | null;
  status: PositionStatus;
  /** Passed in rather than read here, so the whole panel re-renders on a tick. */
  now: Date;
  onClose: () => void;
}) {
  const route: Route | null = useMemo(
    () =>
      fix && spot
        ? routeBetween(
            network,
            fix.position,
            spot.position,
            barriers,
            fix.accuracyMetres ?? 0,
          )
        : null,
    [fix, spot, network, barriers],
  );

  const walk = useMemo(
    () =>
      route
        ? walkEstimate({
            metres: route.metres,
            offNetworkMetres: route.offNetworkMetres,
          })
        : null,
    [route],
  );

  const bearing = useMemo(
    () => (fix && spot ? bearingDegrees(fix.position, spot.position) : null),
    [fix, spot],
  );

  const arriveAt = stop.arriveAt ? parseClock(stop.arriveAt) : null;
  const departAt = arriveAt !== null && walk ? arriveAt - walk.minutes : null;
  const nowMinute = minuteOfDay(now);
  const urgency =
    departAt !== null ? urgencyOf(nowMinute, departAt) : 'idle';

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>NAVIGATING TO</Text>
          <Text style={styles.name} numberOfLines={1}>
            {spot?.name ?? 'Deleted spot'}
          </Text>
          {stop.label && (
            <Text style={styles.label} numberOfLines={1}>
              {stop.label}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeLabel}>Stop</Text>
        </Pressable>
      </View>

      {/* The departure warning is the loudest thing on the panel. */}
      {departAt !== null && (
        <View
          style={[
            styles.banner,
            { borderColor: URGENCY_COLOR[urgency] },
          ]}
        >
          <Text style={[styles.bannerTime, { color: URGENCY_COLOR[urgency] }]}>
            {urgency === 'late'
              ? `Should have left at ${formatClock(departAt)}`
              : urgency === 'now'
                ? 'Leave now'
                : `Leave at ${formatClock(departAt)}`}
          </Text>
          <Text style={styles.bannerSub}>
            {urgency === 'late'
              ? `${relativeMinutes(departAt - nowMinute)} — you may not make ${stop.arriveAt}`
              : `${relativeMinutes(departAt - nowMinute)} · be there ${stop.arriveAt}`}
          </Text>
        </View>
      )}

      {status === 'denied' && (
        <Text style={styles.notice}>
          Location is off, so the distance from here is unknown. The plan still
          works — only the live part needs it.
        </Text>
      )}
      {status === 'unavailable' && (
        <Text style={styles.notice}>
          No location available on this device. Distances shown in the plan are
          stop to stop.
        </Text>
      )}
      {(status === 'requesting' || (status === 'watching' && !fix)) && (
        <Text style={styles.notice}>Getting a fix…</Text>
      )}

      {route && walk && (
        <>
          <View style={styles.facts}>
            <Fact
              label="DISTANCE"
              value={
                route.metres < 1000
                  ? `${Math.round(route.metres)} m`
                  : `${(route.metres / 1000).toFixed(2)} km`
              }
            />
            <Fact label="WALK" value={`~${walk.minutes} min`} />
            <Fact
              label="DIRECTION"
              value={bearing === null ? '—' : compassPoint(bearing)}
            />
          </View>

          {/*
            Blocked is a "keep looking" state, not a dead end.

            The route is recomputed on every fix, so walking a few metres —
            towards a tunnel, or simply away from the trackside where the fix
            was ambiguous — often finds one. Saying that is more use than an
            error, and it is why no line is drawn on the map meanwhile.
          */}
          {route.blocked && (
            <View style={styles.blockedBox}>
              <Text style={styles.blocked}>
                No way there yet without crossing the circuit.
              </Text>
              <Text style={styles.blockedBody}>
                Nothing is drawn on the map, because the only line found runs
                across the track. Keep walking — this rechecks every time your
                position updates, and usually finds a route once you are clear
                of the trackside or nearer a crossing.
              </Text>
              <Text style={styles.blockedBody}>
                Head {bearing === null ? 'towards the spot' : compassPoint(bearing)}{' '}
                and look for a bridge, tunnel or marked spectator crossing.
              </Text>
            </View>
          )}

          {route.offNetworkMetres > 20 && !route.blocked && (
            <Text style={styles.offPath}>
              {Math.round(route.offNetworkMetres)} m of this has no path —
              straight-line only. Check the ground before you commit to it.
            </Text>
          )}

          {/*
            The one thing that is true regardless of what the route says.

            Every line on this screen comes from OSM ways and a GPS fix, neither
            of which knows where a marshal is standing or whether a session is
            running. Shown always, not only when blocked, because the dangerous
            moment is the one where the app looks confident.
          */}
          <Text style={styles.standingWarning}>
            Never cross or enter the circuit, even if a route appears to go
            that way. Use marked spectator crossings only — if there is not one,
            go the long way round.
          </Text>

          {fix?.accuracyMetres !== null &&
            fix?.accuracyMetres !== undefined &&
            fix.accuracyMetres > 25 && (
              <Text style={styles.notice}>
                Position accurate to about {Math.round(fix.accuracyMetres)} m —
                treat the distance as rough.
              </Text>
            )}
        </>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.md,
    backgroundColor: color.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: color.border,
  },
  pressed: { opacity: 0.7 },

  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  kicker: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },
  name: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
    marginTop: 2,
  },
  label: { color: color.accent, fontSize: type.label, marginTop: 1 },
  close: {
    height: 40,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
  },
  closeLabel: {
    color: color.textMuted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },

  banner: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: color.surface,
  },
  bannerTime: { fontSize: type.title, fontWeight: weight.bold },
  bannerSub: { color: color.textMuted, fontSize: type.label, marginTop: 2 },

  facts: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  fact: {
    flex: 1,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  factLabel: {
    color: color.textFaint,
    fontSize: 10,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  factValue: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  /**
   * The one message on this panel that is a warning rather than information.
   *
   * Coloured as danger because the failure it prevents is not a missed photo.
   */
  blockedBox: {
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.danger,
    backgroundColor: color.surface,
  },
  blockedBody: {
    color: color.textMuted,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.xs,
  },
  /** Quiet but always there; the loud styling belongs to the blocked box. */
  standingWarning: {
    color: color.undocumented,
    fontSize: 11,
    lineHeight: 15,
    marginTop: space.sm,
  },
  blocked: {
    color: color.danger,
    fontSize: type.label,
    fontWeight: weight.bold,
    marginTop: space.sm,
    lineHeight: 17,
  },
  offPath: {
    color: color.undocumented,
    fontSize: type.label,
    marginTop: space.sm,
    lineHeight: 17,
  },
  notice: {
    color: color.textMuted,
    fontSize: type.label,
    marginTop: space.sm,
    lineHeight: 17,
  },
});
