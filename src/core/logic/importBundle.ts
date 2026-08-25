/**
 * Reading an event bundle back into the app.
 *
 * Writing a bundle is easy: serialise what is in memory. Reading one is not,
 * because the file and the database can disagree about the same record, and
 * every way of resolving that disagreement silently is a way of losing data.
 *
 * ── Two modes, chosen by the user, never guessed ──────────────────────────
 * **Restore** keeps the ids in the file. This is the true restore — after a
 * reinstall, or after deleting an event by mistake. The records come back as
 * themselves, and nothing is duplicated.
 *
 * **Copy** remints every id and rewrites every reference. This is "open someone
 * else's weekend" or "keep both versions". The result is a new event that
 * shares nothing with the original.
 *
 * Which one is right depends on why the file is being opened, and the app
 * cannot know that. So `inspectBundle` reports what a restore would hit and the
 * UI asks. The one thing never done is picking silently: a restore that
 * quietly overwrites, or a copy that quietly duplicates, both look like success
 * until the day you go looking for what you lost.
 *
 * ── Why copy mode is more than "give everything a new id" ─────────────────
 * An event refers to its spots three times over — `spotIds`, `stops[].spotId`,
 * and via sessions on `stops[].sessionId` — and its sessions refer to days.
 * Reminting ids without rewriting all of that produces an event whose plan
 * points at nothing: it imports cleanly, shows the right spot count, and has an
 * empty route. That failure is the whole reason this module exists rather than
 * an object spread at the call site.
 */
import { newEntityBase, nowUtc } from '../domain/common';
import type { Entry } from '../domain/entry';
import type { Event, PlanStop } from '../domain/event';
import {
  newId,
  type EntryId,
  type EventDayId,
  type EventId,
  type SessionId,
  type SpotId,
} from '../domain/ids';
import type { EventDay, Session } from '../domain/planning';
import type { Spot } from '../domain/spot';
import type { EventBundle } from './eventBundle';

export type ImportMode = 'restore' | 'copy';

/**
 * The bundle's entries, defaulted at the read boundary.
 *
 * `EventBundle.entries` is not optional in the type, but a file written before
 * entry lists existed has no such key, and `planImport` is reachable with a
 * bundle that did not come through `readEventBundle`'s defaulting. Reading
 * `.map` off `undefined` there takes the whole import down on the one file
 * most likely to be old — a backup from before the feature shipped, which is
 * exactly when a restore matters.
 *
 * Defaulted here rather than at each use, for the reason `normaliseSpot` gives:
 * a `?? []` at every call site has to be remembered at every new one, and is
 * only ever noticed once it has already crashed.
 */
function entriesOf(bundle: EventBundle): readonly Entry[] {
  return bundle.entries ?? [];
}

/**
 * What a restore of this bundle would run into locally.
 *
 * `deleted` is called out separately from `live` because restoring over a
 * tombstone resurrects a record the user deliberately deleted (§0.1 treats a
 * tombstone as a record, not an absence). That may well be exactly what they
 * want — it is the main reason to keep backups — but it has to be a decision
 * they make knowingly.
 */
export type ImportConflict =
  | { readonly kind: 'none' }
  | { readonly kind: 'live'; readonly localName: string }
  | { readonly kind: 'deleted'; readonly localName: string };

/** Everything already in the app, tombstones included. */
export interface LocalState {
  readonly events: readonly Event[];
  readonly spots: readonly Spot[];
}

export interface ImportPlan {
  readonly mode: ImportMode;
  readonly event: Event;
  readonly spots: readonly Spot[];
  readonly days: readonly EventDay[];
  readonly sessions: readonly Session[];
  readonly entries: readonly Entry[];
  /**
   * Things the user should be told before committing.
   *
   * Populated for anything dropped, skipped or invented. An import that quietly
   * discards half a plan is the failure this whole module is built to avoid, so
   * every such decision leaves a trace here for the UI to show.
   */
  readonly warnings: readonly string[];
}

