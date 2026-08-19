/**
 * Event contracts — spec §2.3.
 *
 * Async throughout, caller-supplied ids, tombstones only (§0.1).
 */
import type { Event, PlanStop } from '../domain/event';
import type { CircuitId, EventId, SpotId } from '../domain/ids';

export interface IEventRepository {
  listByCircuit(circuitId: CircuitId): Promise<Event[]>;
  /**
   * Every event, across circuits.
   *
   * An event belongs to one circuit, but the *list* of them does not: you plan
   * a season, and picking "Spa Six Hours" while looking at the Nürburgring is a
   * normal thing to do. Filtering by the circuit you happen to be looking at
   * would hide the event you are trying to switch to.
   */
  listAll(): Promise<Event[]>;
  /**
   * Every event including tombstoned ones.
   *
   * Only import needs this, and it needs it badly: restoring a bundle whose
   * event was deleted locally is a resurrection, and §0.1 makes a tombstone a
   * record rather than an absence. Reading through `listAll` would report the
   * slot as empty and bring the event back without ever saying so.
   *
   * Not for display — everything on screen reads the live list.
   */
  listAllIncludingDeleted(): Promise<Event[]>;
  get(id: EventId): Promise<Event | null>;
  save(event: Event): Promise<void>;
  softDelete(id: EventId, at?: string): Promise<void>;
  /** Add or remove a spot reference. Idempotent in both directions. */
  setSpotIncluded(id: EventId, spotId: SpotId, included: boolean): Promise<void>;

  /**
   * Append a stop to the route.
   *
   * Adding a stop also puts its spot in the event, because scheduling somewhere
   * you have not selected is a state with no meaning. The reverse does not
   * hold: removing a stop leaves the spot in the event, since dropping it from
   * the plan is not the same as deciding it is not worth shooting.
   */
  addStop(id: EventId, stop: PlanStop): Promise<void>;
  updateStop(
    id: EventId,
    stopId: string,
    patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>,
  ): Promise<void>;
  removeStop(id: EventId, stopId: string): Promise<void>;
  /** Move a stop within the route. Out-of-range indices are clamped. */
  moveStop(id: EventId, stopId: string, toIndex: number): Promise<void>;
}
