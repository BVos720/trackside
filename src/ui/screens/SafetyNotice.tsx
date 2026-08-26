/**
 * What the app is not, shown before it is used for the first time.
 *
 * ── Why this exists as a screen and not a line in TERMS.md ────────────────
 * Trackside influences where somebody stands at a motor racing circuit. The
 * codebase already treats that as serious — see the long note on
 * `AccessClassification` in core/domain/spot.ts, which refuses to let anything
 * infer an access status because "a wrong `official` on a spot is an
 * instruction to a stranger to stand somewhere that could get them hurt".
 *
 * That care was, until now, only visible to people reading the source. A
 * linked terms page is not where anyone learns it either. So the three things
 * that actually matter are said here, once, in front of the map, and are
 * acknowledged by a tap rather than by a scroll:
 *
 *   1. The app never grants permission to be anywhere.
 *   2. Access information is typed in by people and is not verified.
 *   3. Marshals and circuit staff override anything on this screen.
 *
 * Being genuinely told is worth more than a clause nobody opened — both to the
 * person reading it, and if it is ever a question of what they were warned of.
 *
 * ── It blocks, deliberately ───────────────────────────────────────────────
 * There is no dismiss and no "later". It appears once per version of the text
 * and then never again. An interruption that can be swiped past is one that
 * did not happen.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HIT_SIZE, color, radius, space, type, weight } from '../theme';

/**
 * Bump this when the wording materially changes.
 *
 * Everyone sees the notice again — which is the point, and the reason not to
 * bump it for a typo. See `getSafetyAcknowledgedVersion` in preferences.ts.
 */
export const SAFETY_NOTICE_VERSION = 1;

export default function SafetyNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>BEFORE YOU START</Text>
        <Text style={styles.title}>Trackside is a planning tool</Text>
        <Text style={styles.lede}>
          It is not a safety system, and it does not give you permission to be
          anywhere. Circuits are dangerous places. Please read this once.
        </Text>

        <Point
          n="1"
          heading="It does not authorise access"
          body="A spot in this app — including one marked official or public land — is not permission to go there. Access is granted by the circuit, the organiser, the landowner and the marshals. Never by this app."
        />
        <Point
          n="2"
          heading="Access information is not verified"
          body="Every access note is typed in by a person. Nobody checks it. It can be wrong, and it can go out of date — fences move, permissions lapse, layouts change between seasons. Where nothing is recorded, the app says unknown. Treat that as find out before you go."
        />
        <Point
          n="3"
          heading="Instructions on the ground always win"
          body="If a marshal, circuit staff, a landowner or a sign tells you something different from this app, they are right and the app is wrong. Follow them. Leave when told to leave."
        />
        <Point
          n="4"
          heading="Times and walking estimates are approximate"
          body="Timetables change on the day. Walking estimates ignore crowds, closed gates and queues. Leave more margin than the app suggests — hurrying across a circuit is how people get hurt."
        />

        <Text style={styles.closing}>
          You are responsible for where you stand and for your own safety. Use
          your own judgement about run-off, barriers and escape routes.
        </Text>
      </ScrollView>

      <Pressable
        onPress={onAccept}
        style={({ pressed }) => [styles.accept, pressed && styles.pressed]}
      >
        <Text style={styles.acceptLabel}>I understand</Text>
      </Pressable>
    </View>
  );
}

function Point({
  n,
  heading,
  body,
}: {
  n: string;
  heading: string;
  body: string;
}) {
  return (
    <View style={styles.point}>
      <Text style={styles.pointNumber}>{n}</Text>
      <View style={styles.pointBody}>
        <Text style={styles.pointHeading}>{heading}</Text>
        <Text style={styles.pointText}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  pressed: { opacity: 0.7 },

  content: {
    padding: space.md,
    paddingTop: space.xxl,
    paddingBottom: space.lg,
  },

  kicker: {
    color: color.danger,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },
  title: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
    marginTop: space.xs,
  },
  lede: {
    color: color.textMuted,
    fontSize: type.body,
    lineHeight: 22,
    marginTop: space.sm,
  },

  point: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
  },
  pointNumber: {
    color: color.danger,
    fontSize: type.body,
    fontWeight: weight.bold,
    width: 18,
    fontVariant: ['tabular-nums'],
  },
  pointBody: { flex: 1 },
  pointHeading: {
    color: color.text,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  pointText: {
    color: color.textMuted,
    fontSize: type.label,
    lineHeight: 19,
    marginTop: space.xs,
  },

  closing: {
    color: color.text,
    fontSize: type.label,
    lineHeight: 19,
    marginTop: space.lg,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },

  accept: {
    margin: space.md,
    height: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent,
  },
  acceptLabel: {
    color: color.onAccent,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
});
