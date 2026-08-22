/**
 * Local repository implementations — spec §2.3.
 *
 * Implements the `core/` interfaces over the key/value port. The UI never sees
 * this file; it depends on `RepositoryBundle` and gets whichever implementation
 * was wired in, which is what makes the eventual move to Drizzle/SQLite (and
 * later to a sync target) a change confined to this directory.
 *
 * ── Deletion ──────────────────────────────────────────────────────────────
 * There is no hard delete anywhere below. `softDelete` stamps `deletedAt` and
 * the row stays. Spec §0.1: a removed row leaves nothing for a peer to
 * reconcile against, so it silently reappears from any device that still has
 * it. Reads filter tombstones out; nothing erases them.
 */
import { nowUtc, type Utc } from '../../core/domain/common';
import type { Entry } from '../../core/domain/entry';
import { setPhotographed as tick } from '../../core/domain/entry';
import type { EquipmentItem } from '../../core/domain/equipment';
import { setPacked as tickPacked } from '../../core/domain/equipment';
import type { GearItem } from '../../core/domain/gear';
import type { Media } from '../../core/domain/media';
import type { Spot } from '../../core/domain/spot';
import type { UserSpotNote } from '../../core/domain/userSpotNote';
import {
  type CircuitId,
  type EntryId,
  type EquipmentItemId,
  type EventDayId,
  type EventId,
  type MediaId,
  type SessionId,
  type SpotId,
  type UserGearItemId,
  type UserId,
  newId,
} from '../../core/domain/ids';
import { newEntityBase } from '../../core/domain/common';
import type { EventDay, Session } from '../../core/domain/planning';
import type { Event, PlanStop } from '../../core/domain/event';
import type { IEntryRepository } from '../../core/repositories/entryRepository';
import type { IEquipmentRepository } from '../../core/repositories/equipmentRepository';
import type { IGearRepository } from '../../core/repositories/gearRepository';
import type { IEventRepository } from '../../core/repositories/eventRepository';
import type {
  IEventDayRepository,
  ISessionRepository,
} from '../../core/repositories/sessionRepository';
import type {
  IMediaRepository,
  ISpotRepository,
  IUserSpotNoteRepository,
  RepositoryBundle,
} from '../../core/repositories/spotRepository';
import { kv } from '../kv';

const SPOTS_KEY = 'trackside.spots.v1';
const MEDIA_KEY = 'trackside.media.v1';
const NOTES_KEY = 'trackside.notes.v1';
const DAYS_KEY = 'trackside.eventdays.v1';
const SESSIONS_KEY = 'trackside.sessions.v1';
const EVENTS_KEY = 'trackside.events.v1';
const ENTRIES_KEY = 'trackside.entries.v1';
const EQUIPMENT_KEY = 'trackside.equipment.v1';
const GEAR_KEY = 'trackside.gear.v1';

/** Read a whole collection. Missing or corrupt data yields an empty set. */
async function readAll<T>(key: string): Promise<T[]> {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // Corrupt payload. Returning empty loses the read but keeps the app usable;
    // the data is not overwritten until something explicitly saves.
    return [];
  }
}

async function writeAll<T>(key: string, rows: T[]): Promise<void> {
  await kv.set(key, JSON.stringify(rows));
}

/**
 * One in-flight mutation per collection.
 *
 * ── The bug this exists to prevent ─────────────────────────────────────────
 * Every mutation here is read-modify-write over a whole collection: read the
 * JSON blob, change one row, write it all back. There is an `await` between the
 * read and the write, so two overlapping mutations both read the *same* array
 * and the second write silently discards the first's change.
 *
 * The UI fires these without awaiting — `void addStop(...)`, a text field
 * committing on blur while a reload is in flight — so overlapping is the normal
 * case, not a rare race. Adding two planned stops and giving them times made
 * three or four such writes overlap, and stops appeared to save and then vanish.
 *
 * Chaining per key serialises them: each mutation waits for the previous one on
 * that collection, so every read sees the last write. Per key rather than
 * globally, because a spot edit has no reason to wait behind a timetable
 * import.
 *
 * This is not a substitute for real transactions. It is what makes a document
 * store safe to write from an event-driven UI, and it stops being needed when
 * the repositories move onto Drizzle rows.
 */
