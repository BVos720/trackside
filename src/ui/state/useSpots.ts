/**
 * Spot state for the map and sheet — spec §5.1.
 *
 * Holds the loaded spots for one circuit and writes through to the repository.
 * Every mutation goes to storage first and then updates state, so a failed
 * write cannot leave the UI showing a spot that was never saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { nowUtc } from '../../core/domain/common';
import {
  type AccessClassification,
  type ShotSetting,
  type SpotUse,
  normaliseUses,
  type Spot,
  newSpot,
} from '../../core/domain/spot';
import {
  type CircuitId,
  type EventId,
  type MediaId,
  type SpotGroupId,
  type SpotId,
  type UserId,
  newId,
} from '../../core/domain/ids';
import { groupSpots, waypointRating } from '../../core/logic/spotGroups';
import {
  cloneSpotsForEvent,
  spotsForContext,
} from '../../core/logic/cloneSpots';
import {
  type Media,
  MediaSource,
  MediaType,
  type ReferenceKind,
} from '../../core/domain/media';
import { Visibility } from '../../core/domain/common';
import { repositories } from '../../storage-local/repositories/documentRepositories';
import { mediaStore } from '../../storage-local/mediaStore';

/**
 * Stand-in identity until accounts exist (Milestone 3).
 *
 * A fixed local id rather than null: `createdBy` is not nullable, and every row
 * written this season should already carry an owner so the eventual account
 * migration is a remap rather than a backfill of unattributed data.
 */
export const LOCAL_USER_ID = '00000000-0000-7000-8000-000000000001' as UserId;

export interface SpotDraft {
  name: string;
  latitude: number;
  longitude: number;
  shootingBearing: number | null;
  accessClassification: AccessClassification;
  accessNotes: string | null;
  keyTimes: string[];
  tags: string[];
  shotSettings: ShotSetting[];
  /** What the position is good for. Never empty — see domain/spot.ts. */
  uses: SpotUse[];
}

