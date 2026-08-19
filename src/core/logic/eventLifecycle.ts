/**
 * Whether an event is "finished", and filtering a list around that.
 *
 * ── Derived, never stored ───────────────────────────────────────────────────
 * "Finished" is not a column on `Event`. A stored flag needs something to keep
 * it current — a background job ticking over every event at midnight, on a
 * device that may not even be running the app then — and the moment that job
 * misses a run, the flag is lying. `event.endDate` is already a fact the app
 * has; whether "now" is past it is a pure function of that fact and the
 * current moment, recomputed on every read for free. There is nothing to keep
 * in sync, so nothing can go stale.
 *
 * An event with no `endDate` is never finished by this rule — there is no
 * date to have passed, so nothing here guesses one. That matches `eventDays`
 * in `../domain/event.ts`, which treats a dateless event as "unscheduled
 * only" rather than inventing a range for it.
 *
 * ── What this unlocks: hide-finished as a view, not a mutation ──────────────
 * The events list wants a "show finished" toggle. Because finished-ness is
 * derived, that toggle is just which of two partitions the caller renders —
 * flipping it never touches a row, never fires a sync, and a device that has
 * been offline since before an event ended still gets the right answer the
 * instant it opens the list, with no reconciliation required.
 *
 * See `Event.tag` in `../domain/event.ts` for the other half of this: a
 * photo tagged with an event's `tag` stays findable by "which weekend"
 * regardless of which partition below the event currently falls into, or
 * whether it is tombstoned. Nothing in this file needs to know that — it is
 * exactly the point that hiding an event here has no bearing on it.
 */
import { parseIsoDate, type Event } from '../domain/event';

/**
 * Whether `event` counts as finished at `now`.
 *
 * Finished means "the day named by `endDate` has fully elapsed" — the event
 * is still current for the whole of its last day, so this only flips at the
 * *start* of the day after, not at some fixed hour within it. `endDate` is a
 * local calendar date (see `../domain/event.ts`), so this compares against
 * `now` read as local wall-clock time, matching every other place this app
 * parses those dates.
 *
 * `now` defaults to the real current time so ordinary call sites do not have
 * to thread a clock through, while tests can pin it exactly.
 */
export function isEventFinished(
  event: Pick<Event, 'endDate'>,
  now: Date = new Date(),
): boolean {
  if (!event.endDate) return false;
  const end = parseIsoDate(event.endDate);
  if (!end) return false;

  const dayAfterEnd = new Date(end);
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
  return now >= dayAfterEnd;
}

/** An event list split into what is still current and what has finished. */
export interface EventLifecyclePartition<T extends Pick<Event, 'endDate'>> {
  readonly active: T[];
  readonly finished: T[];
}

/**
 * Split `events` into active and finished, without discarding either.
 *
 * The primitive both the events list and any other caller (a count badge on
 * the "show finished" toggle, say — "3 finished") should build on, rather
 * than each re-deriving finished-ness with its own copy of the date math.
 *
 * Generic over anything with at least an `endDate`, so a screen holding a
 * lighter view-model than the full `Event` does not have to pad it out with
 * fields this decision does not use.
 */
export function partitionEventsByFinished<T extends Pick<Event, 'endDate'>>(
  events: readonly T[],
  now: Date = new Date(),
): EventLifecyclePartition<T> {
  const active: T[] = [];
  const finished: T[] = [];
  for (const event of events) {
    (isEventFinished(event, now) ? finished : active).push(event);
  }
  return { active, finished };
}

/**
 * `events`, filtered for display behind a "show finished" toggle.
 *
 * The direct helper for the toggle itself: off, a finished event simply is
 * not in the result, same as if it had never been entered; on, nothing is
 * held back. Built on `partitionEventsByFinished` rather than a second
 * filter, so the two can never disagree about which events count as
 * finished.
 */
export function visibleEvents<T extends Pick<Event, 'endDate'>>(
  events: readonly T[],
  options: { readonly showFinished: boolean; readonly now?: Date },
): T[] {
  if (options.showFinished) return [...events];
  return partitionEventsByFinished(events, options.now).active;
}
