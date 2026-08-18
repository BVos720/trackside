/**
 * Event days, sessions, and day plans — spec §4.1, §5.4, §5.17.
 */
import type { EntityBase, Utc, Visibility } from './common';
import type {
  CircuitId,
  EventDayId,
  PlanId,
  PlanStopId,
  SessionId,
  SpotId,
  UserId,
} from './ids';

/** A single day at a circuit. */
export interface EventDay extends EntityBase {
  readonly id: EventDayId;
  readonly circuitId: CircuitId;
  /** Calendar date at the circuit, `YYYY-MM-DD` in the circuit's timezone. */
  readonly date: string;
  /** Timetable document this day's sessions were parsed from (§5.3). */
  readonly sourceDocumentId: string | null;
  readonly label: string | null;
}

export const SessionKind = {
  Practice: 'practice',
  Qualifying: 'qualifying',
  Race: 'race',
  PitlaneWalk: 'pitlaneWalk',
  Support: 'support',
} as const;
export type SessionKind = (typeof SessionKind)[keyof typeof SessionKind];

/**
 * A timetabled track session.
 *
 * Entered by hand in Milestone 1; parsed from an uploaded PDF in Milestone 2
 * (§5.3). Either way the parsed result is always presented for confirmation
 * before it is committed — extraction is never trusted silently.
 */
export interface Session extends EntityBase {
  readonly id: SessionId;
  readonly eventDayId: EventDayId;
  readonly seriesName: string;
  readonly className: string | null;
  readonly kind: SessionKind;
  readonly startTime: Utc;
  readonly endTime: Utc;
  /**
   * Whether this session runs in darkness.
   *
   * Not derived from `startTime` against sunset here, deliberately: an
   * organiser's definition of a night session is a scheduling fact, not an
   * astronomical one, and the two disagree at the edges of the season.
   */
  readonly isNight: boolean;
}

/** A photographer's plan for one event day. */
export interface Plan extends EntityBase {
  readonly id: PlanId;
  readonly eventDayId: EventDayId;
  readonly userId: UserId;
  readonly name: string;
  readonly visibility: Visibility;
}

/**
 * One stop in a plan: be at this spot between these times.
 *
 * Spec §4.2 — a photo plan is a set of stops and a video plan is a path, and
 * both are expressible over the same `WalkEdge` graph. Nothing here assumes
 * which one is being built.
 */
export interface PlanStop extends EntityBase {
  readonly id: PlanStopId;
  readonly planId: PlanId;
  readonly spotId: SpotId;
  readonly arrivalTime: Utc;
  readonly departureTime: Utc;
  /** Sessions this stop is intended to catch. */
  readonly targetSessionIds: readonly SessionId[];
  readonly notes: string | null;
  /** Position in the day. Stops are ordered, not merely timestamped. */
  readonly sequence: number;
}
