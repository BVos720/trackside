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
import type { Media } from '../../core/domain/media';
import type { Spot } from '../../core/domain/spot';
import type { UserSpotNote } from '../../core/domain/userSpotNote';
import {
  type CircuitId,
  type EventDayId,
  type EventId,
  type MediaId,
  type SessionId,
  type SpotId,
  type UserId,
  newId,
} from '../../core/domain/ids';
import { newEntityBase } from '../../core/domain/common';
import type { EventDay, Session } from '../../core/domain/planning';
import type { Event, PlanStop } from '../../core/domain/event';
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
    notes:
      row.notes ??
      (legacy ? `Dates before the calendar existed: ${legacy}` : null),
  };
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

  async get(id: SpotId): Promise<Spot | null> {
    const rows = await readAll<Spot>(SPOTS_KEY);
    const row = rows.find((s) => s.id === id);
    return row ? normaliseSpot(row) : null;
  }

  async save(spot: Spot): Promise<void> {
    const rows = await readAll<Spot>(SPOTS_KEY);
    await writeAll(SPOTS_KEY, upsert(rows, spot));
  }

  async softDelete(id: SpotId, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<Spot>(SPOTS_KEY);
    await writeAll(
      SPOTS_KEY,
      rows.map((s) =>
        s.id === id ? { ...s, deletedAt: at as Utc, updatedAt: at as Utc } : s,
      ),
    );

    // Tombstone attached media alongside it, or a deleted spot leaves its
    // reference photos behind as orphans in any gallery view.
    const media = await readAll<Media>(MEDIA_KEY);
    await writeAll(
      MEDIA_KEY,
      media.map((m) =>
        m.spotId === id && m.deletedAt === null
          ? { ...m, deletedAt: at as Utc, updatedAt: at as Utc }
          : m,
      ),
    );
  }

  async restore(id: SpotId): Promise<void> {
    const at = nowUtc();
    const rows = await readAll<Spot>(SPOTS_KEY);
    await writeAll(
      SPOTS_KEY,
      rows.map((s) => (s.id === id ? { ...s, deletedAt: null, updatedAt: at } : s)),
    );
    const media = await readAll<Media>(MEDIA_KEY);
    await writeAll(
      MEDIA_KEY,
      media.map((m) => (m.spotId === id ? { ...m, deletedAt: null } : m)),
    );
  }
}

class MediaRepository implements IMediaRepository {
  async listBySpot(spotId: SpotId): Promise<Media[]> {
    const rows = await readAll<Media>(MEDIA_KEY);
    return live(rows)
      .filter((m) => m.spotId === spotId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async get(id: MediaId): Promise<Media | null> {
    const rows = await readAll<Media>(MEDIA_KEY);
    return rows.find((m) => m.id === id) ?? null;
  }

  async save(media: Media): Promise<void> {
    const rows = await readAll<Media>(MEDIA_KEY);
    await writeAll(MEDIA_KEY, upsert(rows, media));
  }

  async softDelete(id: MediaId, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<Media>(MEDIA_KEY);
    await writeAll(
      MEDIA_KEY,
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
    const rows = await readAll<UserSpotNote>(NOTES_KEY);
    await writeAll(NOTES_KEY, upsert(rows, note));
  }

  async softDelete(id: string, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<UserSpotNote>(NOTES_KEY);
    await writeAll(
      NOTES_KEY,
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
  }

  async softDelete(id: EventDayId, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<EventDay>(DAYS_KEY);
    await writeAll(
      DAYS_KEY,
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
    const rows = await readAll<Session>(SESSIONS_KEY);
    await writeAll(SESSIONS_KEY, upsert(rows, session));
  }

  async softDelete(id: SessionId, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<Session>(SESSIONS_KEY);
    await writeAll(
      SESSIONS_KEY,
      rows.map((s) =>
        s.id === id ? { ...s, deletedAt: at as Utc, updatedAt: at as Utc } : s,
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

  async get(id: EventId): Promise<Event | null> {
    const rows = await readAll<Event>(EVENTS_KEY);
    const row = rows.find((e) => e.id === id);
    return row ? normaliseEvent(row) : null;
  }

  async save(event: Event): Promise<void> {
    const rows = await readAll<Event>(EVENTS_KEY);
    await writeAll(EVENTS_KEY, upsert(rows, event));
  }

  async softDelete(id: EventId, at: string = nowUtc()): Promise<void> {
    const rows = await readAll<Event>(EVENTS_KEY);
    await writeAll(
      EVENTS_KEY,
      rows.map((e) =>
        e.id === id ? { ...e, deletedAt: at as Utc, updatedAt: at as Utc } : e,
      ),
    );
    // Spots are deliberately untouched. An event is a selection over them, so
    // deleting the selection must not delete the places.
  }

  async setSpotIncluded(
    id: EventId,
    spotId: SpotId,
    included: boolean,
  ): Promise<void> {
    const rows = await readAll<Event>(EVENTS_KEY);
    const at = nowUtc();
    await writeAll(
      EVENTS_KEY,
      rows.map((e) => {
        if (e.id !== id) return e;
        const has = e.spotIds.includes(spotId);
        if (has === included) return e;
        return {
          ...e,
          spotIds: included
            ? [...e.spotIds, spotId]
            : e.spotIds.filter((x) => x !== spotId),
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
    const rows = await readAll<Event>(EVENTS_KEY);
    const at = nowUtc();
    await writeAll(
      EVENTS_KEY,
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
export const eventDays: IEventDayRepository = new EventDayRepository();
export const sessions: ISessionRepository = new SessionRepository();

export const repositories: RepositoryBundle = {
  spots: new SpotRepository(),
  media: new MediaRepository(),
  notes: new UserSpotNoteRepository(),
};
