/**
 * Repository contracts — spec §2.3.
 *
 * These live in `core/` and know nothing about storage. The rule from §2.3 is
 * "write the local implementation as though it were already remote", and these
 * signatures are what enforce it:
 *
 * • **Async everything, even locally.** `Promise<Spot>` for a synchronous
 *   SQLite read looks pointless today. It means the UI already handles latency
 *   and loading states on the day the call becomes a network hop, instead of
 *   needing every screen rewritten then.
 *
 * • **No `delete`.** There is `softDelete`, which sets a tombstone. Spec §0.1:
 *   a hard DELETE leaves nothing for a peer to reconcile against, so the row
 *   silently reappears on the next sync from any device that still has it.
 *   Adding a method here that issues `DELETE` breaks sync before sync exists.
 *
 * • **Ids come from the caller.** Entities arrive already carrying a
 *   client-generated UUID v7, because an offline device must be able to create
 *   a record without asking anything for an identity.
 */
import type { Media } from '../domain/media';
import type { Spot } from '../domain/spot';
import type { UserSpotNote } from '../domain/userSpotNote';
import type { CircuitId, MediaId, SpotId, UserId } from '../domain/ids';

export interface ISpotRepository {
  /** Every non-deleted spot at a circuit, newest first. */
  listByCircuit(circuitId: CircuitId): Promise<Spot[]>;
  get(id: SpotId): Promise<Spot | null>;
  /** Insert or replace. The caller supplies the id. */
  save(spot: Spot): Promise<void>;
  /**
   * Tombstone a spot. Never a hard delete — see the note above.
   *
   * Attached media is tombstoned with it, so a deleted spot does not leave
   * orphaned reference photos visible in a gallery.
   */
  softDelete(id: SpotId, at?: string): Promise<void>;
  /** Restore a tombstoned spot. Makes deletion undoable in the UI. */
  restore(id: SpotId): Promise<void>;
}

export interface IMediaRepository {
  listBySpot(spotId: SpotId): Promise<Media[]>;
  get(id: MediaId): Promise<Media | null>;
  save(media: Media): Promise<void>;
  softDelete(id: MediaId, at?: string): Promise<void>;
}

export interface IUserSpotNoteRepository {
  getForSpot(spotId: SpotId, userId: UserId): Promise<UserSpotNote | null>;
  save(note: UserSpotNote): Promise<void>;
  softDelete(id: string, at?: string): Promise<void>;
}

/**
 * The set of repositories the app resolves at startup.
 *
 * §2.3's "app/ — UI; DI selects implementations". The UI depends on this shape
 * and never on SQLite, so the day a sync target appears the screens do not
 * change.
 */
export interface RepositoryBundle {
  readonly spots: ISpotRepository;
  readonly media: IMediaRepository;
  readonly notes: IUserSpotNoteRepository;
}
