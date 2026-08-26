/**
 * Waypoint list.
 *
 * The map answers "where", this answers "what have I got". At a circuit with
 * forty spots, scanning a list is faster than panning a 20km lap, and it is the
 * only place hidden spots are reachable.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AccessClassification, type Spot } from '../../core/domain/spot';
import type { Media } from '../../core/domain/media';
import type { SpotId } from '../../core/domain/ids';
import { radius, space, type, useTheme, weight, type Theme } from '../theme';

const ACCESS_LABEL: Record<AccessClassification, string> = {
  [AccessClassification.Official]: 'Official',
  [AccessClassification.PublicLand]: 'Public land',
  [AccessClassification.PermissionRequired]: 'Permission needed',
  [AccessClassification.Unknown]: 'Not documented',
};

export default function SpotListScreen({
  spots,
  media,
  mediaUris,
  onOpen,
  onToggleHidden,
  onDelete,
}: {
  spots: Spot[];
  media: Record<string, Media[]>;
  mediaUris: Record<string, string>;
  onOpen: (id: SpotId) => void;
  onToggleHidden: (id: SpotId, hidden: boolean) => void;
  /**
   * Tombstone the spot (§0.1), after the caller has confirmed it.
   *
   * Separate from hiding, and the list offers both because they answer
   * different questions. Hiding is "not now" — the spot stays, and the list's
   * own toggle brings it back. Deleting is "this was wrong": a duplicate, a
   * mis-tap, a spot recorded at the wrong corner. Without it the only way to
   * be rid of one was to open it and go looking, and clutter that takes four
   * taps to remove is clutter that stays.
   */
  onDelete: (id: SpotId) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [showHidden, setShowHidden] = useState(false);

  const { visible, hidden } = useMemo(
    () => ({
      visible: spots.filter((s) => !s.isHidden),
      hidden: spots.filter((s) => s.isHidden),
    }),
    [spots],
  );

  const rows = showHidden ? hidden : visible;

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setShowHidden(false)}
          style={({ pressed }) => [
            styles.tab,
            !showHidden && styles.tabActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.tabLabel, !showHidden && styles.tabLabelActive]}>
            Spots · {visible.length}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setShowHidden(true)}
          style={({ pressed }) => [
            styles.tab,
            showHidden && styles.tabActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.tabLabel, showHidden && styles.tabLabelActive]}>
            Hidden · {hidden.length}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {rows.length === 0 && (
          <Text style={styles.empty}>
            {showHidden
              ? 'Nothing hidden. Hiding a spot keeps it — it just stops cluttering the map.'
              : 'No spots yet. Tap “+ Spot” on the map to add one.'}
          </Text>
        )}

        {rows.map((s) => {
          const rows_ = media[s.id] ?? [];
          const key = rows_.find((m) => m.isKeyImage);
          const uri = key?.storageKey ? mediaUris[key.storageKey] : undefined;
          const undocumented =
            s.accessClassification === AccessClassification.Unknown;

          return (
            <Pressable
              key={s.id}
              onPress={() => onOpen(s.id)}
              style={({ pressed }) => [
                styles.row,
                s.isHidden && styles.rowHidden,
                pressed && styles.pressed,
              ]}
            >
              {uri ? (
                <Image source={{ uri }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Text style={styles.thumbEmptyText}>no key</Text>
                </View>
              )}

              <View style={styles.rowBody}>
                <Text
                  style={[styles.rowName, s.isHidden && styles.mutedText]}
                  numberOfLines={1}
                >
                  {s.name}
                </Text>
                <Text
                  style={[styles.rowMeta, undocumented && styles.undocumented]}
                  numberOfLines={1}
                >
                  {ACCESS_LABEL[s.accessClassification]}
                  {rows_.length > 0 ? ` · ${rows_.length} photo${rows_.length === 1 ? '' : 's'}` : ''}
                </Text>
                {(s.keyTimes.length > 0 || s.tags.length > 0) && (
                  <Text style={styles.rowTags} numberOfLines={1}>
                    {[...s.keyTimes, ...s.tags].join(' · ')}
                  </Text>
                )}
              </View>

              {/* Stop the press bubbling to the row, or hiding also opens it. */}
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onToggleHidden(s.id, !s.isHidden);
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.hideBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.hideLabel}>
                  {s.isHidden ? 'Show' : 'Hide'}
                </Text>
              </Pressable>

              {/*
                Delete asks first, and names the spot when it does.

                Hiding is reversible from this very screen, so it needs no
                confirmation. This is not: it tombstones the record, and the
                photos go with it. A confirm that reads back the name is the
                difference between undoing a mis-tap and discovering later that
                the wrong waypoint is gone — and at a circuit these are pressed
                in gloves, in a hurry, next to each other.
              */}
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  Alert.alert(
                    'Delete spot?',
                    `"${s.name}" and any photos on it will be removed. This cannot be undone.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => onDelete(s.id),
                      },
                    ],
                  );
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.hideBtn,
                  styles.deleteBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.hideLabel, styles.deleteLabel]}>Delete</Text>
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.background },
    pressed: { opacity: 0.7 },

    tabs: {
      flexDirection: 'row',
      gap: space.sm,
      padding: space.sm,
    },
    tab: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    tabActive: { backgroundColor: color.surfaceRaised },
    tabLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    tabLabelActive: { color: color.text },

    list: { padding: space.sm, paddingBottom: space.xl },
    empty: {
      color: color.textFaint,
      fontSize: type.body,
      padding: space.lg,
      textAlign: 'center',
      lineHeight: 21,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      marginBottom: space.sm,
    },
    // Hidden rows recede rather than disappear — they are still yours.
    rowHidden: { opacity: 0.55 },

    thumb: { width: 72, height: 54, borderRadius: radius.sm },
    thumbEmpty: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbEmptyText: { color: color.textFaint, fontSize: 10 },

    rowBody: { flex: 1 },
    rowName: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    mutedText: { color: color.textMuted },
    rowMeta: { color: color.textMuted, fontSize: type.label, marginTop: 2 },
    undocumented: { color: color.undocumented },
    rowTags: { color: color.textFaint, fontSize: 11, marginTop: 2 },

    deleteBtn: { borderColor: color.danger },
    deleteLabel: { color: color.danger },
    hideBtn: {
      height: 40,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    hideLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
  });
}