export function useSpots(circuitId: CircuitId) {
  /**
   * The circuit to reload, read through a ref.
   *
   * `reload` is handed to callbacks that outlive the render they were made in.
   * Cloning is the case that exposed it: creating an event at another circuit
   * switches the venue and then writes the copies, and a `reload` closed over
   * the *previous* circuit re-read the wrong set — the copies existed on disk
   * and never appeared on the map.
   */
  const circuitRef = useRef(circuitId);
  circuitRef.current = circuitId;

  const [spots, setSpots] = useState<Spot[]>([]);
  const [media, setMedia] = useState<Record<string, Media[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await repositories.spots.listByCircuit(circuitRef.current);
    setSpots(rows);

    const bySpot: Record<string, Media[]> = {};
    for (const s of rows) {
      bySpot[s.id] = await repositories.media.listBySpot(s.id);
    }
    setMedia(bySpot);
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload, circuitId]);

  /**
   * Create a spot.
   *
   * `eventId` makes it the event's own. A spot added while planning belongs to
   * that event rather than to the permanent collection: the collection is what
   * you rely on at every future visit, and it should only grow when you mean
   * it to.
   */
  const create = useCallback(
    async (draft: SpotDraft, eventId: EventId | null = null) => {
      const spot = newSpot({
        circuitId,
        eventId,
        name: draft.name.trim() || 'Untitled spot',
        position: {
          latitude: draft.latitude,
          longitude: draft.longitude,
          elevation: null,
        },
        createdBy: LOCAL_USER_ID,
        shootingBearing: draft.shootingBearing,
        // Passed through explicitly. `newSpot` defaults to Unknown and there is
        // no code path that infers it — spec §0.1, §9.1.
        accessClassification: draft.accessClassification,
        accessNotes: draft.accessNotes,
        keyTimes: draft.keyTimes,
        tags: draft.tags,
        shotSettings: draft.shotSettings,
        uses: draft.uses,
      });
      await repositories.spots.save(spot);
      await reload();
      return spot;
    },
    [circuitId, reload],
  );

  const update = useCallback(
    async (id: SpotId, draft: SpotDraft) => {
      const existing = await repositories.spots.get(id);
      if (!existing) return;
      await repositories.spots.save({
        ...existing,
        name: draft.name.trim() || existing.name,
        position: {
          ...existing.position,
          latitude: draft.latitude,
          longitude: draft.longitude,
        },
        shootingBearing: draft.shootingBearing,
        accessClassification: draft.accessClassification,
        accessNotes: draft.accessNotes,
        keyTimes: draft.keyTimes,
        tags: draft.tags,
        shotSettings: draft.shotSettings,
        // Normalised on the way in as well as the way out: the editor cannot
        // untick the last box, but a draft assembled anywhere else could.
        uses: normaliseUses(draft.uses),
        updatedAt: nowUtc(),
      });
      await reload();
    },
    [reload],
  );

  /**
   * Reposition a spot, leaving everything else alone.
   *
   * Separate from `update` so moving a pin cannot accidentally overwrite the
   * name, tags or access classification with whatever a form last held.
   */
  const moveSpot = useCallback(
    async (id: SpotId, latitude: number, longitude: number) => {
      const existing = await repositories.spots.get(id);
      if (!existing) return;
      await repositories.spots.save({
        ...existing,
        position: { ...existing.position, latitude, longitude },
        updatedAt: nowUtc(),
      });
      await reload();
    },
    [reload],
  );

  /**
   * Hide or unhide a spot.
   *
   * Deliberately not a delete: the record is untouched and the pin simply
   * greys out and moves to its own tab in the list.
   */
  const setHidden = useCallback(
    async (id: SpotId, isHidden: boolean) => {
      const existing = await repositories.spots.get(id);
      if (!existing) return;
      await repositories.spots.save({ ...existing, isHidden, updatedAt: nowUtc() });
      await reload();
    },
    [reload],
  );

  /**
   * Record how a way of shooting turned out.
   *
   * Its own mutation rather than part of `update`, which takes a whole draft
   * from the edit form: a rating is a one-tap judgement made while looking at
   * the spot, and routing it through the form would mean reading every other
   * field back out and writing it again to change one number.
   */
  const rateSpot = useCallback(
    async (id: SpotId, rating: number | null) => {
      const existing = await repositories.spots.get(id);
      if (!existing) return;
      await repositories.spots.save({
        ...existing,
        // Clamped rather than trusted. Nothing in the UI can currently pass
        // anything else, but a stored 7 would quietly break every comparison
        // that assumes 1-5, and null must stay reachable as "unrated".
        rating:
          rating === null ? null : Math.max(1, Math.min(5, Math.round(rating))),
        updatedAt: nowUtc(),
      });
      await reload();
    },
    [reload],
  );

  /**
   * Add another way of shooting the place a spot is at.
   *
   * The new spot starts as a copy of the one it was added from, minus the
   * parts that are judgements about a photograph rather than facts about a
   * place. Position, access and notes carry over because they describe the
   * fence post and are true of every way of shooting from it; the bearing,
   * the camera settings and the rating do not, because those are precisely
   * what the new way exists to differ in. Copying them would present invented
   * settings as recorded ones.
   *
   * If the source is not in a group yet it is put in a new one first, so the
   * two end up as peers. The alternative — treating the original as a parent —
   * would make deleting it a question about the survivors.
   *
   * Returns the new spot so the caller can show it immediately; there is no
   * point adding a way and leaving the old one on screen.
   */
  const addWay = useCallback(
    async (id: SpotId) => {
      const source = await repositories.spots.get(id);
      if (!source) return null;

      const groupId = source.groupId ?? newId<SpotGroupId>();
      if (source.groupId === null) {
        await repositories.spots.save({ ...source, groupId, updatedAt: nowUtc() });
      }

      const created = newSpot({
        circuitId: source.circuitId,
        eventId: source.eventId,
        name: source.name,
        position: {
          latitude: source.position.latitude,
          longitude: source.position.longitude,
          elevation: source.position.elevation,
        },
        createdBy: LOCAL_USER_ID,
        accessClassification: source.accessClassification,
      });

      const way = {
        ...created,
        groupId,
        accessNotes: source.accessNotes,
        uses: source.uses,
        nearestMarshalPostId: source.nearestMarshalPostId,
      };

      await repositories.spots.save(way);
      await reload();
      return way;
    },
    [reload],
  );

  /** Tombstone, never a hard delete (§0.1). Undo restores it. */
  const remove = useCallback(
    async (id: SpotId) => {
      await repositories.spots.softDelete(id);
      await reload();
    },
    [reload],
  );

  const restore = useCallback(
    async (id: SpotId) => {
      await repositories.spots.restore(id);
      await reload();
    },
    [reload],
  );

  /**
   * Attach a reference photo.
   *
   * `metadataStripped` is passed in rather than assumed, because only the
   * picker knows. Native re-encodes every image and so strips EXIF — unless
   * the manipulator threw and it fell back to the original bytes; web hands
   * the file through untouched and never strips. Nothing may be served beyond
   * the device while the flag is false (§5.1, §9.4), so the default is false
   * and a caller has to state otherwise.
   */
  const addPhoto = useCallback(
    async (
      spotId: SpotId,
      file: Blob,
      referenceKind: ReferenceKind | null,
      isKeyImage = false,
      /**
       * The active event's `Event.tag`, or null with none active.
       *
       * Copied onto the row at capture time rather than resolved later from
       * `spotId` — see the note on `Media.tag`. The photo then stays
       * findable by "which weekend" independent of the event being hidden as
       * finished or tombstoned afterwards.
       */
      tag: string | null = null,
      /**
       * Whether these exact bytes are known to carry no EXIF. Defaults to
       * false: a caller that does not know must not claim they are clean.
       */
      metadataStripped = false,
    ) => {
      const key = await mediaStore.put(file, file.type || 'image/jpeg');
      const existing = await repositories.media.listBySpot(spotId);
      const at = nowUtc();

      // Exactly one key image per spot. Enforced on write rather than trusted
      // from the UI, because a second key would make the map tooltip's choice
      // arbitrary — whichever happened to sort first.
      if (isKeyImage) {
        for (const m of existing) {
          if (m.isKeyImage) {
            await repositories.media.save({ ...m, isKeyImage: false, updatedAt: at });
          }
        }
      }

      const row: Media = {
        id: newId<MediaId>(),
        ownerId: LOCAL_USER_ID,
        spotId,
        tag,
        type: MediaType.Photo,
        source: MediaSource.Uploaded,
        storageKey: key,
        externalUrl: null,
        referenceKind,
        isKeyImage,
        sortOrder: existing.length,
        capturedAt: null,
        capturedBearing: null,
        capturedPitch: null,
        visibility: Visibility.Private,
        metadataStripped,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        syncState: 'local',
      };

      await repositories.media.save(row);
      await reload();
    },
    [reload],
  );

  /** Promote an existing photo to the spot's key image. */
  const setKeyImage = useCallback(
    async (spotId: SpotId, mediaId: MediaId) => {
      const at = nowUtc();
      for (const m of await repositories.media.listBySpot(spotId)) {
        const shouldBeKey = m.id === mediaId;
        if (m.isKeyImage !== shouldBeKey) {
          await repositories.media.save({ ...m, isKeyImage: shouldBeKey, updatedAt: at });
        }
      }
      await reload();
    },
    [reload],
  );

  const removePhoto = useCallback(
    async (id: MediaId) => {
      await repositories.media.softDelete(id);
      await reload();
    },
    [reload],
  );

  /** GeoJSON for the map's `spots` source. */
  /**
   * One pin per place, not per way of shooting it.
   *
   * Members of a waypoint sit on the same fence post by definition, so drawing
   * a feature each would stack several pins on one point — which is both
   * unreadable and a lie about how many places there are to stand. The map
   * gets the waypoint; the carousel behind it holds the ways.
   *
   * The primary carries the pin, so tapping opens the oldest way and the
   * arrows reach the rest. Its own key image is preferred, falling back to any
   * member's: a waypoint whose first way was never photographed should still
   * show the picture that exists rather than an empty card.
   */
  const asGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: groupSpots(spots).map((w) => {
        const s = w.primary;
        const keyOf = (id: SpotId) =>
          (media[id] ?? []).find((m) => m.isKeyImage)?.storageKey ?? '';
        const key =
          keyOf(s.id) ||
          (w.members.map((m) => keyOf(m.id)).find((k) => k !== '') ?? '');

        return {
          type: 'Feature' as const,
          id: s.id,
          properties: {
            id: s.id,
            name: s.name,
            access: s.accessClassification,
            // Hidden only when every way is: hiding one way of shooting a
            // corner is not a decision to stop showing the corner.
            hidden: w.members.every((m) => m.isHidden) ? 1 : 0,
            notes: s.accessNotes ?? '',
            keyTimes: (s.keyTimes ?? []).join(' · '),
            tags: (s.tags ?? []).join(' · '),
            keyImageKey: key,
            /** How many ways of shooting this place — 1 for an ungrouped spot. */
            ways: w.members.length,
            /** Best rating across the ways, or 0 when none is rated. */
            rating: waypointRating(w) ?? 0,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [s.position.longitude, s.position.latitude],
          },
        };
      }),
    }),
    [spots, media],
  );

  /**
   * Copy a circuit's permanent spots into an event.
   *
   * Reads from the repository rather than from `spots` in state, so it works
   * for a circuit that is not on screen — creating a Spa event while looking at
   * the Nürburgring has to be able to seed from the Spa spots.
   */
  const cloneInto = useCallback(
    async (fromCircuit: CircuitId, eventId: EventId) => {
      const source = await repositories.spots.listByCircuit(fromCircuit);
      const copies = cloneSpotsForEvent(spotsForContext(source, null), eventId);
      for (const c of copies) await repositories.spots.save(c);
      await reload();
      return copies;
    },
    [reload],
  );

  return {
    cloneInto,
    spots,
    media,
    loading,
    create,
    update,
    moveSpot,
    setHidden,
    rateSpot,
    addWay,
    remove,
    restore,
    addPhoto,
    setKeyImage,
    removePhoto,
    asGeoJson,
    reload,
  };
}
