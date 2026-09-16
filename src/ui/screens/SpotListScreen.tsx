import { Text, TextInput } from '../Typography';
/**
 * Waypoint list.
 *
 * The map answers "where", this answers "what have I got". At a circuit with
 * forty spots, scanning a list is faster than panning a 20km lap, and it is the
 * only place hidden spots are reachable.
 */
import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AccessClassification, type Spot } from '../../core/domain/spot';
import type { Media } from '../../core/domain/media';
import FocalImage from '../FocalImage';
import { arrangeWaypoints, type SpotSort } from '../../core/logic/spotFilter';
import { groupSpots, waypointRating } from '../../core/logic/spotGroups';
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
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sort, setSort] = useState<SpotSort>('recent');

  /*
    The list is of places, not of ways of shooting them.

    Grouping here rather than taking waypoints as a prop keeps this screen
    working from the same `spots` array everything else uses — see
    core/logic/spotGroups.ts.
  */
  const waypoints = useMemo(() => groupSpots(spots), [spots]);

  const { visible, hidden } = useMemo(
    () => ({
      // Hidden only when every way is, matching the map.
      visible: waypoints.filter((w) => !w.members.every((m) => m.isHidden)),
      hidden: waypoints.filter((w) => w.members.every((m) => m.isHidden)),
    }),
    [waypoints],
  );

  /*
    The tab has already decided about hidden, so the filter is told to keep
    whatever it is given. Asking it a second time would make the Hidden tab
    permanently empty.
  */
  const rows = useMemo(
    () =>
      arrangeWaypoints(
        showHidden ? hidden : visible,
        { query, minRating, includeHidden: true },
        sort,
      ),
    [showHidden, hidden, visible, query, minRating, sort],
  );

  const filtering = query.trim() !== '' || minRating !== null;

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

      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search names"
          placeholderTextColor={color.textMuted}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {(
            [
              ['recent', 'Newest'],
              ['oldest', 'Oldest'],
              ['name', 'Name'],
              ['rating', 'Rating'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSort(value)}
              style={({ pressed }) => [
                styles.chip,
                sort === value && styles.chipOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, sort === value && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))}

          <View style={styles.chipDivider} />

          {/*
            Rating is a floor, not an exact match: "at least three" is the
            question people actually ask of their own spots. Tapping the
            active one clears it, so the filter is always escapable without
            hunting for a reset.
          */}
          {[3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => setMinRating(minRating === n ? null : n)}
              style={({ pressed }) => [
                styles.chip,
                minRating === n && styles.chipOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, minRating === n && styles.chipTextOn]}>
                {n}★+
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {rows.length === 0 && (
          <Text style={styles.empty}>
            {/*
              Three different nothings. "No spots yet" is wrong when the
              collection is full and the search simply found none, and it
              sends people looking for a bug instead of clearing the filter.
            */}
            {filtering
              ? 'Nothing matches. Clear the search or the rating filter.'
              : showHidden
                ? 'Nothing hidden. Hiding a spot keeps it — it just stops cluttering the map.'
                : 'No spots yet. Tap “+ Spot” on the map to add one.'}
          </Text>
        )}

        {rows.map((w) => {
          const s = w.primary;
          const rows_ = media[s.id] ?? [];
          const key = rows_.find((m) => m.isKeyImage);
          const uri = key?.storageKey ? mediaUris[key.storageKey] : undefined;
          const undocumented =
            s.accessClassification === AccessClassification.Unknown;
          const rating = waypointRating(w);
          const ways = w.members.length;

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
                /*
                  Cropped around the chosen point rather than letterboxed.

                  'contain' fitted the whole frame into a square, which for a
                  landscape photograph means two bars of background and a
                  picture too small to recognise a corner from. Filling the
                  square is the right call for a list you are scanning — and
                  filling it around the part that identifies the place is what
                  makes that safe to do. See core/logic/focalCrop.ts.
                */
                <FocalImage
                  uri={uri}
                  focal={
                    key?.focalX == null || key?.focalY == null
                      ? null
                      : { x: key.focalX, y: key.focalY }
                  }
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Text style={styles.thumbEmptyText}>No photo</Text>
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
                  {ways > 1 ? ` · ${ways} ways` : ''}
                  {rating !== null ? ` · ${'★'.repeat(rating)}` : ''}
                </Text>
                {(s.keyTimes.length > 0 || s.tags.length > 0) && (
                  <Text style={styles.rowTags} numberOfLines={1}>
                    {[...s.keyTimes, ...s.tags].join(' · ')}
                  </Text>
                )}
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${s.name}`} accessibilityState={{ expanded: actionsFor === s.id }} onPress={e => { e.stopPropagation(); setActionsFor(actionsFor === s.id ? null : s.id); }} style={styles.moreButton}><Text style={{ color: color.textMuted, fontSize: 22 }}>···</Text></Pressable>
              {actionsFor === s.id && <View style={styles.actionRow}>
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
              </View>}
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

    controls: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  search: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: color.text,
    fontSize: type.body,
  },
  chips: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceRaised,
  },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { color: color.textMuted, fontSize: type.label },
  chipTextOn: { color: color.onAccent, fontWeight: weight.bold },
  chipDivider: {
    width: 1,
    height: 20,
    backgroundColor: color.border,
    marginHorizontal: space.xs,
  },

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
      flexWrap: 'wrap',
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

    rowBody: { flex: 1, minWidth: 100 },
    moreButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
    actionRow: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', gap: 12, paddingTop: 8 },
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
