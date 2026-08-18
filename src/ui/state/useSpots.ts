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
  type Spot,
  newSpot,
} from '../../core/domain/spot';
import {
  type CircuitId,
  type EventId,
  type MediaId,
  type SpotId,
  type UserId,
  newId,
} from '../../core/domain/ids';
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
   * `metadataStripped` is false: the bytes are exactly what the user picked.
   * Nothing may serve this beyond the device until a strip pass has run
   * (§5.1, §9.4), and the flag is what a future share path checks.
   */
  const addPhoto = useCallback(
    async (
      spotId: SpotId,
      file: Blob,
      referenceKind: ReferenceKind | null,
      isKeyImage = false,
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
        metadataStripped: false,
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
  const asGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: spots.map((s) => ({
        type: 'Feature' as const,
        id: s.id,
        properties: {
          id: s.id,
          name: s.name,
          access: s.accessClassification,
          hidden: s.isHidden ? 1 : 0,
          notes: s.accessNotes ?? '',
          keyTimes: (s.keyTimes ?? []).join(' · '),
          tags: (s.tags ?? []).join(' · '),
          keyImageKey:
            (media[s.id] ?? []).find((m) => m.isKeyImage)?.storageKey ?? '',
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [s.position.longitude, s.position.latitude],
        },
      })),
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
    remove,
    restore,
    addPhoto,
    setKeyImage,
    removePhoto,
    asGeoJson,
    reload,
  };
}
