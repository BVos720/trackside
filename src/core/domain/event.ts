/**
 * Events — a planning context over a circuit's spots.
 *
 * An event is a named working set: "NLS10, October", "Spa Six Hours". You pick
 * which spots are in play, plan against those, and leave the rest out of the
 * way. The default map is the absence of an event — every spot you have at that
 * circuit.
 *
 * ── An event holds references, never copies ────────────────────────────────
 * Spec §4.2 calls the Spot / UserSpotNote split non-negotiable, because two
 * hundred photographers each creating their own pin at Brünnchen makes the map
 * unreadable. Copying spots into an event recreates that failure one level
 * down: four events at the Nürburgring would mean four Brünnchen pins, and
 * fixing a wrong coordinate would mean fixing it four times.
 *
 * So "import my spots" copies the id list, not the spots. A spot edited
 * anywhere is edited everywhere, which is what you want — the position is a
 * fact about the circuit, and which event you are planning does not change it.
 *
 * A spot created while an event is active is added to that event *and* remains
 * in your default collection. It is a real place you found; it does not stop
 * existing when the weekend ends.
 *
 * ── Membership and route are different things ──────────────────────────────
 * `spotIds` is what is in play. `stops` is the order you intend to walk them,
 * with times. A spot can be in the event without being scheduled — that is the
 * normal state of a shortlist — so importing spots must not fabricate a route
 * through them, and removing a stop must not throw the spot out of the event.
 */
import type { EntityBase, Utc } from './common';
import { newEntityBase } from './common';
import {
  type CircuitId,
  type EventId,
  type SessionId,
  type SpotId,
  type UserId,
  newId,
} from './ids';

/**
 * One scheduled stop on the event's route.
 *
 * `arriveAt` is when you want to be *standing there ready*, not when you set
 * off — the walk is computed backwards from it, because "be at Brünnchen before
 * the GT3s come through" is the actual constraint and departure is derived.
 */
export interface PlanStop {
  /** Stable key across reorders. Not the spot id: a spot may appear twice. */
  readonly id: string;
  readonly spotId: SpotId;
  /**
   * Which day of the event, `YYYY-MM-DD`. Null means unscheduled — the stop is
   * on the list but not yet placed on a day.
   */
  readonly day: string | null;
  /** Local `HH:MM` you want to be in position. Null means untimed. */
  readonly arriveAt: string | null;
  /** What you are there for — "Racing legends race 1". Free text. */
  readonly label: string | null;
  /**
   * The parsed timetable session this stop is for, when there is one.
   *
   * Kept alongside `label` rather than replacing it: a session id only exists
   * once a timetable has been imported, and plans get made before the timetable
   * is published. The id is the better fact when present, because a session
   * that moves takes the stop with it.
   */
  readonly sessionId: SessionId | null;
}

export interface Event extends EntityBase {
  readonly id: EventId;
  readonly circuitId: CircuitId;
  readonly name: string;
  /**
   * Event dates, local `YYYY-MM-DD`.
   *
   * Real dates rather than the free text this used to be: the planner needs to
   * put stops on days, and the light calculations need a date to compute a sun
   * position for. "10–11 October" answers neither, and loses the year entirely.
   */
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly notes: string | null;
  /**
   * Spots in play for this event, by id.
   *
   * References into the circuit's spots. An id that no longer resolves — its
   * spot was deleted — is simply skipped when reading, rather than being
   * cleaned up eagerly: tombstones can come back (§0.1 `restore`), and pruning
   * the reference would lose the association permanently.
   */
  readonly spotIds: readonly SpotId[];
  /** The planned route, in order. See the note at the top of this file. */
  readonly stops: readonly PlanStop[];
  readonly createdBy: UserId;
}

export function newEvent(input: {
  circuitId: CircuitId;
  name: string;
  createdBy: UserId;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  spotIds?: readonly SpotId[];
  stops?: readonly PlanStop[];
  at?: Utc;
}): Event {
  return {
    id: newId<EventId>(),
    circuitId: input.circuitId,
    name: input.name,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    notes: input.notes ?? null,
    spotIds: input.spotIds ?? [],
    stops: input.stops ?? [],
    createdBy: input.createdBy,
    ...newEntityBase(input.at),
  };
}

/**
 * A new stop.
 *
 * The id is a plain random string rather than a UUID v7: it is a key within one
 * event's array, never a row id, never synced on its own. §0.1's identity rule
 * is about records two offline devices could each mint — this is not one.
 */
export function newPlanStop(input: {
  spotId: SpotId;
  day?: string | null;
  arriveAt?: string | null;
  label?: string | null;
  sessionId?: SessionId | null;
}): PlanStop {
  return {
    id: `stop_${Math.random().toString(36).slice(2, 10)}`,
    spotId: input.spotId,
    day: input.day ?? null,
    arriveAt: input.arriveAt ?? null,
    label: input.label ?? null,
    sessionId: input.sessionId ?? null,
  };
}

/** Local `YYYY-MM-DD` → Date at local midnight, or null. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Event days as ISO dates, both ends inclusive.
 *
 * Empty when no dates are set, which the planner reads as "unscheduled only".
 * Capped so a mistyped year cannot spin out a list of ten thousand days.
 */
export function eventDays(event: Event): string[] {
  if (!event.startDate) return [];
  const days: string[] = [event.startDate];
  if (!event.endDate || event.endDate <= event.startDate) return days;

  const start = parseIsoDate(event.startDate);
  const end = parseIsoDate(event.endDate);
  if (!start || !end) return days;

  const MAX_DAYS = 31;
  const cursor = new Date(start);
  while (days.length < MAX_DAYS) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor > end) break;
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    days.push(`${cursor.getFullYear()}-${m}-${d}`);
  }
  return days;
}