/**
 * What restoring this bundle would collide with.
 *
 * Tombstoned events are found too — that is the point. `local.events` must
 * therefore include deleted rows, or a restore over a deleted event reports
 * "none" and resurrects it without asking.
 */
export function inspectBundle(
  bundle: EventBundle,
  local: LocalState,
): ImportConflict {
  const existing = local.events.find((e) => e.id === bundle.event.id);
  if (!existing) return { kind: 'none' };

  return existing.deletedAt === null
    ? { kind: 'live', localName: existing.name }
    : { kind: 'deleted', localName: existing.name };
}

/**
 * Spots in the bundle that a restore must not touch.
 *
 * A restore writes the bundle's spots over whatever shares their ids. That is
 * correct when the local record is the same event's own copy — which is the
 * only case that can arise from a bundle this app wrote, since event spots are
 * clones with freshly minted ids (see cloneSpots.ts).
 *
 * It is not correct if the id resolves to a spot belonging to somewhere else:
 * a home-map spot, or another event's. Overwriting that would drag a spot out
 * of the permanent collection and into an imported event — exactly the failure
 * cloning was introduced to prevent, arriving through a different door. Those
 * are skipped and reported rather than written.
 */
function conflictingSpotIds(
  bundle: EventBundle,
  local: LocalState,
): Set<string> {
  const out = new Set<string>();
  const byId = new Map(local.spots.map((s) => [s.id as string, s]));

  for (const spot of bundle.spots) {
    const existing = byId.get(spot.id as string);
    if (!existing) continue;
    if ((existing.eventId ?? null) !== (bundle.event.id as string | null)) {
      out.add(spot.id as string);
    }
  }
  return out;
}

/** Restore: the records as they were, with the tombstone cleared. */
function planRestore(bundle: EventBundle, local: LocalState): ImportPlan {
  const warnings: string[] = [];
  const at = nowUtc();

  const blocked = conflictingSpotIds(bundle, local);
  if (blocked.size > 0) {
    warnings.push(
      `${blocked.size} spot${blocked.size === 1 ? '' : 's'} in this file ` +
        `${blocked.size === 1 ? 'belongs' : 'belong'} to your map or another ` +
        `event and ${blocked.size === 1 ? 'was' : 'were'} left alone.`,
    );
  }

  const spots = bundle.spots
    .filter((s) => !blocked.has(s.id as string))
    // `deletedAt` is *not* cleared on spots: the bundle records which of the
    // event's spots were deleted, and a restore should reproduce that state
    // rather than resurrect everything the event ever held.
    .map((s) => ({ ...s, updatedAt: at, syncState: 'local' as const }));

  return {
    mode: 'restore',
    // The event's own tombstone *is* cleared — restoring a deleted event is
    // the point of the operation, and the UI has already said so.
    event: {
      ...bundle.event,
      deletedAt: null,
      updatedAt: at,
      syncState: 'local',
    },
    spots,
    days: daysFor(bundle, bundle.event.id, (id) => id as EventDayId),
    sessions: bundle.sessions.map((s) => ({
      ...s,
      updatedAt: at,
      syncState: 'local' as const,
    })),
    // Ticks included, and tombstones left as the file recorded them — the same
    // rule as the spots above. Restoring the list without which cars were
    // already photographed would hand back a count that has to be redone.
    entries: entriesOf(bundle).map((e) => ({
      ...e,
      updatedAt: at,
      syncState: 'local' as const,
    })),
    // Packed state and tombstones left exactly as the file recorded them —
    // the same rule as the entries above, for the same reason: restoring the
    // checklist without which items are already packed hands back a count
    // that has to be redone.
    warnings,
  };
}

/**
 * Copy: everything reminted, every reference rewritten.
 *
 * The maps are built first and applied afterwards so that a reference can be
 * resolved regardless of the order records appear in the file.
 */
