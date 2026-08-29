/**
 * Spot detail — the read-only view you get from tapping a pin.
 *
 * Tapping a waypoint shows what is there rather than dropping you into a form.
 * Editing is a deliberate second step, which also means a mis-tap on the map
 * cannot silently change a saved spot.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AccessClassification, type Spot } from '../../core/domain/spot';
import type { Media } from '../../core/domain/media';
import FocalImage from '../FocalImage';
import { radius, space, type, useTheme, weight, type Theme } from '../theme';

const ACCESS_LABEL: Record<AccessClassification, string> = {
  [AccessClassification.Official]: 'Official',
  [AccessClassification.PublicLand]: 'Public land',
  [AccessClassification.PermissionRequired]: 'Permission needed',
  [AccessClassification.Unknown]: 'Not documented',
};

export default function SpotOverview({
  spot,
  members,
  media,
  mediaUris,
  onEdit,
  onMove,
  onDelete,
  onClose,
  onSetKey,
  onSetFocal,
  onStepWay,
  onAddWay,
  onRate,
  onRenameWay,
  onStandHere,
}: {
  /** The way of shooting currently on screen — always one of `members`. */
  spot: Spot;
  /**
   * Every way of shooting this waypoint, oldest first.
   *
   * A waypoint of one is the ordinary case and is a list of length one, not a
   * special mode: the counter and arrows simply hide themselves. See
   * `core/logic/spotGroups.ts`.
   */
  members: readonly Spot[];
  media: Media[];
  mediaUris: Record<string, string>;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onClose: () => void;
  onSetKey: (mediaId: string) => void;
  /**
   * Set which part of the key picture the square crops keep — F3.
   *
   * Optional, so a caller that has not wired it simply gets no reframe
   * control rather than a dead one.
   */
  onSetFocal?: (mediaId: string, focal: { x: number; y: number }) => void;
  /** Step to the previous (-1) or next (+1) way, wrapping at both ends. */
  onStepWay: (delta: number) => void;
  /** Record another way of shooting this same place. */
  /** Record another way of shooting this place, under the given sub-name. */
  onAddWay: (subName: string) => void;
  /** 1–5, or null to clear it back to unrated. */
  onRate: (value: number | null) => void;
  /** Stand at this spot in the 3D view and look around. */
  onStandHere?: () => void;
  /** Name this way of shooting. Empty clears it back to unnamed. */
  onRenameWay?: (subName: string) => void;
}) {
  /*
    Naming happens before the way exists, not after.

    An inline field rather than a prompt dialog: Alert.prompt is iOS-only,
    and a modal for one short string is heavier than the thing it collects.
  */
  const [namingWay, setNamingWay] = useState(false);
  const [newWayName, setNewWayName] = useState('');

  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const key = media.find((m) => m.isKeyImage) ?? null;
  const keyUri = key?.storageKey ? mediaUris[key.storageKey] : undefined;
  const rest = media.filter((m) => !m.isKeyImage);
  const undocumented = spot.accessClassification === AccessClassification.Unknown;
  /**
   * Drag the panel down to close it.
   *
   * The grabber already closed on a tap, and that was not enough: it is a
   * few pixels of bar and it looks exactly like every draggable sheet on
   * the phone, so the gesture people try first is a drag. When that did
   * nothing the panel read as stuck — reported as not being able to close
   * it at all, which is what a control that ignores the obvious gesture
   * feels like even when a different one works.
   *
   * The tap stays. Two ways out of a panel is not clutter when neither is
   * a visible control.
   */
  // The PanResponder is created once, so a callback captured directly would be
  // the first render's forever.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dragY = useRef(new Animated.Value(0)).current;

  const drag = useRef(
    PanResponder.create({
      // Past 6px and mostly vertical, so a scroll in the body still
      // scrolls and a tap still taps.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),

      onPanResponderMove: (_e, g) => {
        // Down only: there is nothing above to reveal, and a panel that
        // can be flung into empty space reads as broken.
        dragY.setValue(Math.max(0, g.dy));
      },

      onPanResponderRelease: (_e, g) => {
        // Distance or speed: a short sharp flick is how these get closed,
        // and requiring travel alone makes the panel feel sticky.
        if (g.dy > 120 || g.vy > 0.8) {
          onCloseRef.current();
          dragY.setValue(0);
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 14,
          }).start();
        }
      },

      onPanResponderTerminate: () => {
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 14,
        }).start();
      },
    }),
  ).current;


  return (
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY: dragY }] }]}
    >
      {/*
        The grabber reads as "drag me down to dismiss", so it has to actually
        dismiss. It was decorative, and `onClose` was accepted but never
        called — which left Delete, Move and Edit as the only ways out of a
        spot you only wanted to look at.
      */}
      <Pressable
        onPress={onClose}
        style={styles.grabZone}
        hitSlop={8}
        {...drag.panHandlers}
      >
        <View style={styles.grabber} />
      </Pressable>

      {/*
        The keyboard must not sit over the field being typed into.

        Same pair as EventScreen and EventsScreen use, and for the same
        reasons. `automaticallyAdjustKeyboardInsets` is the iOS-native answer:
        the scroll view insets its own content by the keyboard height, so the
        focused field scrolls into view and everything below stays reachable.
        Ignored on Android, where softwareKeyboardLayoutMode handles it at the
        window level.

        `keyboardShouldPersistTaps` is the other half. Without it the first
        tap after typing only dismisses the keyboard — so Add, sitting
        directly under the field you have just filled in, would quietly need
        pressing twice.
      */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Key picture leads — full-bleed, no border or shadow (§5.13). */}
        {keyUri ? (
          <Image source={{ uri: keyUri }} style={styles.hero} resizeMode="contain" />
        ) : (
          <View style={[styles.hero, styles.heroEmpty]}>
            <Text style={styles.heroEmptyText}>No key picture yet</Text>
            <Text style={styles.heroEmptyHint}>
              Your best shot from here. Add one when editing.
            </Text>
          </View>
        )}

        {/*
          Which way of shooting this is, and how to get to the others.

          Only drawn when there is more than one. A waypoint with a single way
          is the common case, and a counter reading "1 of 1" next to two dead
          arrows is noise that makes the simple case look complicated.
        */}
        {members.length > 1 ? (
          <View style={styles.wayBar}>
            <Pressable
              onPress={() => onStepWay(-1)}
              hitSlop={10}
              style={({ pressed }) => [styles.wayArrow, pressed && styles.pressed]}
            >
              <Text style={styles.wayArrowText}>‹</Text>
            </Pressable>
            {/*
              The way's own name when it has one, the count when it does not.

              "Long lens" tells you where you are in the carousel far better
              than "2 of 3"; the count is only a fallback for a way nobody
              has named yet.
            */}
            <Text style={styles.wayCount} numberOfLines={1}>
              {spot.subName ??
                `Way ${members.findIndex((m) => m.id === spot.id) + 1} of ${members.length}`}
            </Text>
            <Pressable
              onPress={() => onStepWay(1)}
              hitSlop={10}
              style={({ pressed }) => [styles.wayArrow, pressed && styles.pressed]}
            >
              <Text style={styles.wayArrowText}>›</Text>
            </Pressable>
          </View>
        ) : null}

        {/*
          What the square crops will show, and how to change it.

          The hero above is letterboxed and shows the whole frame, so it
          cannot answer this — the question 'what will the thumbnail be'
          needs a thumbnail. Tapping puts what you touched in the middle,
          which is the whole interaction: no handles, no zoom, no modal.
        */}
        {key !== null && keyUri !== undefined && onSetFocal && (
          <View style={styles.reframeRow}>
            <FocalImage
              uri={keyUri}
              focal={
                key.focalX == null || key.focalY == null
                  ? null
                  : { x: key.focalX, y: key.focalY }
              }
              onChangeFocal={(f) => onSetFocal(key.id, f)}
              style={styles.reframe}
            />
            <Text style={styles.reframeHint}>
              This is how it appears in lists and on the map. Tap the picture
              to centre it on what matters.
            </Text>
          </View>
        )}

        <Text style={styles.name}>{spot.name}</Text>

        {/*
          The place is named above; this names the way of shooting it.

          Only offered once there is more than one way. Until then there is
          nothing to tell apart, and a second empty name field under every
          spot is a question nobody asked.
        */}
        {members.length > 1 && onRenameWay ? (
          <TextInput
            value={spot.subName ?? ''}
            onChangeText={onRenameWay}
            placeholder="Name this way — long lens, wide, low"
            placeholderTextColor={color.textMuted}
            style={styles.subName}
          />
        ) : null}
        <Text style={styles.coords}>
          {spot.position.latitude.toFixed(5)},{' '}
          {spot.position.longitude.toFixed(5)}
        </Text>

        {/*
          How this way turned out.

          Tapping the star you are already on clears it back to unrated, which
          is a real state and not the same as one star — see `Spot.rating`.
          Without a way back, a mis-tap would leave a permanent opinion.
        */}
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = spot.rating !== null && n <= spot.rating;
            return (
              <Pressable
                key={n}
                onPress={() => onRate(spot.rating === n ? null : n)}
                hitSlop={6}
                style={({ pressed }) => [styles.star, pressed && styles.pressed]}
              >
                <Text style={on ? styles.starOn : styles.starOff}>★</Text>
              </Pressable>
            );
          })}
          <Text style={styles.starHint}>
            {spot.rating === null ? 'Not rated' : `${spot.rating} of 5`}
          </Text>
        </View>

        {/*
          Another way of shooting this same place.

          Deliberately here rather than beside Edit: adding a way is about the
          waypoint, and Edit, Move and Delete all act on the one way you are
          looking at. Putting them together would make it far too easy to reach
          for Delete meaning "remove this way" and take the place with it.
        */}
        {/*
          What you would actually see from here.

          Next to "another way of shooting this" because both are about the
          place rather than this one photograph, and because they answer the
          same question: is this position any good. One asks it of a picture
          already taken, the other of the view itself.
        */}
        {onStandHere ? (
          <Pressable
            onPress={onStandHere}
            style={({ pressed }) => [styles.addWay, pressed && styles.pressed]}
          >
            <Text style={styles.addWayText}>Stand here and look around</Text>
          </Pressable>
        ) : null}

        {namingWay ? (
          <View>
            <TextInput
              value={newWayName}
              onChangeText={setNewWayName}
              placeholder={`${spot.name} — name this way`}
              placeholderTextColor={color.textMuted}
              style={styles.subName}
              autoFocus
            />
            <View style={styles.wayAddRow}>
              <Pressable
                onPress={() => { setNamingWay(false); setNewWayName(''); }}
                style={({ pressed }) => [styles.addWay, styles.wayAddHalf, pressed && styles.pressed]}
              >
                <Text style={styles.addWayText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { onAddWay(newWayName); setNamingWay(false); setNewWayName(''); }}
                style={({ pressed }) => [styles.addWay, styles.wayAddHalf, pressed && styles.pressed]}
              >
                <Text style={styles.addWayText}>Add</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setNamingWay(true)}
            style={({ pressed }) => [styles.addWay, pressed && styles.pressed]}
          >
            <Text style={styles.addWayText}>+  Another way of shooting this</Text>
          </Pressable>
        )}

        <View style={styles.factRow}>
          <Fact
            label="Access"
            value={ACCESS_LABEL[spot.accessClassification]}
            muted={undocumented}
          />
          <Fact label="Photos" value={String(media.length)} />
        </View>

        {spot.accessNotes ? (
          <>
            <Text style={styles.label}>NOTES</Text>
            <Text style={styles.notes}>{spot.accessNotes}</Text>
          </>
        ) : null}

        {spot.shotSettings.length > 0 && (
          <>
            <Text style={styles.label}>SETTINGS</Text>
            {spot.shotSettings.map((sh) => (
              <View key={sh.id} style={styles.shotRow}>
                <Text style={styles.shotTechnique}>{sh.technique}</Text>
                <Text style={styles.shotDetail}>
                  {[
                    sh.focalMinMm
                      ? sh.focalMaxMm && sh.focalMaxMm !== sh.focalMinMm
                        ? `${sh.focalMinMm}–${sh.focalMaxMm}mm`
                        : `${sh.focalMinMm}mm`
                      : null,
                    sh.shutter,
                    sh.aperture,
                    sh.iso ? `ISO ${sh.iso}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
            ))}
          </>
        )}

        {(spot.keyTimes.length > 0 || spot.tags.length > 0) && (
          <>
            <Text style={styles.label}>WHEN &amp; WHAT</Text>
            <Text style={styles.notes}>
              {[...spot.keyTimes, ...spot.tags].join('  ·  ')}
            </Text>
          </>
        )}

        {rest.length > 0 && (
          <>
            <Text style={styles.label}>WHERE TO STAND</Text>
            <View style={styles.thumbRow}>
              {rest.map((m) => {
                const uri = m.storageKey ? mediaUris[m.storageKey] : undefined;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => onSetKey(m.id)}
                    style={styles.thumb}
                  >
                    {uri ? (
                      <FocalImage
                        uri={uri}
                        focal={
                          m.focalX === null || m.focalY === null
                            ? null
                            : { x: m.focalX, y: m.focalY }
                        }
                        style={styles.thumbImage}
                      />
                    ) : (
                      <View style={[styles.thumbImage, styles.thumbMissing]}>
                        <Text style={styles.thumbMissingText}>no preview</Text>
                      </View>
                    )}
                    <Text style={styles.thumbKind}>
                      {m.referenceKind ?? 'photo'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.help}>
              Tap a photo to make it the key picture.
            </Text>
          </>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
        <Pressable
          onPress={onMove}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <Text style={styles.closeLabel}>Move</Text>
        </Pressable>
        <Pressable
          onPress={onEdit}
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
        >
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function Fact({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {

  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.factValue, muted && styles.factValueMuted]}>
        {value}
      </Text>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '82%',
      backgroundColor: color.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: color.border,
    },
    // A 4pt bar is not a tap target; the zone around it is.
    grabZone: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
    grabber: {
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.border,
    },
    body: { flexGrow: 0 },
    bodyContent: { padding: space.md, paddingBottom: space.lg },
    pressed: { opacity: 0.7 },

    /*
     * A ground for the letterboxing.
     *
     * The image is drawn with resizeMode contain now, so a photo whose shape
     * does not match this frame leaves bars. Without a background those are
     * whatever is behind the sheet, which reads as the image having failed to
     * load rather than as deliberate margin.
     */
    hero: {
      width: '100%',
      height: 168,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    heroEmpty: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroEmptyText: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    heroEmptyHint: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.xs,
    },

    subName: {
    color: color.text,
    fontSize: type.body,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingVertical: 4,
    marginTop: 2,
  },

  wayAddRow: { flexDirection: 'row', gap: space.sm },
  wayAddHalf: { flex: 1 },

  reframeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  reframe: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
  },
  reframeHint: { flex: 1, color: color.textMuted, fontSize: type.label },

  wayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    marginBottom: space.xs,
  },
  wayArrow: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
  },
  wayArrowText: { color: color.text, fontSize: 20, fontWeight: weight.bold },
  wayCount: {
    color: color.textMuted,
    fontSize: type.label,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  stars: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs },
  star: { paddingHorizontal: 1 },
  starOn: { color: color.accent, fontSize: 20 },
  starOff: { color: color.border, fontSize: 20 },
  starHint: { color: color.textMuted, fontSize: type.label, marginLeft: space.sm },

  addWay: {
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceRaised,
    alignItems: 'center',
  },
  addWayText: { color: color.accent, fontSize: type.body, fontWeight: weight.bold },

  name: {
      color: color.text,
      fontSize: type.title,
      fontWeight: weight.bold,
      marginTop: space.md,
    },
    coords: {
      color: color.textFaint,
      fontSize: type.label,
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },

    factRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    fact: {
      flex: 1,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      padding: space.sm,
    },
    factLabel: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1,
    },
    factValue: {
      color: color.text,
      fontSize: type.mono,
      fontWeight: weight.bold,
      marginTop: 2,
    },
    factValueMuted: { color: color.undocumented, fontWeight: weight.regular },

    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.lg,
    },
    notes: {
      color: color.text,
      fontSize: type.body,
      marginTop: space.xs,
      lineHeight: 21,
    },
    help: { color: color.textFaint, fontSize: type.label, marginTop: space.xs },

    shotRow: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    shotTechnique: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    shotDetail: {
      color: color.textMuted,
      fontSize: type.label,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },

    thumbRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.sm,
    },
    thumb: { width: 96 },
    thumbImage: { width: 96, height: 72, borderRadius: radius.sm },
    thumbMissing: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbMissingText: { color: color.textFaint, fontSize: 11 },
    thumbKind: {
      color: color.textFaint,
      fontSize: 11,
      marginTop: 2,
      textTransform: 'uppercase',
    },

    actions: {
      flexDirection: 'row',
      gap: space.sm,
      padding: space.md,
      borderTopWidth: 1,
      borderTopColor: color.border,
    },
    deleteBtn: {
      height: 48,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    deleteLabel: {
      color: color.danger,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    closeBtn: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    closeLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    editBtn: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    editLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },
  });
}
