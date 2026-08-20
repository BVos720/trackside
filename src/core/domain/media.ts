/**
 * Media — spec §4.1, §2.4, §5.1, §5.9, §9.4.
 *
 * Polymorphic from the first migration. There is deliberately no `Photo`
 * entity: video arrives in §5.9 with different hosting rules, and splitting a
 * `photos` table after it has synced to devices is a migration nobody wants to
 * write. One table, discriminated by `type`.
 */
import type { EntityBase, Utc, Visibility } from './common';
import type { MediaId, SpotId, UserId } from './ids';

export const MediaType = {
  Photo: 'photo',
  Video: 'video',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const MediaSource = {
  /** Bytes we hold, addressed through IMediaStore. */
  Uploaded: 'uploaded',
  /** A YouTube/Vimeo/Instagram URL we merely point at. */
  Embedded: 'embedded',
} as const;
export type MediaSource = (typeof MediaSource)[keyof typeof MediaSource];

/**
 * What a reference image is *for* — spec §5.1.
 *
 * Reference imagery is a different concept from portfolio imagery, and
 * conflating them is the most common way this kind of app becomes useless in
 * the field. A portfolio shot proves what is *possible* from a position. A
 * reference shot shows *where to stand*: the fence line, the gap, which side
 * of the path, where the marshal post is. At 06:40 in the dark looking for a
 * spot, only the second one helps.
 *
 * `null` means portfolio or uncategorised — the shot, not the direction.
 */
export const ReferenceKind = {
  /** Wide shot showing how to find the position from the path. */
  Approach: 'approach',
  /** The view from the position itself. */
  View: 'view',
  /** Something that needs flagging before someone walks into it. */
  Hazard: 'hazard',
} as const;
export type ReferenceKind = (typeof ReferenceKind)[keyof typeof ReferenceKind];

/**
 * A photo or video associated with a spot.
 *
 * ── Storage rule, spec §2.4 ────────────────────────────────────────────────
 * This record holds a *reference*, never bytes. No column here is a BLOB.
 * Putting media in the database is very hard to undo and becomes fatal once
 * video is involved. Bytes live behind `IMediaStore`: the local filesystem
 * now, object storage later, with this row unchanged either way.
 */
export interface Media extends EntityBase {
  readonly id: MediaId;
  readonly ownerId: UserId;
  readonly spotId: SpotId | null;
  /**
   * The event that was active when this was captured, copied from
   * `Event.tag` at creation time — see the note there.
   *
   * Stamped once and never recomputed: an event can be hidden by
   * `isEventFinished` or tombstoned via `deletedAt` without either state
   * destroying the record, but a photo that only carried a live `EventId`
   * would need every reader to resolve it and reason about both. This answers
   * "which weekend" on its own. Null for anything shot with no event active,
   * and for every row written before this field existed — see
   * `normaliseMedia` in `storage-local/repositories/documentRepositories.ts`.
   */
  readonly tag: string | null;
  readonly type: MediaType;
  readonly source: MediaSource;
  /**
   * Opaque key resolved by `IMediaStore` when `source` is `uploaded`.
   * Never a raw absolute device path — those do not survive an app reinstall,
   * an OS upgrade, or the eventual move to object storage.
   */
  readonly storageKey: string | null;
  /** External player URL when `source` is `embedded`. */
  readonly externalUrl: string | null;
  readonly referenceKind: ReferenceKind | null;
  /**
   * The one shot that shows what this spot can produce — spec §5.1.
   *
   * §5.1 separates reference imagery from portfolio imagery: a reference shot
   * shows *where to stand*, a portfolio shot proves *what is possible*. The
   * three `referenceKind` values cover the first. This flag covers the second,
   * and is deliberately not a fourth `referenceKind` — that enum answers "what
   * is this reference for", and a hero image is not a reference at all.
   *
   * Exactly one per spot. It is what the map tooltip shows, so it should be the
   * best frame taken there with a given technique, not merely the first upload.
   */
  readonly isKeyImage: boolean;
  /** Ordering within a spot's reference set. */
  readonly sortOrder: number;
  readonly capturedAt: Utc | null;
  /** Compass bearing at capture, degrees true. Feeds `Spot.shootingBearing`. */
  readonly capturedBearing: number | null;
  /** Device pitch at capture, degrees from horizontal. */
  readonly capturedPitch: number | null;
  readonly visibility: Visibility;
  /**
   * Whether identifying metadata has been stripped from the stored derivative.
   *
   * Spec §5.1 and §9.4: reference photos are the largest privacy leak surface
   * in this application. They are geotagged, timestamped, and frequently taken
   * in places the photographer would rather not advertise to strangers.
   *
   * The rule is: parse EXIF on import to help place the pin, keep the untouched
   * original in local-only storage, and strip everything before any byte is
   * exposed beyond the device. This flag records that the strip has happened —
   * nothing may be served publicly while it is false.
   */
  readonly metadataStripped: boolean;
}

/**
 * Byte storage, abstracted away from the database — spec §2.4.
 *
 * Local filesystem in Milestone 1, object storage (S3/R2) later, with no change
 * to any calling code. Async throughout, including the local implementation,
 * per spec §2.3 constraint 2: the UI must already handle latency and loading
 * states before the call ever becomes a network hop.
 */
export interface IMediaStore {
  /** Resolve a storage key to something renderable. */
  getUri(key: string): Promise<string | null>;
  /** Open the bytes for reading. */
  openRead(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Persist bytes and return the key to store on the `Media` row. */
  put(bytes: Uint8Array, contentType: string): Promise<string>;
  /** Remove bytes. Distinct from tombstoning the `Media` row. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