function planCopy(bundle: EventBundle): ImportPlan {
  const warnings: string[] = [];
  const base = newEntityBase();

  const eventId = newId<EventId>();
  const spotIds = new Map<string, SpotId>(
    bundle.spots.map((s) => [s.id as string, newId<SpotId>()]),
  );
  const dayIds = new Map<string, EventDayId>(
    bundle.days.map((d) => [d.id, newId<EventDayId>()]),
  );
  const sessionIds = new Map<string, SessionId>(
    bundle.sessions.map((s) => [s.id as string, newId<SessionId>()]),
  );

  /*
   * References to spots the file does not contain are dropped.
   *
   * Keeping the original id would be worse than losing the reference: the id
   * may well resolve locally — to the spot this bundle was copied *from* — and
   * the new event would then quietly reach into the permanent collection,
   * which is the one thing copies exist to prevent. A missing stop is visible;
   * a stop secretly pointing at your home map is not.
   */
  const dropped = new Set<string>();
  const mapSpot = (id: SpotId): SpotId | null => {
    const mapped = spotIds.get(id as string);
    if (!mapped) dropped.add(id as string);
    return mapped ?? null;
  };

  const includedSpotIds = bundle.event.spotIds
    .map(mapSpot)
    .filter((id): id is SpotId => id !== null);

  const stops: PlanStop[] = [];
  for (const stop of bundle.event.stops) {
    const spotId = mapSpot(stop.spotId);
    if (spotId === null) continue;
    stops.push({
      ...stop,
      spotId,
      sessionId:
        stop.sessionId === null
          ? null
          : (sessionIds.get(stop.sessionId as string) ?? null),
    });
  }

  if (dropped.size > 0) {
    warnings.push(
      `${dropped.size} spot reference${dropped.size === 1 ? '' : 's'} in the ` +
        `plan had no spot in the file and ${dropped.size === 1 ? 'was' : 'were'} dropped.`,
    );
  }
  const ticked = entriesOf(bundle).filter((e) => e.photographed).length;
  if (ticked > 0) {
    warnings.push(
      `${ticked} car${ticked === 1 ? '' : 's'} in the entry list ` +
        `${ticked === 1 ? 'is' : 'are'} already marked as photographed.`,
    );
  }
  const lostStops = bundle.event.stops.length - stops.length;
  if (lostStops > 0) {
    warnings.push(
      `${lostStops} planned stop${lostStops === 1 ? '' : 's'} could not be ` +
        `rebuilt and ${lostStops === 1 ? 'is' : 'are'} missing from the route.`,
    );
  }

  return {
    mode: 'copy',
    event: {
      ...bundle.event,
      id: eventId,
      spotIds: includedSpotIds,
      stops,
      ...base,
    },
    spots: bundle.spots.map((s) => ({
      ...s,
      id: spotIds.get(s.id as string)!,
      eventId,
      ...base,
      // A copy has never been anywhere, so it carries no tombstone either: it
      // is a new record, not a restored one.
      deletedAt: null,
    })),
    days: daysFor(bundle, eventId, (id) => dayIds.get(id) ?? newId<EventDayId>()),
    sessions: bundle.sessions.map((s) => ({
      ...s,
      id: sessionIds.get(s.id as string)!,
      eventDayId: dayIds.get(s.eventDayId as string) ?? ORPHAN_DAY_ID,
      ...base,
      deletedAt: null,
    })),
    /*
     * Entries follow the event they were reminted for.
     *
     * `eventId` is rewritten like every other reference here; leaving the
     * original would give the copy an entry list that belongs to the event it
     * was copied from, and ticking a car in one would tick it in both.
     *
     * `photographed` is *carried*, not cleared. Copy mode is as often "keep
     * both versions" of your own event as it is "open someone else's", and
     * clearing would silently destroy a weekend's count in the first case to
     * tidy up a cosmetic wrongness in the second. Carrying it and saying so is
     * the trade this module makes everywhere else.
     */
    entries: entriesOf(bundle).map((e) => ({
      ...e,
      id: newId<EntryId>(),
      eventId,
      ...base,
      deletedAt: null,
    })),
    warnings,
  };
}