const writeQueues = new Map<string, Promise<unknown>>();

/**
 * Read a collection, change it, write it back — atomically for that key.
 *
 * The only safe way to mutate a document collection here. Anything that reads
 * and then writes without going through this can lose a concurrent change.
 */
function update<T>(key: string, change: (rows: T[]) => T[]): Promise<void> {
  return mutate(key, async () => {
    const rows = await readAll<T>(key);
    await writeAll(key, change(rows));
  });
}

function mutate<R>(key: string, work: () => Promise<R>): Promise<R> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  // Swallow the predecessor's failure: one bad write must not wedge the queue
  // for the rest of the session.
  const next = previous.then(work, work);
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** Replace by id, or append when absent. */
function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) return [...rows, row];
  const next = [...rows];
  next[i] = row;
  return next;
}

const live = <T extends { deletedAt: Utc | null }>(rows: T[]): T[] =>
  rows.filter((r) => r.deletedAt === null);

/**
 * Bring a stored row up to the current shape.
 *
 * The document store round-trips whatever JSON was written, so a row saved by
 * an older build is missing every field added since. `keyTimes`, `tags` and
 * `shotSettings` all arrived after the first spots were saved, and reading one
 * of those rows put `undefined` where the UI expected an array — `.length` on
 * it took the whole app to a white screen.
 *
 * Defaulting at the read boundary rather than at each use keeps the `Spot` type
 * honest: everything downstream can trust that an array field is an array. The
 * alternative — `?? []` scattered through the UI — has to be remembered at
 * every new call site, and is only ever noticed when it has already crashed.
 *
 * This is not a substitute for a real migration; it is what makes one
 * unnecessary for additive fields, which is most of them. A field that changes
 * meaning still needs one.
 */
function normaliseSpot(row: Spot): Spot {
  return {
    ...row,
    keyTimes: row.keyTimes ?? [],
    tags: row.tags ?? [],
    shotSettings: row.shotSettings ?? [],
    isHidden: row.isHidden ?? false,
    // Rows written before events existed belong to the permanent collection.
    eventId: row.eventId ?? null,
  };
}

/**
 * Bring a stored event up to the current shape.
 *
 * `dates` was free text ("10–11 October") before the planner needed real days
 * to schedule against. Rows written then still carry it, and the year it never
 * recorded cannot be recovered — so the string is kept as `notes` rather than
 * guessed at. Inventing 2026 because that is the current year would be the app
 * asserting a fact it does not have, and the plan built on it would be silently
 * wrong.
 */
function normaliseEvent(row: Event & { dates?: string | null }): Event {
  const legacy = typeof row.dates === 'string' && row.dates.trim() !== ''
    ? row.dates.trim()
    : null;

  return {
    ...row,
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    spotIds: row.spotIds ?? [],
    stops: row.stops ?? [],
    // Rows written before D4 have no gear field at all.
    gearItemIds: row.gearItemIds ?? [],
    notes:
      row.notes ??
      (legacy ? `Dates before the calendar existed: ${legacy}` : null),
  };
}

/**
 * Bring a stored media row up to the current shape.
 *
 * `tag` arrived after photos were already being taken, so a row written
 * before it existed has no such key. Defaulted to null at the read boundary
 * for the same reason `normaliseSpot` gives — everything downstream can trust
 * the field is there rather than `?? null` scattered through the UI.
 */
function normaliseMedia(row: Media): Media {
  return { ...row, tag: row.tag ?? null };
}

