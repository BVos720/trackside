/**
 * Session and event-day contracts — spec §2.3, §5.3.
 *
 * Same rules as the spot repositories: async throughout, ids supplied by the
 * caller, and no hard delete anywhere — `softDelete` tombstones (§0.1).
 */
import type { EventDay, Session } from '../domain/planning';
import type { CircuitId,
  EventId, EventDayId, SessionId } from '../domain/ids';

export interface IEventDayRepository {
  listByCircuit(circuitId: CircuitId): Promise<EventDay[]>;
  /**
   * Find an existing day for this circuit and date, or create one.
   *
   * Importing a multi-day timetable would otherwise produce a fresh EventDay
   * per run, quietly duplicating a whole weekend every time a schedule is
   * re-imported after a revision — and race timetables get revised constantly
   * (all three sample PDFs are V2 or V9).
   */
  ensure(
    circuitId: CircuitId,
    date: string,
    label: string | null,
    /** The event this day belongs to; null for days imported before events. */
    eventId: EventId | null,
  ): Promise<EventDay>;
  /**
   * Write a day with an id chosen by the caller.
   *
   * `ensure` mints its own id, which is right when a timetable is being
   * imported — the day is being discovered — and wrong when a backup is being
   * restored, where the id is part of what is being restored. Sessions
   * reference days by id, so letting `ensure` mint a fresh one would detach
   * every session in the file from the day it belongs to.
   */
  save(day: EventDay): Promise<void>;
  softDelete(id: EventDayId, at?: string): Promise<void>;
}

export interface ISessionRepository {
  listByEventDay(eventDayId: EventDayId): Promise<Session[]>;
  listByCircuit(circuitId: CircuitId): Promise<Session[]>;
  /**
   * Sessions for one event.
   *
   * The list a timetable screen actually wants: a weekend's running order, not
   * every session ever imported at that circuit.
   */
  listByEvent(eventId: EventId): Promise<Session[]>;
  save(session: Session): Promise<void>;
  softDelete(id: SessionId, at?: string): Promise<void>;
}
