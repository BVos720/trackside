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
  type UserGearItemId,
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
  /**
   * Gear carried for this event, by id — references into the user's standing
   * locker (`../domain/gear.ts`), never copies.
   *
   * Decided 22 August (`TASKS-profile.md`, "Open questions"): gear attaches to
   * the *event*, not to a `PlanStop`. "This weekend I am carrying these two
   * bodies" is the whole ask; "at Brünnchen, the 500mm" is a different,
   * more valuable feature left for later if it turns out to matter. Same
   * skip-on-miss behaviour as `spotIds`: an id whose `GearItem` was deleted is
   * simply not shown, never pruned here, so a restored item reappears.
   */
  readonly gearItemIds: readonly UserGearItemId[];
  readonly createdBy: UserId;
  /**
   * A stable label for this weekend, generated once at creation.
   *
   * Meant to be stamped onto every photo taken at the event (a later pass —
   * `Media` does not carry it yet) so a shot stays filterable by "which
   * weekend" long after the event itself stops showing up in the events list.
   * Two things can hide an event without touching this tag at all: it can be
   * derived as finished (see `isEventFinished` in `../logic/eventLifecycle`,
   * which never stores that fact — nothing to keep current, nothing to go
   * stale) and folded out of view by the show-finished toggle, or it can be
   * tombstoned via `deletedAt` (§0.1 — always a soft delete, never gone for
   * good). Neither state destroys the event record. But a photo that only
   * carried a live `EventId` would still need every place that lists photos
   * to know how to look the event back up and reason about both of those
   * states just to answer "which weekend was this shot at". A tag copied onto
   * the photo at capture time answers that on its own, with no join back to
   * this row required.
   *
   * Derived from `name` at creation and never recomputed afterwards —
   * deliberately not a getter. Renaming the event later must not retag every
   * photo already shot under the old name; someone filtering their camera
   * roll for "NLS10" months on should still find those shots even if the
   * event was renamed to "NLS10 (rain-delayed)" afterwards.
   *
   * Shaped like `bundleFileName` in `../logic/eventBundle.ts` for the same
   * reason that function is shaped this way — human-readable, but
   * disambiguated by the tail of the id rather than its head, because a UUID
   * v7's leading characters are a shared millisecond timestamp and two events
   * made back to back would otherwise tag identically.
   */
  readonly tag: string;
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
  gearItemIds?: readonly UserGearItemId[];
  at?: Utc;
}): Event {
  const id = newId<EventId>();
  return {
    id,
    circuitId: input.circuitId,
    name: input.name,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    notes: input.notes ?? null,
    spotIds: input.spotIds ?? [],
    stops: input.stops ?? [],
    gearItemIds: input.gearItemIds ?? [],
    createdBy: input.createdBy,
    tag: newEventTag(input.name, id),
    ...newEntityBase(input.at),
  };
}

/**
 * Build the stable per-event tag described on `Event.tag`.
 *
 * Exported (rather than kept private to `newEvent`) so a caller reconstructing
 * an event from an older record that predates this field — an imported bundle
 * written before today, say — can derive the same shape rather than leaving
 * `tag` empty.
 */
export function newEventTag(name: string, id: EventId): string {
  const slug = name
    .normalize('NFD')
    // Strip combining marks so "Nürburgring" becomes "Nurburgring" rather than
    // losing the letter entirely — same reasoning as bundleFileName's slug.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase();

  // The *tail* of the id, not the head — see the note on `Event.tag`.
  const short = id.slice(-8);
  return `${slug === '' ? 'event' : slug}-${short}`;
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

/**
 * Local `YYYY-MM-DD` → Date at local midnight, or null.
 *
 * Exported so `../logic/eventLifecycle.ts` can parse `endDate` the same way
 * `eventDays` does here, rather than growing a second, subtly different
 * parser for the same field.
 */
export function parseIsoDate(iso: string): Date | null {
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