/**
 * The day a session falls back to when the file does not describe its own.
 *
 * Only reachable for a hand-edited or truncated bundle — this app always writes
 * every day its sessions hang off. Sessions are grouped by day in the UI, so a
 * session pointing at a day that is not there would simply not appear: present
 * in the data, invisible on screen, which is the worst of both. A placeholder
 * day keeps it visible and honest about not knowing when it runs.
 */
const ORPHAN_DAY_ID = 'imported-unscheduled' as EventDayId;

function daysFor(
  bundle: EventBundle,
  eventId: EventId,
  mapId: (id: string) => EventDayId,
): EventDay[] {
  const base = newEntityBase();
  const days: EventDay[] = bundle.days.map((d) => ({
    id: mapId(d.id),
    circuitId: bundle.event.circuitId,
    eventId,
    date: d.date,
    sourceDocumentId: null,
    label: d.label,
    ...base,
  }));

  const known = new Set(bundle.days.map((d) => d.id));
  if (bundle.sessions.some((s) => !known.has(s.eventDayId as string))) {
    days.push({
      id: ORPHAN_DAY_ID,
      circuitId: bundle.event.circuitId,
      eventId,
      date: 'Unscheduled',
      sourceDocumentId: null,
      label: 'Unscheduled',
      ...base,
    });
  }
  return days;
}

/**
 * What to write for this bundle, in this mode.
 *
 * Pure: it decides, it does not persist. The caller writes the result, which is
 * what makes every rule here testable without a database.
 */
export function planImport(
  bundle: EventBundle,
  local: LocalState,
  mode: ImportMode,
): ImportPlan {
  const plan = mode === 'restore' ? planRestore(bundle, local) : planCopy(bundle);

  /*
   * Counted against the *bundle*, not against the finished plan.
   *
   * By the time the plan exists the fallback has already been applied — the
   * orphan day is in `days` and the sessions point at it — so asking the plan
   * whether anything was orphaned always answers no. Reading the file is what
   * actually knows.
   */
  const known = new Set(bundle.days.map((d) => d.id));
  const orphaned = bundle.sessions.filter(
    (s) => !known.has(s.eventDayId as string),
  ).length;

  const withWarning =
    orphaned === 0
      ? plan.warnings
      : [
          ...plan.warnings,
          `${orphaned} session${orphaned === 1 ? '' : 's'} had no day in the ` +
            `file and ${orphaned === 1 ? 'is' : 'are'} filed under Unscheduled.`,
        ];

  // Belt and braces: whatever the planners did, no session may leave here
  // pointing at a day that is not being written alongside it.
  const days = new Set(plan.days.map((d) => d.id as string));
  return {
    ...plan,
    warnings: withWarning,
    sessions: plan.sessions.map((s) =>
      days.has(s.eventDayId as string) ? s : { ...s, eventDayId: ORPHAN_DAY_ID },
    ),
  };
}

/**
 * What this plan would write, in one line.
 *
 * Contents only, with no mode prefix: this is shown *under* the button that
 * names the mode, and "Import a copy: Import a copy: 1 spot…" is what naming it
 * twice actually looks like on screen.
 */
export function describeImport(plan: ImportPlan): string {
  const bits = [
    `${plan.spots.length} spot${plan.spots.length === 1 ? '' : 's'}`,
    `${plan.sessions.length} session${plan.sessions.length === 1 ? '' : 's'}`,
    `${plan.event.stops.length} planned stop${plan.event.stops.length === 1 ? '' : 's'}`,
  ];
  // Only when there are some — but never silently: an import that writes forty
  // entries the summary did not mention is the failure this module exists to
  // prevent, and most events have none to mention.
  if (plan.entries.length > 0) {
    bits.push(
      `${plan.entries.length} entr${plan.entries.length === 1 ? 'y' : 'ies'}`,
    );
  }
  return `${bits.join(', ')}.`;
}
