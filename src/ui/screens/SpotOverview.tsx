/**
 * Spot detail — the read-only view you get from tapping a pin.
 *
 * Tapping a waypoint shows what is there rather than dropping you into a form.
 * Editing is a deliberate second step, which also means a mis-tap on the map
 * cannot silently change a saved spot.
 */
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AccessClassification, type Spot } from '../../core/domain/spot';
import type { Media } from '../../core/domain/media';
import { color, radius, space, type, weight } from '../theme';

const ACCESS_LABEL: Record<AccessClassification, string> = {
  [AccessClassification.Official]: 'Official',
  [AccessClassification.PublicLand]: 'Public land',
  [AccessClassification.PermissionRequired]: 'Permission needed',
  [AccessClassification.Unknown]: 'Not documented',
};

export default function SpotOverview({
  spot,
  media,
  mediaUris,
  onEdit,
  onMove,
  onDelete,
  onClose,
  onSetKey,
}: {
  spot: Spot;
  media: Media[];
  mediaUris: Record<string, string>;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onClose: () => void;
  onSetKey: (mediaId: string) => void;
}) {
  const key = media.find((m) => m.isKeyImage) ?? null;
  const keyUri = key?.storageKey ? mediaUris[key.storageKey] : undefined;
  const rest = media.filter((m) => !m.isKeyImage);
  const undocumented = spot.accessClassification === AccessClassification.Unknown;

  return (
    <View style={styles.sheet}>
      {/*
        The grabber reads as "drag me down to dismiss", so it has to actually
        dismiss. It was decorative, and `onClose` was accepted but never
        called — which left Delete, Move and Edit as the only ways out of a
        spot you only wanted to look at.
      */}
      <Pressable onPress={onClose} style={styles.grabZone} hitSlop={8}>
        <View style={styles.grabber} />
      </Pressable>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Key picture leads — full-bleed, no border or shadow (§5.13). */}
        {keyUri ? (
          <Image source={{ uri: keyUri }} style={styles.hero} />
        ) : (
          <View style={[styles.hero, styles.heroEmpty]}>
            <Text style={styles.heroEmptyText}>No key picture yet</Text>
            <Text style={styles.heroEmptyHint}>
              Your best shot from here. Add one when editing.
            </Text>
          </View>
        )}

        <Text style={styles.name}>{spot.name}</Text>
        <Text style={styles.coords}>
          {spot.position.latitude.toFixed(5)},{' '}
          {spot.position.longitude.toFixed(5)}
        </Text>

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
                      <Image source={{ uri }} style={styles.thumbImage} />
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
    </View>
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
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.factValue, muted && styles.factValueMuted]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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

  hero: { width: '100%', height: 168, borderRadius: radius.md },
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