class SpotRepository implements ISpotRepository {
  async listByCircuit(circuitId: CircuitId): Promise<Spot[]> {
    const rows = (await readAll<Spot>(SPOTS_KEY)).map(normaliseSpot);
    return live(rows)
      .filter((s) => s.circuitId === circuitId)
      // Ids are UUID v7, so descending id is descending creation time without
      // needing to parse a timestamp.
      .sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** Tombstones included — see the interface. Import is the only caller. */
  async listAllIncludingDeleted(): Promise<Spot[]> {
    return (await readAll<Spot>(SPOTS_KEY)).map(normaliseSpot);
  }

  async get(id: SpotId): Promise<Spot | null> {
    const rows = await readAll<Spot>(SPOTS_KEY);
    const row = rows.find((s) => s.id === id);
    return row ? normaliseSpot(row) : null;
  }

  async save(spot: Spot): Promise<void> {
    await update<Spot>(SPOTS_KEY, (rows) => upsert(rows, spot));
  }

  async softDelete(id: SpotId, at: string = nowUtc()): Promise<void> {
    await update<Spot>(SPOTS_KEY, (rows) =>
      rows.map((s) =>
        s.id === id ? { ...s, deletedAt: at as Utc, updatedAt: at as Utc } : s,
      ),
    );

    // Tombstone attached media alongside it, or a deleted spot leaves its
    // reference photos behind as orphans in any gallery view.
    await update<Media>(MEDIA_KEY, (media) =>
      media.map((m) =>
        m.spotId === id && m.deletedAt === null
          ? { ...m, deletedAt: at as Utc, updatedAt: at as Utc }
          : m,
      ),
    );
  }

  async restore(id: SpotId): Promise<void> {
    const at = nowUtc();
    await update<Spot>(SPOTS_KEY, (rows) =>
      rows.map((s) => (s.id === id ? { ...s, deletedAt: null, updatedAt: at } : s)),
    );
    await update<Media>(MEDIA_KEY, (media) =>
      media.map((m) => (m.spotId === id ? { ...m, deletedAt: null } : m)),
    );
  }
}

class MediaRepository implements IMediaRepository {
  async listBySpot(spotId: SpotId): Promise<Media[]> {
    const rows = (await readAll<Media>(MEDIA_KEY)).map(normaliseMedia);
    return live(rows)
      .filter((m) => m.spotId === spotId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async get(id: MediaId): Promise<Media | null> {
    const rows = await readAll<Media>(MEDIA_KEY);
    const row = rows.find((m) => m.id === id);
    return row ? normaliseMedia(row) : null;
  }

  async save(media: Media): Promise<void> {
    await update<Media>(MEDIA_KEY, (rows) => upsert(rows, media));
  }

  async softDelete(id: MediaId, at: string = nowUtc()): Promise<void> {
    await update<Media>(MEDIA_KEY, (rows) =>
      rows.map((m) =>
        m.id === id ? { ...m, deletedAt: at as Utc, updatedAt: at as Utc } : m,
      ),
    );
  }
}

class UserSpotNoteRepository implements IUserSpotNoteRepository {
  async getForSpot(spotId: SpotId, userId: UserId): Promise<UserSpotNote | null> {
    const rows = await readAll<UserSpotNote>(NOTES_KEY);
    return (
      live(rows).find((n) => n.spotId === spotId && n.userId === userId) ?? null
    );
  }

  async save(note: UserSpotNote): Promise<void> {
    await update<UserSpotNote>(NOTES_KEY, (rows) => upsert(rows, note));
  }

  async softDelete(id: string, at: string = nowUtc()): Promise<void> {
    await update<UserSpotNote>(NOTES_KEY, (rows) =>
      rows.map((n) =>
        n.id === id ? { ...n, deletedAt: at as Utc, updatedAt: at as Utc } : n,
      ),
    );
  }
}

class EventDayRepository implements IEventDayRepository {
  async listByCircuit(circuitId: CircuitId): Promise<EventDay[]> {
    const rows = await readAll<EventDay>(DAYS_KEY);
    return live(rows)
      .filter((d) => d.circuitId === circuitId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Idempotent per (event, circuit, date) — see the note on the interface. */
  async ensure(
    circuitId: CircuitId,
    date: string,
    label: string | null,
    eventId: EventId | null,
  ): Promise<EventDay> {
    // Find-or-create has to hold the lock across both halves. Importing a
    // multi-day timetable calls this once per session, and two calls for the
    // same day arriving together would each see "not found" and create one.
    return mutate(DAYS_KEY, async () => {
      const rows = await readAll<EventDay>(DAYS_KEY);
      // Keyed on the event too, so re-importing a revised timetable for one
      // weekend does not fold into another weekend's day of the same name.
      const found = live(rows).find(
        (d) =>
          d.circuitId === circuitId &&
          d.date === date &&
          (d.eventId ?? null) === eventId,
      );
      if (found) return found;

      const day: EventDay = {
        id: newId<EventDayId>(),
        circuitId,
        eventId,
        date,
        sourceDocumentId: null,
        label,
        ...newEntityBase(),
      };
      await writeAll(DAYS_KEY, [...rows, day]);
      return day;
    });
  }

  /** Caller-supplied id, for restoring a backup — see the interface. */
  async save(day: EventDay): Promise<void> {
    await update<EventDay>(DAYS_KEY, (rows) => upsert(rows, day));
  }

  async softDelete(id: EventDayId, at: string = nowUtc()): Promise<void> {
    await update<EventDay>(DAYS_KEY, (rows) =>
      rows.map((d) =>
        d.id === id ? { ...d, deletedAt: at as Utc, updatedAt: at as Utc } : d,
      ),
    );
  }
}

class SessionRepository implements ISessionRepository {
  async listByEventDay(eventDayId: EventDayId): Promise<Session[]> {
    const rows = await readAll<Session>(SESSIONS_KEY);
    return live(rows)
      .filter((s) => s.eventDayId === eventDayId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async listByCircuit(circuitId: CircuitId): Promise<Session[]> {
    const days = await readAll<EventDay>(DAYS_KEY);
    const ids = new Set(
      live(days)
        .filter((d) => d.circuitId === circuitId)
        .map((d) => d.id),
    );
    const rows = await readAll<Session>(SESSIONS_KEY);
    return live(rows)
      .filter((s) => ids.has(s.eventDayId))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async listByEvent(eventId: EventId): Promise<Session[]> {
    const days = live(await readAll<EventDay>(DAYS_KEY)).filter(
      (d) => (d.eventId ?? null) === eventId,
    );
    const ids = new Set(days.map((d) => d.id));
    const rows = await readAll<Session>(SESSIONS_KEY);
    return live(rows)
      .filter((s) => ids.has(s.eventDayId))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async save(session: Session): Promise<void> {
    await update<Session>(SESSIONS_KEY, (rows) => upsert(rows, session));
  }

  async softDelete(id: SessionId, at: string = nowUtc()): Promise<void> {
    await update<Session>(SESSIONS_KEY, (rows) =>
      rows.map((s) =>
        s.id === id ? { ...s, deletedAt: at as Utc, updatedAt: at as Utc } : s,
      ),
    );
  }
}

class EntryRepository implements IEntryRepository {
  async listByEvent(eventId: EventId): Promise<Entry[]> {
    const rows = await readAll<Entry>(ENTRIES_KEY);
    // Insertion order — see the note on the interface. The entry list is read
    // in the order it was published, which is by class, not by number.
    return live(rows).filter((e) => e.eventId === eventId);
  }

  async get(id: EntryId): Promise<Entry | null> {
    const rows = await readAll<Entry>(ENTRIES_KEY);
    return rows.find((e) => e.id === id) ?? null;
  }

  async save(entry: Entry): Promise<void> {
    await update<Entry>(ENTRIES_KEY, (rows) => upsert(rows, entry));
  }

  async saveMany(entries: readonly Entry[]): Promise<void> {
    if (entries.length === 0) return;
    await update<Entry>(ENTRIES_KEY, (rows) =>
      entries.reduce((acc, entry) => upsert(acc, entry), rows),
    );
  }

  async setPhotographed(
    id: EntryId,
    photographed: boolean,
    at: string = nowUtc(),
  ): Promise<void> {
    // Read and write inside one queued mutation: this is tapped repeatedly
    // between sessions, often faster than a reload settles, and a caller
    // holding a row it fetched a moment ago would write back a stale one.
    await update<Entry>(ENTRIES_KEY, (rows) =>
      rows.map((e) => (e.id === id ? tick(e, photographed, at as Utc) : e)),
    );
  }

  async softDelete(id: EntryId, at: string = nowUtc()): Promise<void> {
    await update<Entry>(ENTRIES_KEY, (rows) =>
      rows.map((e) =>
        e.id === id ? { ...e, deletedAt: at as Utc, updatedAt: at as Utc } : e,
      ),
    );
  }
}

class EquipmentRepository implements IEquipmentRepository {
  async listByEvent(eventId: EventId): Promise<EquipmentItem[]> {
    const rows = await readAll<EquipmentItem>(EQUIPMENT_KEY);
    // Insertion order — see the note on IEntryRepository.listByEvent, which
    // this mirrors. Grouped for display by category, then by this order.
    return live(rows).filter((i) => i.eventId === eventId);
  }

  async get(id: EquipmentItemId): Promise<EquipmentItem | null> {
    const rows = await readAll<EquipmentItem>(EQUIPMENT_KEY);
    return rows.find((i) => i.id === id) ?? null;
  }

  async save(item: EquipmentItem): Promise<void> {
    await update<EquipmentItem>(EQUIPMENT_KEY, (rows) => upsert(rows, item));
  }

  async saveMany(items: readonly EquipmentItem[]): Promise<void> {
    if (items.length === 0) return;
    await update<EquipmentItem>(EQUIPMENT_KEY, (rows) =>
      items.reduce((acc, item) => upsert(acc, item), rows),
    );
  }

  async setPacked(
    id: EquipmentItemId,
    packed: boolean,
    at: string = nowUtc(),
  ): Promise<void> {
    // Read and write inside one queued mutation — see the note on
    // EntryRepository.setPhotographed, which this mirrors exactly.
    await update<EquipmentItem>(EQUIPMENT_KEY, (rows) =>
      rows.map((i) => (i.id === id ? tickPacked(i, packed, at as Utc) : i)),
    );
  }

  async softDelete(id: EquipmentItemId, at: string = nowUtc()): Promise<void> {
    await update<EquipmentItem>(EQUIPMENT_KEY, (rows) =>
      rows.map((i) =>
        i.id === id ? { ...i, deletedAt: at as Utc, updatedAt: at as Utc } : i,
      ),
    );
  }
}

class GearRepository implements IGearRepository {
  async listByUser(userId: UserId): Promise<GearItem[]> {
    const rows = await readAll<GearItem>(GEAR_KEY);
    // Insertion order — see the note on IGearRepository.listByUser. Grouped
    // for display into bodies/lenses by the UI, not here.
    return live(rows).filter((i) => i.userId === userId);
  }

  async get(id: UserGearItemId): Promise<GearItem | null> {
    const rows = await readAll<GearItem>(GEAR_KEY);
    return rows.find((i) => i.id === id) ?? null;
  }

  async save(item: GearItem): Promise<void> {
    await update<GearItem>(GEAR_KEY, (rows) => upsert(rows, item));
  }

  async saveMany(items: readonly GearItem[]): Promise<void> {
    if (items.length === 0) return;
    await update<GearItem>(GEAR_KEY, (rows) =>
      items.reduce((acc, item) => upsert(acc, item), rows),
    );
  }

  async softDelete(id: UserGearItemId, at: string = nowUtc()): Promise<void> {
    await update<GearItem>(GEAR_KEY, (rows) =>
      rows.map((i) =>
        i.id === id ? { ...i, deletedAt: at as Utc, updatedAt: at as Utc } : i,
      ),
    );
  }
}

class EventRepository implements IEventRepository {
  async listByCircuit(circuitId: CircuitId): Promise<Event[]> {
    const rows = (await readAll<Event>(EVENTS_KEY)).map(normaliseEvent);
    return live(rows)
      .filter((e) => e.circuitId === circuitId)
      .sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  async listAll(): Promise<Event[]> {
    const rows = (await readAll<Event>(EVENTS_KEY)).map(normaliseEvent);
    return live(rows).sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** Tombstones included — see the interface. Import is the only caller. */
  async listAllIncludingDeleted(): Promise<Event[]> {
    return (await readAll<Event>(EVENTS_KEY)).map(normaliseEvent);
  }

  async get(id: EventId): Promise<Event | null> {
    const rows = await readAll<Event>(EVENTS_KEY);
    const row = rows.find((e) => e.id === id);
    return row ? normaliseEvent(row) : null;
  }

  async save(event: Event): Promise<void> {
    await update<Event>(EVENTS_KEY, (rows) => upsert(rows, event));
  }

  async softDelete(id: EventId, at: string = nowUtc()): Promise<void> {
    await update<Event>(EVENTS_KEY, (rows) =>
      rows.map((e) =>
        e.id === id ? { ...e, deletedAt: at as Utc, updatedAt: at as Utc } : e,
      ),
    );
    /*
     * The event's own copies of the spots go with it.
     *
     * This used to leave every spot alone, reasoning that an event is a
     * selection over the permanent collection (§4.2), so deleting the
     * selection must not delete the places. That reasoning went stale when
     * events stopped holding references: "Start from my spots" clones rather
     * than points (cloneSpots.ts) and an imported event gets its own copies
     * too (importBundle.ts), so an event now *owns* the rows carrying its id.
     *
     * Those copies are reachable only through their event —
     * `spotsForContext` puts a spot with an `eventId` on that event's map and
     * nowhere else — so leaving them behind a tombstoned event makes them
     * invisible everywhere while they accumulate in the store forever.
     *
     * Spots with `eventId === null` are still deliberately untouched. That is
     * the original rule with its actual reason intact: the home map is the
     * permanent collection, and no event may delete from it.
     */
    const owned = new Set<string>();
    await update<Spot>(SPOTS_KEY, (rows) =>
      rows.map((s) => {
        if ((s.eventId ?? null) !== id) return s;
        owned.add(s.id);
        return s.deletedAt === null
          ? { ...s, deletedAt: at as Utc, updatedAt: at as Utc }
          : s;
      }),
    );

    /*
     * Photos attached to those copies go with them.
     *
     * The same cascade `SpotRepository.softDelete` runs, for the same reason.
     * Cloning does not duplicate media (cloneSpots.ts), so a copy starts with
     * none — but anything shot and attached during the weekend hangs off the
     * copy, and `listBySpot` is the only route to a media row. Left live under
     * a tombstoned spot it is reachable from nowhere, which is the orphan this
     * whole cascade exists to stop, one level down.
     *
     * The ids come from the write above rather than a second read, so they are
     * exactly the rows tombstoned there and a concurrent spot write cannot
     * slip in between. Spots already tombstoned are included too: their media
     * was tombstoned with them, and `m.deletedAt === null` makes re-covering
     * them cost nothing.
     */
    if (owned.size > 0) {
      await update<Media>(MEDIA_KEY, (media) =>
        media.map((m) =>
          m.spotId !== null && owned.has(m.spotId) && m.deletedAt === null
            ? { ...m, deletedAt: at as Utc, updatedAt: at as Utc }
            : m,
        ),
      );
    }

    /*
     * The entry list goes too.
     *
     * An entry has no meaning outside its event — it is a car in a particular
     * race, and `Entry.eventId` has no null case for that reason. There is no
     * equivalent of the home map to protect here: every row carrying this id
     * belongs to the weekend being deleted, so unlike the spots above there is
     * nothing to spare.
     */
    await update<Entry>(ENTRIES_KEY, (rows) =>
      rows.map((e) =>
        e.eventId === id && e.deletedAt === null
          ? { ...e, deletedAt: at as Utc, updatedAt: at as Utc }
          : e,
      ),
    );

    /*
     * The equipment checklist goes too, for the same reason the entry list
     * does: it has no meaning outside its event — `EquipmentItem.eventId` has
     * no null case, same as `Entry.eventId` — so there is nothing to spare.
     */
    await update<EquipmentItem>(EQUIPMENT_KEY, (rows) =>
      rows.map((i) =>
        i.eventId === id && i.deletedAt === null
          ? { ...i, deletedAt: at as Utc, updatedAt: at as Utc }
          : i,
      ),
    );
  }

  async setSpotIncluded(
    id: EventId,
    spotId: SpotId,
    included: boolean,
  ): Promise<void> {
    const at = nowUtc();
    await update<Event>(EVENTS_KEY, (rows) =>
      rows.map((e) => {
        if (e.id !== id) return e;
        const has = (e.spotIds ?? []).includes(spotId);
        if (has === included) return e;
        return {
          ...e,
          spotIds: included
            ? [...(e.spotIds ?? []), spotId]
            : (e.spotIds ?? []).filter((x) => x !== spotId),
          updatedAt: at,
        };
      }),
    );
  }

  /** Same shape as setSpotIncluded, for the event's gear list instead. */
  async setGearIncluded(
    id: EventId,
    gearItemId: UserGearItemId,
    included: boolean,
  ): Promise<void> {
    const at = nowUtc();
    await update<Event>(EVENTS_KEY, (rows) =>
      rows.map((e) => {
        if (e.id !== id) return e;
        const has = (e.gearItemIds ?? []).includes(gearItemId);
        if (has === included) return e;
        return {
          ...e,
          gearItemIds: included
            ? [...(e.gearItemIds ?? []), gearItemId]
            : (e.gearItemIds ?? []).filter((x) => x !== gearItemId),
          updatedAt: at,
        };
      }),
    );
  }

  /** Apply a change to one event's stop list, stamping updatedAt. */
  private async mutateStops(
    id: EventId,
    change: (stops: readonly PlanStop[]) => readonly PlanStop[],
  ): Promise<void> {
    const at = nowUtc();
    await update<Event>(EVENTS_KEY, (rows) =>
      rows.map((raw) => {
        if (raw.id !== id) return raw;
        const e = normaliseEvent(raw);
        return { ...e, stops: change(e.stops), updatedAt: at };
      }),
    );
  }

  async addStop(id: EventId, stop: PlanStop): Promise<void> {
    await this.mutateStops(id, (stops) => [...stops, stop]);
    // Scheduling a spot puts it in the event; see the interface note.
    await this.setSpotIncluded(id, stop.spotId, true);
  }

  async updateStop(
    id: EventId,
    stopId: string,
    patch: Partial<Omit<PlanStop, 'id' | 'spotId'>>,
  ): Promise<void> {
    await this.mutateStops(id, (stops) =>
      stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)),
    );
  }

  async removeStop(id: EventId, stopId: string): Promise<void> {
    // The spot stays in the event: dropping a stop from the plan is not the
    // same as deciding the place is not worth shooting.
    await this.mutateStops(id, (stops) => stops.filter((s) => s.id !== stopId));
  }

  async moveStop(id: EventId, stopId: string, toIndex: number): Promise<void> {
    await this.mutateStops(id, (stops) => {
      const from = stops.findIndex((s) => s.id === stopId);
      if (from === -1) return stops;
      const target = Math.max(0, Math.min(stops.length - 1, toIndex));
      if (target === from) return stops;

      const next = [...stops];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }
}

export const events: IEventRepository = new EventRepository();
export const entries: IEntryRepository = new EntryRepository();
export const equipment: IEquipmentRepository = new EquipmentRepository();
export const gear: IGearRepository = new GearRepository();
export const eventDays: IEventDayRepository = new EventDayRepository();
export const sessions: ISessionRepository = new SessionRepository();

export const repositories: RepositoryBundle = {
  spots: new SpotRepository(),
  media: new MediaRepository(),
  notes: new UserSpotNoteRepository(),
};
