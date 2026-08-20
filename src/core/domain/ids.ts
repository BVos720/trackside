/**
 * Identity strategy — see spec §0.1 and §2.3.
 *
 * Every id in this application is a client-generated UUID v7. This is not a
 * preference; it is the constraint that makes offline record creation possible
 * at all. Two phones at Brünnchen with no signal must be able to create spots
 * independently and have those records merge later without collision. A
 * database identity column cannot do that, and the failure is unrecoverable:
 * retrofitting it means rewriting every foreign key in every row on every
 * device that ever synced.
 *
 * UUID v7 rather than v4 because v7 embeds a millisecond timestamp in its high
 * bits, so ids sort chronologically and B-tree index locality is preserved.
 * v4 scatters writes across the whole keyspace.
 *
 * If you find yourself writing `id: number`, stop.
 */
import { v7 as uuidv7 } from 'uuid';

/**
 * Branded id types.
 *
 * At runtime these are ordinary strings. At compile time the brand makes a
 * `SpotId` and a `CircuitId` mutually unassignable, so passing a circuit id
 * into a function expecting a spot id is a type error rather than a silent
 * lookup miss. Costs nothing at runtime.
 */
declare const brand: unique symbol;
type Branded<T extends string> = string & { readonly [brand]: T };

export type CircuitId = Branded<'CircuitId'>;
export type MarshalPostId = Branded<'MarshalPostId'>;
export type CircuitFeatureId = Branded<'CircuitFeatureId'>;
export type SpotId = Branded<'SpotId'>;
export type UserSpotNoteId = Branded<'UserSpotNoteId'>;
export type MediaId = Branded<'MediaId'>;
export type WalkEdgeId = Branded<'WalkEdgeId'>;
export type SessionId = Branded<'SessionId'>;
export type EventDayId = Branded<'EventDayId'>;
export type EventId = Branded<'EventId'>;
export type EntryId = Branded<'EntryId'>;
export type PlanId = Branded<'PlanId'>;
export type PlanStopId = Branded<'PlanStopId'>;
export type UserGearItemId = Branded<'UserGearItemId'>;
export type UserId = Branded<'UserId'>;

/** Any branded id, for code that is generic over entity type. */
export type EntityId =
  | CircuitId
  | MarshalPostId
  | CircuitFeatureId
  | SpotId
  | UserSpotNoteId
  | MediaId
  | WalkEdgeId
  | SessionId
  | EventDayId
  | EventId
  | EntryId
  | PlanId
  | PlanStopId
  | UserGearItemId
  | UserId;

/**
 * Mint a new time-ordered id.
 *
 * The type parameter is supplied by the caller at the point of creation:
 *   const id = newId<SpotId>();
 */
export function newId<T extends EntityId>(): T {
  return uuidv7() as T;
}

/** Reattach a brand to a string that came from storage or the network. */
export function asId<T extends EntityId>(value: string): T {
  return value as T;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True if `value` is a syntactically valid UUID of any version. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** True if `value` is specifically a v7 UUID. */
export function isUuidV7(value: string): boolean {
  const match = UUID_PATTERN.exec(value);
  return match !== null && match[1] === '7';
}

/**
 * Read the embedded creation timestamp out of a v7 id.
 *
 * The first 48 bits are Unix epoch milliseconds. Useful for diagnostics and
 * for ordering records whose `createdAt` was never written, but note this is
 * the id-minting clock on whichever device created the record — an unsynced
 * phone with a wrong clock produces a wrong value here. Do not treat it as
 * authoritative; `createdAt` is the field of record.
 */
export function timestampFromUuidV7(value: string): Date | null {
  if (!isUuidV7(value)) return null;
  const hex = value.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}
