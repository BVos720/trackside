/**
 * Session and event-day contracts — spec §2.3, §5.3.
 *
 * Same rules as the spot repositories: async throughout, ids supplied by the
 * caller, and no hard delete anywhere — `softDelete` tombstones (§0.1).
 */
import type { EventDay, Session } from '../domain/planning';
import type { CircuitId, EventDayId, SessionId } from '../domain/ids';

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
  ensure(circuitId: CircuitId, date: string, label: string | null): Promise<EventDay>;
  softDelete(id: EventDayId, at?: string): Promise<void>;
}

export interface ISessionRepository {
  listByEventDay(eventDayId: EventDayId): Promise<Session[]>;
  listByCircuit(circuitId: CircuitId): Promise<Session[]>;
  save(session: Session): Promise<void>;
  softDelete(id: SessionId, at?: string): Promise<void>;
}
