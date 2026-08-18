/**
 * Cross-cutting field contracts every persisted entity obeys — see spec §2.3.
 *
 * These four things exist on every row from the first commit, long before
 * anything reads them, because adding them later is a migration against data
 * that is already spread across devices:
 *
 *   1. ids are client-generated UUID v7        (see ./ids.ts)
 *   2. createdAt / updatedAt / deletedAt, UTC
 *   3. syncState
 *   4. plain latitude/longitude doubles, no spatial types
 */

/**
 * An ISO 8601 instant, always UTC, always with the trailing `Z`.
 *
 * Branded so a local-time string cannot be assigned by accident. This matters
 * more than it looks: this app is used across NL/BE/DE/FR, spans a DST
 * boundary mid-season, and will eventually reconcile records written on
 * devices in different zones. Every stored instant is UTC; timezone is applied
 * at the presentation edge only, using the circuit's own `timezone` field.
 *
 * Stored as TEXT in SQLite. ISO 8601 UTC with fixed-width fields sorts
 * correctly under plain lexicographic comparison, so ORDER BY and range
 * queries work without conversion.
 */
export type Utc = string & { readonly __utc: unique symbol };

/** Current instant as a `Utc`. */
export function nowUtc(): Utc {
  return new Date().toISOString() as Utc;
}

/** Convert a `Date` to a `Utc`. */
export function toUtc(date: Date): Utc {
  return date.toISOString() as Utc;
}

/** Parse a `Utc` back to a `Date`. */
export function fromUtc(value: Utc): Date {
  return new Date(value);
}

/** Reattach the brand to a string from storage or the network. */
export function asUtc(value: string): Utc {
  return value as Utc;
}

/**
 * Whether a record has made it to the server yet.
 *
 * Nothing reads this during Milestone 1 — there is no server. It exists now
 * so that every row written this season already carries the column when the
 * backend arrives in Milestone 3, rather than needing a backfill across
 * devices that may not check in for months.
 *
 * `Conflict` is deliberately part of the vocabulary from the start, but no
 * conflict *resolution* is implemented here. Per spec §0.1 the reconciliation
 * strategy is human-authored; this enum only records that a conflict was
 * observed, never how to settle it.
 */
export const SyncState = {
  /** Created on this device, never sent. */
  Local: 'local',
  /** Queued for the next sync attempt. */
  Pending: 'pending',
  /** Server has acknowledged this version. */
  Synced: 'synced',
  /** Local and remote diverged. Requires human-defined resolution. */
  Conflict: 'conflict',
} as const;
export type SyncState = (typeof SyncState)[keyof typeof SyncState];

/**
 * Who may see a user-owned row.
 *
 * Present on every user-owned entity from day one per spec §4.2. Retrofitting
 * a visibility column is both a migration problem and a leak risk: the window
 * between "column added" and "column correctly populated" is one where private
 * data is served publicly.
 *
 * Note the default is always the most private value the entity supports.
 * Nothing in this codebase may widen visibility without an explicit user
 * action.
 */
export const Visibility = {
  Private: 'private',
  Followers: 'followers',
  Public: 'public',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

/** Fields carried by every persisted entity. */
export interface EntityBase {
  readonly createdAt: Utc;
  readonly updatedAt: Utc;
  /**
   * Tombstone marker. Non-null means deleted.
   *
   * Per spec §0.1: deletion is always a soft delete. A row removed with SQL
   * DELETE leaves no trace for a peer to reconcile against, so the record
   * silently reappears on the next sync from any device that still has it.
   * The repository layer has no method that issues a hard DELETE.
   */
  readonly deletedAt: Utc | null;
  readonly syncState: SyncState;
}

/** Freshly-created entity metadata. */
export function newEntityBase(at: Utc = nowUtc()): EntityBase {
  return {
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    syncState: SyncState.Local,
  };
}

/** True if the entity has been tombstoned. */
export function isDeleted(entity: Pick<EntityBase, 'deletedAt'>): boolean {
  return entity.deletedAt !== null;
}

/**
 * A geographic position.
 *
 * Plain doubles, deliberately — spec §2.3 constraint 4. No PostGIS geometry
 * type reaches the domain layer even after the backend exists. Distance work
 * is done with haversine in application code (see ../logic/geo.ts); PostGIS
 * stays server-side where spatial indexes actually earn their keep.
 */
export interface LatLon {
  readonly latitude: number;
  readonly longitude: number;
}

/** A position with a known ground elevation in metres above sea level. */
export interface LatLonElevation extends LatLon {
  readonly elevation: number | null;
}

/** An axis-aligned geographic bounding box. */
export interface BoundingBox {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}
